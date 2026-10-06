import type { EmailOtpType, User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { escapeLikePattern, isAgencyEmail } from "@/lib/agency/domains";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Admin invites (settings → "Dostęp do panelu") can't use PKCE, so their
// e-mail template must link here with ?token_hash=...&type=invite instead of
// ?code=. Only the e-mail login types we actually send are accepted.
const OTP_TYPES: EmailOtpType[] = ["invite", "magiclink", "email"];

/**
 * Magic-link callback. Exchanges the auth code (or verifies the e-mailed token
 * hash) for a session cookie, then sends the user to the landing route which
 * redirects them to their dashboard.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const otpType = searchParams.get("type") as EmailOtpType | null;
  // `${origin}${next}` with next="@evil.com" or ".evil.com" lands on another
  // host (open redirect straight after login). Only same-origin absolute
  // paths are allowed; "//" and "/\" are protocol-relative in browsers.
  const rawNext = searchParams.get("next") ?? "/";
  const next =
    rawNext.startsWith("/") && !rawNext.startsWith("//") && !rawNext.startsWith("/\\")
      ? rawNext
      : "/";

  const supabase = createClient();
  let user: User | null = null;
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) user = data?.user ?? null;
  } else if (tokenHash && otpType && OTP_TYPES.includes(otpType)) {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType,
    });
    if (!error) user = data?.user ?? null;
  }

  if (!user) {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  // Both branches below grant data access by e-mail address, so only on a
  // verified one (magic link sets email_confirmed_at; another provider might not).
  if (user.email && user.email_confirmed_at) {
    if (isAgencyEmail(user.email)) {
      await provisionAgencyMember(user.id, user.email);
    } else {
      await applyPendingInvitation(user.id, user.email);
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}

// Auto-provision agency teammates (@patoagencja.com) as `member` so a
// partner/employee can log in with just the login link.
async function provisionAgencyMember(userId: string, email: string) {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("users")
    .select("id, role")
    .eq("id", userId)
    .maybeSingle();
  if (!existing) {
    await admin.from("users").insert({ id: userId, email, role: "member" });
  } else if (existing.role === "client") {
    // A teammate previously added as a client of one brand: upgrade to
    // member (all clients). Never downgrade admins.
    await admin
      .from("users")
      .update({ role: "member", client_id: null })
      .eq("id", userId);
  }
}

// The signup trigger maps invitations only on account creation. Someone who
// signed up first and was invited later would otherwise stay unassigned
// forever. Only fills an EMPTY client seat from a 'client' invitation: it
// never moves a user between clients and never grants an agency role.
async function applyPendingInvitation(userId: string, email: string) {
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("users")
    .select("role, client_id")
    .eq("id", userId)
    .maybeSingle();
  if (!profile || profile.role !== "client" || profile.client_id !== null) return;

  const normalized = email.toLowerCase();
  const { data: invites } = await admin
    .from("client_invitations")
    .select("email, client_id, role")
    .ilike("email", escapeLikePattern(normalized));
  const matches = ((invites ?? []) as { email: string; client_id: string; role: string }[])
    .filter((i) => i.email.toLowerCase() === normalized);
  // Ambiguous (hand-made duplicates) or agency-role invitations: leave for a
  // human rather than guess which tenant this person belongs to.
  if (matches.length !== 1 || matches[0].role !== "client") return;

  await admin
    .from("users")
    .update({ client_id: matches[0].client_id })
    .eq("id", userId)
    .eq("role", "client")
    .is("client_id", null);
}
