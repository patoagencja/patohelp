import { NextResponse } from "next/server";

import {
  exchangeCodeForTokens,
  listAccessibleProperties,
} from "@/lib/integrations/ga4";
import {
  consumeOAuthState,
  getClientSlug,
  upsertIntegration,
} from "@/lib/integrations/oauth-flow";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Completes the GA4 OAuth flow. Unlike ad accounts, GA4 needs a single chosen
// property: auto-select when there's one, otherwise send the admin to a picker.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  const fail = (slug: string | null) =>
    NextResponse.redirect(`${origin}/${slug ?? "dre"}/settings?error=ga4`);

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
  const consumed = await consumeOAuthState(admin, state, "ga4", user.id);
  if (!consumed) {
    return fail(null);
  }

  const slug = await getClientSlug(admin, consumed.clientId);

  try {
    const { refresh_token } = await exchangeCodeForTokens(code);
    const properties = await listAccessibleProperties(refresh_token);

    const autoProperty = properties.length === 1 ? properties[0].propertyId : null;

    await upsertIntegration(
      admin,
      consumed.clientId,
      "ga4",
      { refresh_token },
      { propertyId: autoProperty, properties }
    );

    if (autoProperty || properties.length === 0) {
      return NextResponse.redirect(
        `${origin}/${slug ?? "dre"}/settings?connected=ga4`
      );
    }

    // Multiple properties - let the admin choose which one to track.
    return NextResponse.redirect(`${origin}/${slug ?? "dre"}/settings/ga4-select`);
  } catch (err) {
    console.error("[ga4/callback] flow failed", err);
    return fail(slug);
  }
}
