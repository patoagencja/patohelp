import type { SupabaseClient } from "@supabase/supabase-js";

// The client's website (clients.website_url, migration 0032) - the address
// "Pobierz ze strony" fetches the logo and colour from. Pure helpers, safe to
// import from client components; the network side lives in ./fetch.ts.

export const WEBSITE_URL_MAX = 300;

// Names that only resolve inside a network. The fetcher also checks every
// resolved IP, this just gives a clear error before any DNS lookup.
const INTERNAL_SUFFIXES = [
  "localhost", "local", "internal", "lan", "home", "corp", "intranet",
  "localdomain", "home.arpa", "in-addr.arpa", "ip6.arpa", "test", "invalid",
];

export type UrlProblem = "invalid" | "protocol" | "credentials" | "port" | "ip" | "internal" | "too_long";

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Why we won't fetch this URL, or null when its SHAPE is fine. Used for the
 * typed URL and for every redirect hop (fetch.ts) - where the IP check after
 * DNS resolution is the real SSRF guard.
 */
export function urlProblem(url: URL): UrlProblem | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") return "protocol";
  if (url.username || url.password) return "credentials";
  // WHATWG URL drops default ports, so a non-empty port is a custom one;
  // 80/443 are still tolerated when written explicitly.
  if (url.port !== "" && url.port !== "80" && url.port !== "443") return "port";
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return "invalid";
  // The URL parser already turned "0x7f.1" / "2130706433" into dotted IPv4.
  if (host.startsWith("[") || IPV4_RE.test(host)) return "ip";
  if (!host.includes(".")) return "internal";
  if (INTERNAL_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))) return "internal";
  return null;
}

export const URL_PROBLEM_MESSAGE: Record<UrlProblem, string> = {
  invalid: "Podaj pełny adres strony, np. https://www.firma.pl",
  protocol: "Obsługujemy tylko adresy http:// i https://",
  credentials: "Adres nie może zawierać loginu ani hasła.",
  port: "Obsługujemy tylko standardowe porty (80 i 443).",
  ip: "Podaj adres domeny (np. firma.pl), a nie adres IP.",
  internal: "To nie wygląda na publiczny adres strony.",
  too_long: `Adres może mieć maksymalnie ${WEBSITE_URL_MAX} znaków.`,
};

/**
 * "dre.pl" / "www.dre.pl/" / "https://dre.pl/pl" -> canonical absolute URL,
 * or a problem code. Adds https:// when the scheme is missing.
 */
export function parseWebsiteUrl(raw: string): { ok: true; url: string } | { ok: false; problem: UrlProblem } {
  const v = raw.trim();
  if (!v || /\s/.test(v)) return { ok: false, problem: "invalid" };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) && !/^[^/:]+:\d+(\/|$)/.test(v) ? v : `https://${v.replace(/^\/+/, "")}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, problem: "invalid" };
  }
  const problem = urlProblem(url);
  if (problem) return { ok: false, problem };
  url.hash = "";
  const out = url.toString();
  if (out.length > WEBSITE_URL_MAX) return { ok: false, problem: "too_long" };
  return { ok: true, url: out };
}

export function safeWebsiteUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = parseWebsiteUrl(value);
  return parsed.ok ? parsed.url : null;
}

// A domain inside free text, e.g. a GA4 property called "dre.pl - GA4" or
// "www.dre.pl". The (?<!@) guard is spelled out as a manual check below
// because lookbehind needs an ES2018 target.
const DOMAIN_IN_TEXT_RE = /(?:https?:\/\/)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(?![a-z0-9-])/gi;

export function domainFromText(text: string): string | null {
  for (const m of text.matchAll(DOMAIN_IN_TEXT_RE)) {
    const before = m.index !== undefined && m.index > 0 ? text[m.index - 1] : "";
    if (before === "@") continue; // e-mail address, not a site
    const host = m[1].toLowerCase();
    if (/^\d+(\.\d+)+$/.test(host)) continue;
    const parsed = parseWebsiteUrl(host);
    if (parsed.ok) return host;
  }
  return null;
}

export interface ClientWebsite {
  /** False before migration 0032 (the column is missing). */
  available: boolean;
  websiteUrl: string | null;
  /** A guess for an empty field, from data we ALREADY store (no API calls). */
  suggestion: string | null;
}

interface Ga4StoredAccountIds {
  propertyId?: string | null;
  properties?: Array<{ propertyId?: string; displayName?: string; accountName?: string }>;
}

/**
 * The stored website, plus - when it's empty - a suggestion from the GA4
 * property list the OAuth callback saved in integrations.account_ids. GA4
 * properties are very often named after the domain ("dre.pl"). We never
 * call the GA4 Admin API for this: data streams' defaultUri would need an
 * extra request on page load.
 */
export async function getClientWebsite(supabase: SupabaseClient, clientId: string): Promise<ClientWebsite> {
  const { data, error } = await supabase.from("clients").select("website_url").eq("id", clientId).maybeSingle();
  const available = !error;
  const websiteUrl = available ? safeWebsiteUrl((data as { website_url?: unknown } | null)?.website_url) : null;
  if (websiteUrl) return { available, websiteUrl, suggestion: null };

  const { data: ga4 } = await supabase
    .from("integrations")
    .select("account_ids")
    .eq("client_id", clientId)
    .eq("provider", "ga4")
    .maybeSingle();
  const ids = ((ga4 as { account_ids?: unknown } | null)?.account_ids ?? {}) as Ga4StoredAccountIds;
  const properties = Array.isArray(ids.properties) ? ids.properties : [];
  // Only the property tracked for THIS client - or the only one there is.
  const selected =
    properties.find((p) => ids.propertyId && p.propertyId === ids.propertyId) ??
    (properties.length === 1 ? properties[0] : undefined);
  const domain = selected
    ? domainFromText(selected.displayName ?? "") ?? domainFromText(selected.accountName ?? "")
    : null;
  return { available, websiteUrl: null, suggestion: domain ? `https://${domain}/` : null };
}
