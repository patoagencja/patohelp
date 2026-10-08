// Who may log in at all. For now the panel is for the agency only: a login
// link goes out to, and a session is kept for, addresses on these domains.
// LOGIN_ALLOWED_DOMAINS (comma separated) widens it later without a deploy
// of code - "*" lets everyone with an account in again (client users).
// Import-free: the middleware (edge) and the unit tests both use it.

const DEFAULT_DOMAINS = ["patoagencja.com"];

export function allowedLoginDomains(raw: string | undefined = process.env.LOGIN_ALLOWED_DOMAINS): string[] | "*" {
  const value = (raw ?? "").trim();
  if (value === "*") return "*";
  const list = value
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  return list.length ? list : DEFAULT_DOMAINS;
}

export function isLoginAllowed(email: string | null | undefined, raw?: string): boolean {
  const domains = allowedLoginDomains(raw);
  if (domains === "*") return true;
  const at = (email ?? "").trim().toLowerCase().lastIndexOf("@");
  if (at < 1) return false;
  return domains.includes((email ?? "").trim().toLowerCase().slice(at + 1));
}
