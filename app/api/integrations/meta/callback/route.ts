import { NextResponse } from "next/server";

import type { MetaCredentials } from "@/lib/integrations/credentials";
import { requireAgencyUser } from "@/lib/integrations/guard";
import {
  exchangeCodeForLongLivedToken,
  getMetaIdentity,
  listAdAccounts,
} from "@/lib/integrations/meta-ads";
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

// Propagation checks every other client's ad accounts with the new token.
export const maxDuration = 60;

// Completes the Meta OAuth flow: validate state, swap the code for a long-lived
// token, list ad accounts, store everything encrypted, then reuse the new
// token for every other client broken by the same dead login, and redirect.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");
  const returnTo = oauthReturnTo(state);

  const fail = (slug: string | null, reason?: OAuthFailureReason) =>
    NextResponse.redirect(
      oauthDoneUrl(origin, { returnTo, slug, provider: "meta_ads", ok: false, reason })
    );

  // The user must still be the one who started the flow - and agency staff,
  // since a reconnect here may rewrite other clients' credentials too.
  const agency = await requireAgencyUser();
  if (!agency.ok) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const admin = createAdminClient();

  // No code: "Anuluj" on Facebook's dialog (error=access_denied,
  // error_reason=user_denied). Back to the client the state names.
  if (oauthError || !code || !state) {
    const slug = await abandonedFlowSlug(admin, state, "meta_ads", agency.user.id);
    const reason =
      oauthFailureReason(oauthError, searchParams.get("error_reason")) ??
      (state ? "provider" : "state");
    return fail(slug, reason);
  }

  const consumed = await consumeOAuthState(admin, state, "meta_ads", agency.user.id);
  if (!consumed) {
    return fail(null, "state");
  }

  const slug = await getClientSlug(admin, consumed.clientId);

  try {
    const previousTokens = await readStoredTokens(admin, consumed.clientId, ["meta_ads"]);
    const { access_token, expires_at } = await exchangeCodeForLongLivedToken(
      code
    );
    const accounts = await listAdAccounts(access_token);

    // First connect with a login that reaches no ad account (none ticked on
    // Facebook's dialog, or no access yet): "0 z 0" and nothing ever syncs.
    if (
      accounts.length === 0 &&
      returnTo === "settings" &&
      !(await hasIntegration(admin, consumed.clientId, "meta_ads"))
    ) {
      return fail(slug, "no_access");
    }
    // Which login this is; best-effort, the connection works without it.
    const identity = await getMetaIdentity(access_token).catch(() => null);

    const credentials: MetaCredentials = {
      access_token,
      expires_at: expires_at.toISOString(),
      ...(identity ? { identity } : {}),
    };

    await upsertIntegration(
      admin,
      consumed.clientId,
      "meta_ads",
      credentials,
      accounts.map((a) => ({
        id: a.id,
        name: a.name,
        currency: a.currency,
      }))
    );

    const propagation = await propagateCredentials(admin, {
      providers: ["meta_ads"],
      credentials: credentials as unknown as Record<string, unknown>,
      token: access_token,
      identity: identity?.id ?? null,
      previousTokens,
      skip: [{ clientId: consumed.clientId, provider: "meta_ads" }],
      mode: "repair",
    }).catch(() => ({ fixed: [], noAccess: 0 }));

    return NextResponse.redirect(
      oauthDoneUrl(origin, {
        returnTo,
        slug,
        provider: "meta_ads",
        ok: true,
        fixed: propagation.fixed.length,
      })
    );
  } catch (err) {
    console.error("[meta/callback] flow failed", err);
    return fail(slug);
  }
}
