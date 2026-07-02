import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { getAuthorizationUrl } from "@/lib/integrations/meta-ads";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";

const STATE_TTL_MS = 10 * 60 * 1000;

// Kicks off the Meta OAuth flow: verify the caller, mint a one-time state,
// persist it, then redirect to Facebook's consent dialog.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const clientSlug = searchParams.get("client");
  if (!clientSlug) {
    return NextResponse.json({ error: "Missing client" }, { status: 400 });
  }

  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) {
    const dest = access.status === 401 ? "/login" : `/${clientSlug}`;
    return NextResponse.redirect(`${origin}${dest}`);
  }

  const state = randomUUID();
  const admin = createAdminClient();
  const { error } = await admin.from("oauth_states").insert({
    state,
    client_id: access.clientId,
    provider: "meta_ads",
    user_id: access.user.id,
    expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  });

  if (error) {
    console.error("[meta/connect] failed to persist state", error);
    return NextResponse.redirect(
      `${origin}/${clientSlug}/settings?error=meta_ads`
    );
  }

  return NextResponse.redirect(getAuthorizationUrl(state));
}
