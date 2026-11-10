// The client slug is the dashboard's URL (/<slug>), so it must be URL-safe
// and must not shadow one of the app's own top-level routes.
// Import-free: the "Dodaj klienta" Server Action and the unit tests use it.

/** Top-level routes under app/ - a client with one of these slugs would be unreachable. */
export const RESERVED_SLUGS = new Set([
  "api",
  "auth",
  "clients",
  "demo",
  "demo-full",
  "login",
  "logout",
  "manifest",
  "privacy",
  "r",
  "s",
  "terms",
  "icon",
  "apple-icon",
  "favicon",
  "settings",
]);

export const MAX_SLUG_LENGTH = 48;

// Polish letters NFD can't take apart (ł has no combining form).
const PL: Record<string, string> = { ł: "l", Ł: "l" };

/**
 * A typed slug (or a pasted website address) as a URL-safe slug:
 * "https://www.olx.pl/oferty" -> "olx", "Łódź Okna" -> "lodz-okna",
 * "Żółta Kawa" -> "zolta-kawa". Polish letters are transliterated instead of
 * dropped ("łódź" used to become "d").
 */
export function normalizeClientSlug(raw: string): string {
  const host = raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    // Only a pasted domain loses its suffix ("olx.pl" -> "olx"); a name
    // with a dot in it ("Kowalski i S.A.") must not be cut down to "kowalski-i-s".
    .replace(/\.[a-z]{2,}(\.[a-z]{2,})?$/i, (m) => (/\s/.test(raw.trim()) ? m : ""));
  return host
    .replace(/[łŁ]/g, (c) => PL[c] ?? c)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
}

export type ClientSlugProblem = "empty" | "reserved";

/** Why this (normalized) slug can't be used, or null. */
export function clientSlugProblem(slug: string): ClientSlugProblem | null {
  if (!slug) return "empty";
  if (RESERVED_SLUGS.has(slug)) return "reserved";
  return null;
}
