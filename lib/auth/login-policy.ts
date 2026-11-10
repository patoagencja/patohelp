// Who may log in at all. The agency's own domains (LOGIN_ALLOWED_DOMAINS,
// comma separated, default @patoagencja.com; "*" lets every account in), plus
// - once CLIENT_LOGIN_ENABLED is on - the client users the agency invited in
// "Dostęp do panelu". Sign-up is NOT open: an address with no invitation and
// no client seat gets neither a login link nor a session.
// Import-free: the middleware (edge) and the unit tests both use it.

const DEFAULT_DOMAINS = ["patoagencja.com"];

/**
 * Invited client users may log in only once this is switched on
 * (CLIENT_LOGIN_ENABLED=1 in Vercel). Off by default: until the panel is
 * sold, nobody outside the agency's mailboxes gets in, invited or not.
 */
export function clientLoginEnabled(raw: string | undefined = process.env.CLIENT_LOGIN_ENABLED): boolean {
  return ["1", "true", "on", "yes"].includes((raw ?? "").trim().toLowerCase());
}

export function allowedLoginDomains(raw: string | undefined = process.env.LOGIN_ALLOWED_DOMAINS): string[] | "*" {
  const value = (raw ?? "").trim();
  if (value === "*") return "*";
  const list = value
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  return list.length ? list : DEFAULT_DOMAINS;
}

/** The domain rule alone (agency domains, or everyone with "*"). */
export function isLoginAllowed(email: string | null | undefined, raw?: string): boolean {
  const domains = allowedLoginDomains(raw);
  if (domains === "*") return true;
  const at = (email ?? "").trim().toLowerCase().lastIndexOf("@");
  if (at < 1) return false;
  return domains.includes((email ?? "").trim().toLowerCase().slice(at + 1));
}

/** The `users` row fields that decide access (public.users). */
export interface PanelProfile {
  role?: string | null;
  client_id?: string | null;
}

/**
 * A client account with a client assigned. Only the agency hands one out
 * (an invitation mapped by /auth/callback, or "Nadaj dostęp" on an existing
 * account); "Odbierz dostęp" clears it.
 */
export function hasClientSeat(profile: PanelProfile | null | undefined): boolean {
  return (
    !!profile &&
    profile.role === "client" &&
    typeof profile.client_id === "string" &&
    profile.client_id.length > 0
  );
}

/** A client_invitations row as the login check reads it. */
export interface InvitationLike {
  email?: string | null;
  role?: string | null;
}

/**
 * Whether one of `rows` is a CLIENT invitation for exactly this address. The
 * lookup is case-insensitive (ilike), so the exact comparison happens here;
 * agency-role invitations (hand-made) never open the login to an outside
 * domain - those are agency staff and belong on LOGIN_ALLOWED_DOMAINS.
 */
export function hasClientInvitation(rows: InvitationLike[] | null | undefined, email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return (rows ?? []).some(
    (r) => r.role === "client" && (r.email ?? "").trim().toLowerCase() === normalized
  );
}

/**
 * May this address be sent a login link? Agency domains, or an address the
 * agency invited (a pending invitation, or an account that already holds a
 * client seat). Nothing else: no open sign-up.
 */
export function mayRequestLoginLink(
  email: string,
  access: { invitations?: InvitationLike[] | null; profiles?: (PanelProfile & { email?: string | null })[] | null },
  raw?: string,
  clientLoginRaw?: string
): boolean {
  if (isLoginAllowed(email, raw)) return true;
  if (!clientLoginEnabled(clientLoginRaw)) return false;
  if (hasClientInvitation(access.invitations, email)) return true;
  const normalized = email.trim().toLowerCase();
  return (access.profiles ?? []).some(
    (p) => (p.email ?? "").trim().toLowerCase() === normalized && hasClientSeat(p)
  );
}

/**
 * May this signed-in user keep a session? Agency domains as before; anyone
 * else only as a client user with a seat AND a verified address - the seat
 * comes from an invitation by e-mail, and only a clicked e-mail link proves
 * the person holds that mailbox (migration 0041).
 */
export function isSessionAllowed(
  user: { email?: string | null; email_confirmed_at?: string | null },
  profile: PanelProfile | null | undefined,
  raw?: string,
  clientLoginRaw?: string
): boolean {
  if (isLoginAllowed(user.email, raw)) return true;
  if (!clientLoginEnabled(clientLoginRaw)) return false;
  return Boolean(user.email_confirmed_at) && hasClientSeat(profile);
}
