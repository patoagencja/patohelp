import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

// "Link z hasłem": the agency hands a client one URL plus a password instead
// of e-mail logins. Behind it sits a dedicated client account
// (SHARE_EMAIL_DOMAIN, lib/auth/login-policy.ts) holding that client's seat;
// the link's secret and the password's hash live in its auth app_metadata,
// which only the service role can write. Opening the link with the right
// password signs the visitor in as that account, so RLS shows exactly that
// client's panel. Deleting the account switches the link off.
//
// Import-free (unit tests run it directly under Node's type stripping).

/** What the link account carries in app_metadata.share. */
export interface ShareMeta {
  client_id: string;
  secret_sha256: string;
  password_hash: string;
  created_at: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET = /^[A-Za-z0-9_-]{32,64}$/;

/** The secret part of the URL: 192 random bits. */
export function newShareSecret(): string {
  return randomBytes(24).toString("base64url");
}

// No look-alikes (0/o, 1/l/i): the password is read off a screen and typed.
const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** "xxxx-xxxx-xxxx" (~59 bits): typed by a person, guessed by nobody. */
export function newSharePassword(): string {
  const chars = Array.from({ length: 12 }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]);
  return [0, 4, 8].map((i) => chars.slice(i, i + 4).join("")).join("-");
}

/** Dashes, spaces and capitals don't matter when typing it back. */
export function normalizeSharePassword(input: string): string {
  return input.toLowerCase().replace(/[\s-]/g, "");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashSharePassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(normalizeSharePassword(password), salt, 32);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifySharePassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64url");
  if (expected.length !== 32) return false;
  const actual = scryptSync(normalizeSharePassword(password), Buffer.from(saltB64, "base64url"), 32);
  return timingSafeEqual(actual, expected);
}

/** "/k/<account id>.<secret>" -> its parts, or null for anything malformed. */
export function parseShareToken(token: string): { userId: string; secret: string } | null {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const userId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  return UUID.test(userId) && SECRET.test(secret) ? { userId, secret } : null;
}

export function shareTokenOf(userId: string, secret: string): string {
  return `${userId}.${secret}`;
}

export function shareMetaOf(appMetadata: unknown): ShareMeta | null {
  const share = (appMetadata as { share?: Partial<ShareMeta> } | null | undefined)?.share;
  if (
    !share ||
    typeof share.client_id !== "string" ||
    typeof share.secret_sha256 !== "string" ||
    typeof share.password_hash !== "string"
  ) {
    return null;
  }
  return {
    client_id: share.client_id,
    secret_sha256: share.secret_sha256,
    password_hash: share.password_hash,
    created_at: typeof share.created_at === "string" ? share.created_at : "",
  };
}

export function shareSecretMatches(secret: string, meta: ShareMeta): boolean {
  const a = Buffer.from(sha256Hex(secret), "hex");
  const b = Buffer.from(meta.secret_sha256, "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}
