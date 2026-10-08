"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { buildLoginEmail } from "@/lib/auth/login-email";
import { isLoginAllowed } from "@/lib/auth/login-policy";
import { sendEmail } from "@/lib/notify/send";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type LoginLinkResult = { ok: true } | { ok: false; error: string };

// Per-instance throttle. Who can be mailed at all is limited to the allowed
// domains (our own mailboxes), so this only keeps a double click or a
// script from flooding them; Supabase's own e-mail limit is not in play
// when the app sends the mail itself.
const lastSentTo = new Map<string, number>();
const sentFrom = new Map<string, { count: number; since: number }>();
const EMAIL_COOLDOWN_MS = 45_000;
const IP_PER_HOUR = 20;

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
 * Send the login link. Server-side so the "agency only for now" rule
 * (lib/auth/login-policy.ts) holds before any e-mail leaves, and so the
 * e-mail is ours (lib/auth/login-email.ts), not Supabase's plain default.
 * The link verifies a token hash (no PKCE), so it also works when opened
 * on another device than the one that asked for it.
 */
export async function sendLoginLink(raw: unknown): Promise<LoginLinkResult> {
  const parsed = z.string().trim().toLowerCase().email().max(254).safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Ten adres e-mail wygląda na niepoprawny - sprawdź literówki." };
  const email = parsed.data;

  if (!isLoginAllowed(email)) {
    return { ok: false, error: "Panel jest na razie dostępny tylko dla zespołu Pato (adresy @patoagencja.com)." };
  }

  const ip = (headers().get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (throttled(email, ip)) {
    return { ok: false, error: "Link został już wysłany przed chwilą. Sprawdź skrzynkę (także Spam) albo spróbuj za minutę." };
  }

  const base = baseUrl();
  const admin = createAdminClient();
  let generated = await admin.auth.admin.generateLink({ type: "magiclink", email });
  // A first-time teammate has no account yet: an invite link creates it
  // (the callback accepts both and provisions @patoagencja.com as member).
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
