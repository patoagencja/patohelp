// Shared Google OAuth plumbing for the two Google providers (Google Ads and
// GA4). Both are authorised by the agency's own Google login, so one dead
// refresh token takes both down for every client at once. These helpers let a
// single consent cover both providers (when they use the same OAuth client)
// and record WHICH Google account a token belongs to, so a reconnect can be
// propagated to every client that used the same login.

export const GOOGLE_SCOPE_ADS = "https://www.googleapis.com/auth/adwords";
export const GOOGLE_SCOPE_GA4 = "https://www.googleapis.com/auth/analytics.readonly";
// Non-sensitive: lets the token response carry an id_token with the email.
const IDENTITY_SCOPES = ["openid", "email"];

export type GoogleProvider = "google_ads" | "ga4";

/**
 * A refresh token is bound to the OAuth client that issued it, so a token from
 * the Google Ads consent can only drive GA4 when both providers use the same
 * client id (GOOGLE_ADS_CLIENT_ID === GA4_CLIENT_ID). Only then do we ask for
 * both scopes in one consent and share the token across providers.
 */
export function googleOAuthClientsShared(): boolean {
  const ads = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
  const ga4 = process.env.GA4_CLIENT_ID?.trim();
  return !!ads && !!ga4 && ads === ga4;
}

/** Scopes for a consent started from `primary`'s connect route. */
export function googleScopesFor(primary: GoogleProvider): string {
  const own = primary === "google_ads" ? GOOGLE_SCOPE_ADS : GOOGLE_SCOPE_GA4;
  const other = primary === "google_ads" ? GOOGLE_SCOPE_GA4 : GOOGLE_SCOPE_ADS;
  return [own, ...(googleOAuthClientsShared() ? [other] : []), ...IDENTITY_SCOPES].join(" ");
}

/**
 * Providers the granted token can actually serve. Google's granular consent
 * lets the user untick scopes, so trust the `scope` the token endpoint
 * returned rather than what we asked for. Missing `scope` (old responses) =
 * only the provider whose flow it was.
 */
export function googleProvidersForScope(
  primary: GoogleProvider,
  grantedScope: string | null | undefined
): GoogleProvider[] {
  if (!grantedScope) return [primary];
  const granted = new Set(grantedScope.split(/\s+/));
  const out: GoogleProvider[] = [];
  if (granted.has(GOOGLE_SCOPE_ADS) && (primary === "google_ads" || googleOAuthClientsShared())) {
    out.push("google_ads");
  }
  if (granted.has(GOOGLE_SCOPE_GA4) && (primary === "ga4" || googleOAuthClientsShared())) {
    out.push("ga4");
  }
  return out.length ? out : [primary];
}

/**
 * Email claim of an OpenID id_token. The token comes straight from Google's
 * token endpoint over TLS in the same request, so decoding without verifying
 * the signature is fine for "which account is this" bookkeeping.
 */
export function emailFromIdToken(idToken: string | null | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: unknown;
    };
    return typeof json.email === "string" ? json.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Stored (encrypted) credential blob for both Google providers in OAuth mode. */
export interface GoogleOAuthCredentials {
  refresh_token: string;
  /** Google account that granted the token; absent on pre-2026-10 rows. */
  account_email?: string | null;
  /** Space-separated scopes granted with this token. */
  scope?: string | null;
  /** When the consent happened - a token dying ~7 days later = Testing mode. */
  granted_at?: string | null;
}

/**
 * The OAuth client id in use per Google provider, for the "which Google Cloud
 * project is this" line. Client ids are public (they travel in every consent
 * URL); the leading number is the Cloud project number.
 */
export function googleOAuthClientInfo(): Array<{
  provider: GoogleProvider;
  envVar: string;
  clientId: string | null;
  projectNumber: string | null;
}> {
  const describe = (provider: GoogleProvider, envVar: string) => {
    const clientId = process.env[envVar]?.trim() || null;
    const projectNumber = clientId?.match(/^(\d+)-/)?.[1] ?? null;
    return { provider, envVar, clientId, projectNumber };
  };
  return [
    describe("google_ads", "GOOGLE_ADS_CLIENT_ID"),
    describe("ga4", "GA4_CLIENT_ID"),
  ];
}
