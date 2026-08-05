import { NextResponse } from "next/server";

import { exchangeCodeForTokens } from "@/lib/integrations/google-slides";
import {
  consumeOAuthState,
  getClientSlug,
  upsertIntegration,
} from "@/lib/integrations/oauth-flow";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Completes the Google Slides/Drive OAuth flow for report automation.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  const fail = (slug: string | null) =>
    NextResponse.redirect(
      `${origin}/${slug ?? "dre"}/settings?error=google_slides`
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
  const consumed = await consumeOAuthState(admin, state, "google_slides", user.id);
  if (!consumed) {
    return fail(null);
  }

  const slug = await getClientSlug(admin, consumed.clientId);

  try {
    const { refresh_token } = await exchangeCodeForTokens(code);
    await upsertIntegration(admin, consumed.clientId, "google_slides", { refresh_token }, {});
    return NextResponse.redirect(
      `${origin}/${slug ?? "dre"}/settings?connected=google_slides`
    );
  } catch (err) {
    console.error("[google-slides/callback] flow failed", err);
    return fail(slug);
  }
}
