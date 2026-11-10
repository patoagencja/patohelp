"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { escapeLikePattern } from "@/lib/agency/domains";
import { buildLoginEmail } from "@/lib/auth/login-email";
import { isLoginAllowed, mayRequestLoginLink } from "@/lib/auth/login-policy";
import { sendEmail } from "@/lib/notify/send";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type LoginLinkResult = { ok: true } | { ok: false; error: string };

const NO_ACCESS_MESSAGE =
  "Ten adres nie ma jeszcze dostępu do panelu. Poproś swojego opiekuna w Pato o zaproszenie - albo wpisz adres, na który przyszło zaproszenie.";

// Per-instance throttle. Who can be mailed at all is limited to the allowed
// domains and invited addresses, so this only keeps a double click or a
// script from flooding them; Supabase's own e-mail limit is not in play
// when the app sends the mail itself.
const lastSentTo = new Map<string, number>();
const sentFrom = new Map<string, { count: number; since: number }>();
const lookupsFrom = new Map<string, { count: number; since: number }>();
const EMAIL_COOLDOWN_MS = 45_000;
const IP_PER_HOUR = 20;
const LOOKUPS_PER_HOUR = 30;

function lookupThrottled(ip: string): boolean {
  const now = Date.now();
  const w = lookupsFrom.get(ip);
  if (w && now - w.since < 3_600_000) {
    if (w.count >= LOOKUPS_PER_HOUR) return true;
    lookupsFrom.set(ip, { count: w.count + 1, since: w.since });
    return false;
  }
  lookupsFrom.set(ip, { count: 1, since: now });
  return false;
}

/**
 * Did the agency invite this address ("Dostęp do panelu")? A pending client
 * invitation, or an account that already holds a client seat. Case-insensitive
 * lookups (hand-written rows may not be lowercased), exact match in
 * mayRequestLoginLink. A failed read counts as "no" - fail closed.
 */
async function isInvitedAddress(admin: ReturnType<typeof createAdminClient>, email: string): Promise<boolean> {
  const pattern = escapeLikePattern(email);
  const [invites, profiles] = await Promise.all([
    admin.from("client_invitations").select("email, role").ilike("email", pattern),
    admin.from("users").select("email, role, client_id").ilike("email", pattern),
  ]);
  return mayRequestLoginLink(email, {
    invitations: invites.error ? [] : invites.data,
    profiles: profiles.error ? [] : profiles.data,
  });
}

function throttled(email: string, ip: string): boolean {
  const now = Date.now();
  const last = lastSentTo.get(email);
  if (last && now - last < EMAIL_COOLDOWN_MS) return true;
  const w = sentFrom.get(ip);
  if (w && now - w.since < 3_600_000 && w.count >= IP_PER_HOUR) return true;
  lastSentTo.set(email, now);
  sentFrom.set(ip, w && now - w.since < 3_600_000 ? { count: w.count + 1, since: w.since } : { count: 1, since: now });
  return false;
}

/**
 * The app's base URL for the link. The configured one first: a link built
 * from a request's Host header could be pointed at another site by a forged
 * header, and the e-mail would carry a working login token there.
 */
function baseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const h = headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Send the login link. Server-side so the "agency domains or invited
 * addresses" rule (lib/auth/login-policy.ts) holds before any e-mail leaves, and so the
 * e-mail is ours (lib/auth/login-email.ts), not Supabase's plain default.
 * The link verifies a token hash (no PKCE), so it also works when opened
 * on another device than the one that asked for it.
 */
export async function sendLoginLink(raw: unknown): Promise<LoginLinkResult> {
  const parsed = z.string().trim().toLowerCase().email().max(254).safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Ten adres e-mail wygląda na niepoprawny - sprawdź literówki." };
  const email = parsed.data;

  const ip = (headers().get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const admin = createAdminClient();

  // Outside the agency domains only an address the agency invited gets a
  // link (lib/auth/login-policy.ts) - client users log in with their own
  // company e-mail. The lookup is capped per IP so the form can't be used
  // to sweep addresses.
  if (!isLoginAllowed(email)) {
    if (lookupThrottled(ip)) {
      return { ok: false, error: "Za dużo prób z rzędu. Spróbuj ponownie za kilka minut." };
    }
    if (!(await isInvitedAddress(admin, email))) {
      return { ok: false, error: NO_ACCESS_MESSAGE };
    }
  }

  if (throttled(email, ip)) {
    return { ok: false, error: "Link został już wysłany przed chwilą. Sprawdź skrzynkę (także Spam) albo spróbuj za minutę." };
  }

  const base = baseUrl();
  let generated = await admin.auth.admin.generateLink({ type: "magiclink", email });
  // A first-time teammate (or an invited client whose invitation e-mail
  // never went out) has no account yet: an invite link creates it (the
  // callback accepts both, provisions @patoagencja.com as member and maps a
  // client invitation to its seat).
  if (generated.error && /not.?found|no user/i.test(generated.error.message)) {
    generated = await admin.auth.admin.generateLink({ type: "invite", email });
  }
  const hashed = generated.data?.properties?.hashed_token;
  const type = generated.data?.properties?.verification_type === "invite" ? "invite" : "magiclink";
  if (generated.error || !hashed) {
    console.error("[login] generateLink failed", generated.error?.message);
    return { ok: false, error: "Nie udało się wysłać linku. Spróbuj ponownie za chwilę." };
  }

  const link = `${base}/auth/callback?token_hash=${encodeURIComponent(hashed)}&type=${type}`;
  const mail = buildLoginEmail({ link, email });
  const sent = await sendEmail([email], mail.subject, mail.html, mail.text);
  if (sent.ok) return { ok: true };

  // No Resend configured (or it failed): Supabase sends its own e-mail, so
  // nobody is locked out over a missing key.
  console.warn("[login] own e-mail failed, falling back to Supabase", sent.error);
  const { error } = await createClient().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${base}/auth/callback`, shouldCreateUser: true },
  });
  if (error) {
    const m = error.message.toLowerCase();
    return {
      ok: false,
      error:
        m.includes("rate limit") || m.includes("security purposes")
          ? "Link został już wysłany przed chwilą. Sprawdź skrzynkę (także Spam) albo spróbuj za minutę."
          : "Nie udało się wysłać linku. Spróbuj ponownie za chwilę.",
    };
  }
  return { ok: true };
}
