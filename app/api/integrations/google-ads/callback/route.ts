import { NextResponse } from "next/server";

import {
  exchangeCodeForTokens,
  listAccessibleCustomers,
} from "@/lib/integrations/google-ads";
import {
  consumeOAuthState,
  getClientSlug,
  upsertIntegration,
} from "@/lib/integrations/oauth-flow";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Completes the Google Ads OAuth flow: validate state, swap the code for a
// refresh token, list all accessible customer accounts, store encrypted.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  const fail = (slug: string | null) =>
    NextResponse.redirect(
      `${origin}/${slug ?? "dre"}/settings?error=google_ads`
    );

  if (oauthError || !code || !state) {
    return fail(null);
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const admin = createAdminClient();
  const consumed = await consumeOAuthState(admin, state, "google_ads", user.id);
  if (!consumed) {
    return fail(null);
  }

  const slug = await getClientSlug(admin, consumed.clientId);

  try {
    const { refresh_token } = await exchangeCodeForTokens(code);
    const accounts = await listAccessibleCustomers(refresh_token);

    await upsertIntegration(
      admin,
      consumed.clientId,
      "google_ads",
      { refresh_token },
      accounts.map((a) => ({
        id: a.id,
        name: a.name,
        currency: a.currency,
        timezone: a.timezone,
      }))
    );

    return NextResponse.redirect(
      `${origin}/${slug ?? "dre"}/settings?connected=google_ads`
    );
  } catch (err) {
    console.error("[google-ads/callback] flow failed", err);
    return fail(slug);
  }
}
