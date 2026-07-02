import { NextResponse } from "next/server";

import {
  exchangeCodeForLongLivedToken,
  listAdAccounts,
} from "@/lib/integrations/meta-ads";
import {
  consumeOAuthState,
  getClientSlug,
  upsertIntegration,
} from "@/lib/integrations/oauth-flow";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Completes the Meta OAuth flow: validate state, swap the code for a long-lived
// token, list ad accounts, store everything encrypted, then redirect back.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  const fail = (slug: string | null) =>
    NextResponse.redirect(
      `${origin}/${slug ?? "dre"}/settings?error=meta_ads`
    );

  if (oauthError || !code || !state) {
    return fail(null);
  }

  // The user must still be the one who started the flow.
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const admin = createAdminClient();
  const consumed = await consumeOAuthState(admin, state, "meta_ads", user.id);
  if (!consumed) {
    return fail(null);
  }

  const slug = await getClientSlug(admin, consumed.clientId);

  try {
    const { access_token, expires_at } = await exchangeCodeForLongLivedToken(
      code
    );
    const accounts = await listAdAccounts(access_token);

    await upsertIntegration(
      admin,
      consumed.clientId,
      "meta_ads",
      { access_token, expires_at: expires_at.toISOString() },
      accounts.map((a) => ({
        id: a.id,
        name: a.name,
        currency: a.currency,
      }))
    );

    return NextResponse.redirect(
      `${origin}/${slug ?? "dre"}/settings?connected=meta_ads`
    );
  } catch (err) {
    console.error("[meta/callback] flow failed", err);
    return fail(slug);
  }
}
