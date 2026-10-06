// Emails on these domains are auto-provisioned as agency members on first
// login (see app/(auth)/auth/callback/route.ts). Shared so the client-access
// settings refuse to hand them a client seat they'd be upgraded out of anyway.
export const AGENCY_DOMAINS = ["patoagencja.com"];

export function isAgencyEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return Boolean(domain && AGENCY_DOMAINS.includes(domain));
}

/**
 * Escapes LIKE wildcards so an address such as "jan_kowalski@x.pl" can't
 * match "janXkowalski@x.pl" in a case-insensitive lookup. Callers still
 * compare the lowercased result exactly - this only narrows the query.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
