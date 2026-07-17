import { NextResponse } from "next/server";

import {
  consumeOAuthState,
  getClientSlug,
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

  const fail = (slug: string | null) =>
    NextResponse.redirect(`${origin}/${slug ?? "dre"}/settings?error=tiktok_ads`);

  if (!authCode || !state) return fail(null);

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  const admin = createAdminClient();
  const consumed = await consumeOAuthState(admin, state, "tiktok_ads", user.id);
  if (!consumed) return fail(null);

  const slug = await getClientSlug(admin, consumed.clientId);

  try {
    const { access_token, advertiser_ids } = await exchangeCodeForToken(authCode);
    const advertisers = await listAdvertisers(access_token, advertiser_ids);

    await upsertIntegration(
      admin,
      consumed.clientId,
      "tiktok_ads",
      { access_token },
      advertisers.map((a) => ({ id: a.id, name: a.name }))
    );

    return NextResponse.redirect(
      `${origin}/${slug ?? "dre"}/settings?connected=tiktok_ads`
    );
  } catch (err) {
    console.error("[tiktok/callback] flow failed", err);
    return fail(slug);
  }
}
