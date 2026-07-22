import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Emails on these domains are auto-provisioned as agency members on first
// login - no manual SQL needed to onboard the team.
const AGENCY_DOMAINS = ["patoagencja.com"];

/**
 * Magic-link callback. Exchanges the auth code for a session cookie, then
 * sends the user to the landing route which redirects them to their dashboard.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Auto-provision agency teammates (@patoagencja.com) as `member` so a
      // partner/employee can log in with just the login link.
      const user = data?.user;
      const domain = user?.email?.split("@")[1]?.toLowerCase();
      if (user?.email && domain && AGENCY_DOMAINS.includes(domain)) {
        const admin = createAdminClient();
        const { data: existing } = await admin
          .from("users")
          .select("id, role")
          .eq("id", user.id)
          .maybeSingle();
        if (!existing) {
          await admin.from("users").insert({
            id: user.id,
            email: user.email,
            role: "member",
          });
        } else if (existing.role === "client") {
          // A teammate previously added as a client of one brand: upgrade to
          // member (all clients). Never downgrade admins.
          await admin
            .from("users")
            .update({ role: "member", client_id: null })
            .eq("id", user.id);
        }
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
