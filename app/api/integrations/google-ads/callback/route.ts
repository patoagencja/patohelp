import { NextResponse } from "next/server";

import { requireAgencyUser } from "@/lib/integrations/guard";
import {
  exchangeCodeForTokens,
  listAccessibleCustomers,
} from "@/lib/integrations/google-ads";
import {
  emailFromIdToken,
  googleProvidersForScope,
  type GoogleOAuthCredentials,
} from "@/lib/integrations/google-identity";
import {
  oauthFailureReason,
  type OAuthFailureReason,
} from "@/lib/integrations/oauth-errors";
import {
  abandonedFlowSlug,
  consumeOAuthState,
  getClientSlug,
  hasIntegration,
  oauthDoneUrl,
  oauthReturnTo,
  upsertIntegration,
} from "@/lib/integrations/oauth-flow";
import {
  propagateCredentials,
  readStoredTokens,
} from "@/lib/integrations/propagate";
import { createAdminClient } from "@/lib/supabase/admin";

// Propagation lists customers/properties once and checks every client.
export const maxDuration = 60;

// Completes the Google Ads OAuth flow: validate state, swap the code for a
// refresh token, list all accessible customer accounts, store encrypted. Then
// reuse the token for every other Google Ads (and, when the consent also
// granted analytics.readonly on a shared OAuth client, GA4) integration
// broken by the same dead Google login.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");
  const returnTo = oauthReturnTo(state);

  const fail = (slug: string | null, reason?: OAuthFailureReason) =>
    NextResponse.redirect(
      oauthDoneUrl(origin, { returnTo, slug, provider: "google_ads", ok: false, reason })
    );

  const agency = await requireAgencyUser();
  if (!agency.ok) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const admin = createAdminClient();

  // No code: cancelled consent, or a Workspace admin blocking the app
  // ("Ta aplikacja jest zablokowana"). Back to the client the state names.
  if (oauthError || !code || !state) {
    const slug = await abandonedFlowSlug(admin, state, "google_ads", agency.user.id);
    const reason =
      oauthFailureReason(oauthError, searchParams.get("error_subtype")) ??
      (state ? "provider" : "state");
    return fail(slug, reason);
  }

  const consumed = await consumeOAuthState(admin, state, "google_ads", agency.user.id);
  if (!consumed) {
    return fail(null, "state");
  }

  const slug = await getClientSlug(admin, consumed.clientId);

  try {
    const { refresh_token, id_token, scope } = await exchangeCodeForTokens(code);
    const providers = googleProvidersForScope("google_ads", scope);
    const previousTokens = await readStoredTokens(admin, consumed.clientId, providers);
    const accounts = await listAccessibleCustomers(refresh_token);

    // First connect with a login that reaches no Ads account: "Połączono ·
    // wybrano 0 z 0" and nothing ever syncs. Say so instead.
    if (
      accounts.length === 0 &&
      returnTo === "settings" &&
      !(await hasIntegration(admin, consumed.clientId, "google_ads"))
    ) {
      return fail(slug, "no_access");
    }

    const credentials: GoogleOAuthCredentials = {
      refresh_token,
      account_email: emailFromIdToken(id_token),
      scope,
      granted_at: new Date().toISOString(),
    };

    await upsertIntegration(
      admin,
      consumed.clientId,
      "google_ads",
      credentials,
      accounts.map((a) => ({
        id: a.id,
        name: a.name,
        currency: a.currency,
        timezone: a.timezone,
        // Manager accounts have no campaigns; client accounts under one
        // remember which manager reaches them (lib/integrations/google-ads.ts).
        ...(a.manager ? { manager: true } : {}),
        ...(a.login_customer_id ? { login_customer_id: a.login_customer_id } : {}),
      }))
    );

    const propagation = await propagateCredentials(admin, {
      providers,
      credentials: { ...credentials },
      token: refresh_token,
      identity: credentials.account_email ?? null,
      previousTokens,
      skip: [{ clientId: consumed.clientId, provider: "google_ads" }],
      mode: "repair",
    }).catch(() => ({ fixed: [], noAccess: 0 }));

    return NextResponse.redirect(
      oauthDoneUrl(origin, {
        returnTo,
        slug,
        provider: "google_ads",
        ok: true,
        fixed: propagation.fixed.length,
      })
    );
  } catch (err) {
    console.error("[google-ads/callback] flow failed", err);
    return fail(slug);
  }
}
