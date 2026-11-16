"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { hasClientSeat, isShareViewerEmail } from "@/lib/auth/login-policy";
import {
  parseShareToken,
  shareMetaOf,
  shareSecretMatches,
  verifySharePassword,
} from "@/lib/auth/share-link";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type OpenShareState = { error?: string };

const WRONG = "Nieprawidłowe hasło albo link został wyłączony. Sprawdź hasło i spróbuj ponownie.";
const TOO_MANY = "Za dużo prób. Spróbuj ponownie za kilkanaście minut.";
const FAILED = "Nie udało się otworzyć panelu. Spróbuj ponownie za chwilę.";

// Per-instance throttle on top of a ~59-bit password and a 192-bit secret in
// the URL: it only has to make typing-in-a-loop pointless.
const WINDOW_MS = 15 * 60_000;
const attempts = new Map<string, { count: number; since: number }>();
function throttled(key: string, max: number): boolean {
  const now = Date.now();
  const w = attempts.get(key);
  if (!w || now - w.since >= WINDOW_MS) {
    attempts.set(key, { count: 1, since: now });
    return false;
  }
  if (w.count >= max) return true;
  w.count += 1;
  return false;
}

/**
 * The password page's submit: right secret + right password for a link
 * account that still holds its client's seat -> signed in as that account,
 * on to the client's panel. Every failure reads the same, so the page
 * doesn't tell a wrong password from a switched-off link.
 */
export async function openShareLink(_prev: OpenShareState, formData: FormData): Promise<OpenShareState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "").slice(0, 100);
  const parsed = parseShareToken(token);
  if (!parsed || !password.trim()) return { error: WRONG };

  const ip = (headers().get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (throttled(`ip:${ip}`, 10) || throttled(`link:${parsed.userId}`, 30)) return { error: TOO_MANY };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(parsed.userId);
  const account = data?.user;
  const meta = account && isShareViewerEmail(account.email) ? shareMetaOf(account.app_metadata) : null;
  if (
    error ||
    !account?.email ||
    !meta ||
    !shareSecretMatches(parsed.secret, meta) ||
    !verifySharePassword(password, meta.password_hash)
  ) {
    return { error: WRONG };
  }

  const { data: profile } = await admin
    .from("users")
    .select("role, client_id")
    .eq("id", account.id)
    .maybeSingle();
  if (!hasClientSeat(profile) || profile?.client_id !== meta.client_id) return { error: WRONG };
  const { data: client } = await admin
    .from("clients")
    .select("slug")
    .eq("id", meta.client_id)
    .maybeSingle();
  if (!client?.slug) return { error: WRONG };

  // A one-time login token minted and spent server-side: nothing is mailed,
  // the session cookie is set on this response.
  const generated = await admin.auth.admin.generateLink({ type: "magiclink", email: account.email });
  const hashed = generated.data?.properties?.hashed_token;
  if (generated.error || !hashed) {
    console.error("[share-link] generateLink failed", generated.error?.message);
    return { error: FAILED };
  }
  const { error: otpError } = await createClient().auth.verifyOtp({ token_hash: hashed, type: "magiclink" });
  if (otpError) {
    console.error("[share-link] verifyOtp failed", otpError.message);
    return { error: FAILED };
  }
  redirect(`/${client.slug}`);
}
