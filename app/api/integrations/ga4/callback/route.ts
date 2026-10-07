import { NextResponse } from "next/server";

import {
  exchangeCodeForTokens,
  listAccessibleProperties,
} from "@/lib/integrations/ga4";
import {
  googleProvidersForScope,
  type GoogleOAuthCredentials,
} from "@/lib/integrations/google-identity";
import { requireAgencyUser } from "@/lib/integrations/guard";
import {
  consumeOAuthState,
  getClientSlug,
  oauthDoneUrl,
  oauthReturnTo,
  upsertIntegration,
} from "@/lib/integrations/oauth-flow";
import {
  propagateCredentials,
  readStoredTokens,
} from "@/lib/integrations/propagate";
import { selectedGa4Properties } from "@/lib/integrations/ga4-merge";
import { createAdminClient } from "@/lib/supabase/admin";

// Propagation lists properties/customers once and checks every client.
export const maxDuration = 60;

// Completes the GA4 OAuth flow. Unlike ad accounts, GA4 needs a single chosen
// property: auto-select when there's one, otherwise send the admin to a picker.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");
  const returnTo = oauthReturnTo(state);

  const fail = (slug: string | null) =>
    NextResponse.redirect(
      oauthDoneUrl(origin, { returnTo, slug, provider: "ga4", ok: false })
    );

  if (oauthError || !code || !state) {
    return fail(null);
  }

  // Agency only: a reconnect here may also rewrite other clients' credentials.
  const agency = await requireAgencyUser();
  if (!agency.ok) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const admin = createAdminClient();
  const consumed = await consumeOAuthState(admin, state, "ga4", agency.user.id);
  if (!consumed) {
    return fail(null);
  }

  const slug = await getClientSlug(admin, consumed.clientId);

  try {
    const { refresh_token, scope, account_email } = await exchangeCodeForTokens(code);
    // Google Ads too when the consent granted adwords on a shared OAuth client.
    const providers = googleProvidersForScope("ga4", scope);
    const previousTokens = await readStoredTokens(admin, consumed.clientId, providers);
    const properties = await listAccessibleProperties(refresh_token);
    const credentials: GoogleOAuthCredentials = {
      refresh_token,
      account_email,
      scope,
      granted_at: new Date().toISOString(),
    };

    // Keep the property that was already chosen. Overwriting account_ids
    // unconditionally meant every reconnect wiped the selection whenever the
    // account has more than one property - and since the cron skips a client
    // with no propertyId, a routine "token expired -> reconnect" silently
    // switched the sync off until someone noticed weeks later.
    const { data: existing } = await admin
      .from("integrations")
      .select("account_ids")
      .eq("client_id", consumed.clientId)
      .eq("provider", "ga4")
      .maybeSingle();
    // Every previously picked property (Elfi: one per country) that the new
    // login still reaches stays picked.
    const accessible = new Set(properties.map((p) => p.propertyId));
    const keptIds = selectedGa4Properties(existing?.account_ids).filter((id) => accessible.has(id));

    const autoProperty =
      keptIds[0] ?? (properties.length === 1 ? properties[0].propertyId : null);

    await upsertIntegration(
      admin,
      consumed.clientId,
      "ga4",
      credentials,
      { propertyId: autoProperty, properties, ...(keptIds.length > 1 ? { propertyIds: keptIds } : {}) }
    );

    const propagation = await propagateCredentials(admin, {
      providers,
      credentials: { ...credentials },
      token: refresh_token,
      identity: account_email,
      previousTokens,
      skip: [{ clientId: consumed.clientId, provider: "ga4" }],
      mode: "repair",
    }).catch(() => ({ fixed: [], noAccess: 0 }));

    if (autoProperty || properties.length === 0 || returnTo === "clients") {
      return NextResponse.redirect(
        oauthDoneUrl(origin, {
          returnTo,
          slug,
          provider: "ga4",
          ok: true,
          fixed: propagation.fixed.length,
        })
      );
    }

    // Multiple properties - let the admin choose which one to track.
    return NextResponse.redirect(`${origin}/${slug ?? "dre"}/settings/ga4-select`);
  } catch (err) {
    console.error("[ga4/callback] flow failed", err);
    return fail(slug);
  }
}
