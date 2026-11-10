import { NextResponse } from "next/server";

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
  upsertIntegration,
} from "@/lib/integrations/oauth-flow";
import { exchangeCodeForToken, listAdvertisers } from "@/lib/integrations/tiktok";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Completes the TikTok OAuth flow: validate state, swap the auth code for a
// token, list advertisers, store encrypted, redirect back to settings.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  // TikTok returns the code as `auth_code` (sometimes `code`).
  const authCode = searchParams.get("auth_code") ?? searchParams.get("code");
  const state = searchParams.get("state");

  // Never another client's settings: an unknown client lands on /clients.
  const fail = (slug: string | null, reason?: OAuthFailureReason) =>
    NextResponse.redirect(
      oauthDoneUrl(origin, { returnTo: "settings", slug, provider: "tiktok_ads", ok: false, reason })
    );

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  const admin = createAdminClient();

  if (!authCode || !state) {
    const slug = await abandonedFlowSlug(admin, state, "tiktok_ads", user.id);
    const reason = oauthFailureReason(searchParams.get("error")) ?? (state ? "denied" : "state");
    return fail(slug, reason);
  }

  const consumed = await consumeOAuthState(admin, state, "tiktok_ads", user.id);
  if (!consumed) return fail(null, "state");

  const slug = await getClientSlug(admin, consumed.clientId);

  try {
    const { access_token, advertiser_ids } = await exchangeCodeForToken(authCode);
    const advertisers = await listAdvertisers(access_token, advertiser_ids);

    if (advertisers.length === 0 && !(await hasIntegration(admin, consumed.clientId, "tiktok_ads"))) {
      return fail(slug, "no_access");
    }

    await upsertIntegration(
      admin,
      consumed.clientId,
      "tiktok_ads",
      { access_token },
      advertisers.map((a) => ({ id: a.id, name: a.name }))
    );

    return NextResponse.redirect(
      oauthDoneUrl(origin, { returnTo: "settings", slug, provider: "tiktok_ads", ok: true })
    );
  } catch (err) {
    console.error("[tiktok/callback] flow failed", err);
    return fail(slug);
  }
}
