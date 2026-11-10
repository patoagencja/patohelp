// Why an OAuth flow came back without a connection, and what to tell the
// agency about it. Every callback used to collapse this into "Nie udało się
// połączyć" - including Google's "Ta aplikacja jest zablokowana" on a Google
// Workspace account, which needs an admin, not another click.
// Import-free: the settings toast (a client component), the /clients panel
// and the unit tests all use it.

export type OAuthFailureReason =
  /** The person cancelled the consent screen (or Google refused it). */
  | "denied"
  /** A Google Workspace policy blocks the app (admin_policy_enforced etc.). */
  | "blocked"
  /** state missing, expired, used, or started by someone else. */
  | "state"
  /** The login works but reaches no account / property of this kind. */
  | "no_access"
  /** Any other error the provider sent back. */
  | "provider";

const REASONS: readonly OAuthFailureReason[] = ["denied", "blocked", "state", "no_access", "provider"];

export function isOAuthFailureReason(value: unknown): value is OAuthFailureReason {
  return typeof value === "string" && (REASONS as readonly string[]).includes(value);
}

/**
 * The reason behind the `error` (and Google's `error_subtype`, Meta's
 * `error_reason`) a provider redirected back with; null when there is none.
 */
export function oauthFailureReason(
  error: string | null | undefined,
  subtype?: string | null
): OAuthFailureReason | null {
  const e = (error ?? "").trim().toLowerCase();
  const s = (subtype ?? "").trim().toLowerCase();
  if (!e && !s) return null;
  // Google: a Workspace admin restricts third-party apps, or the OAuth app
  // is "Internal" to another organisation.
  if (
    ["admin_policy_enforced", "org_internal", "access_blocked"].includes(e) ||
    ["admin_policy_enforced", "org_internal"].includes(s)
  ) {
    return "blocked";
  }
  // Google and Meta: access_denied (Meta adds error_reason=user_denied).
  if (e === "access_denied" || e === "user_denied" || s === "user_denied") return "denied";
  return "provider";
}

/**
 * Where a callback lands after a flow, with the propagation count or the
 * failure reason. A flow whose client is unknown (state lost or forged)
 * lands on the agency list - it used to fall back to /dre/settings, so the
 * agency onboarding any other client was dropped into DRE's settings.
 */
export function oauthDoneUrl(
  origin: string,
  opts: {
    returnTo: "settings" | "clients";
    slug: string | null;
    provider: string;
    ok: boolean;
    fixed?: number;
    reason?: OAuthFailureReason | null;
  }
): string {
  const fixed = opts.fixed ? `&fixed=${opts.fixed}` : "";
  const provider = encodeURIComponent(opts.provider);
  if (opts.returnTo === "clients" || !opts.slug) {
    return opts.ok
      ? `${origin}/clients?reconnected=${provider}${fixed}#polaczenia`
      : `${origin}/clients?conn_error=${provider}${opts.reason ? `&conn_reason=${opts.reason}` : ""}#polaczenia`;
  }
  const base = `${origin}/${encodeURIComponent(opts.slug)}/settings`;
  return opts.ok
    ? `${base}?connected=${provider}${fixed}`
    : `${base}?error=${provider}${opts.reason ? `&reason=${opts.reason}` : ""}`;
}

const LABELS: Record<string, string> = {
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  ga4: "Google Analytics 4",
  tiktok_ads: "TikTok Ads",
};

export function providerLabel(provider: string): string {
  return LABELS[provider] ?? provider;
}

// Google Admin console path (its Polish UI) to trust a third-party app.
const WORKSPACE_FIX =
  "admin.google.com → Bezpieczeństwo → Dostęp do danych i kontrola dostępu → Ustawienia interfejsu API (API controls) → Zarządzaj dostępem aplikacji innych firm → oznacz naszą aplikację jako zaufaną";

/** Polish toast text for a failed connection: a title, maybe a how-to. */
export function oauthFailureMessage(
  provider: string,
  reason: string | null | undefined
): { title: string; description?: string } {
  const label = providerLabel(provider);
  const google = provider === "ga4" || provider === "google_ads";
  const serviceAccount =
    provider === "ga4"
      ? " Dla GA4 jest też droga bez logowania Google: „Połącz przez konto usługi” (nie wygasa)."
      : "";

  switch (isOAuthFailureReason(reason) ? reason : null) {
    case "blocked":
      return {
        title: `Google zablokował połączenie z ${label}: aplikacja nie jest zaufana w Google Workspace tego konta („Ta aplikacja jest zablokowana”).`,
        description: `Administrator domeny musi ją dopuścić: ${WORKSPACE_FIX}. Albo połącz kontem Google spoza tej domeny.${serviceAccount}`,
      };
    case "denied":
      return google
        ? {
            title: `Google nie dał dostępu do ${label} - zgoda została anulowana albo aplikacja jest zablokowana w Google Workspace.`,
            description: `Jeśli Google pokazał „Ta aplikacja jest zablokowana”, administrator domeny musi ją dopuścić: ${WORKSPACE_FIX}.${serviceAccount} Jeśli zgodę anulowano, kliknij „Połącz” jeszcze raz i zaakceptuj wszystkie uprawnienia.`,
          }
        : {
            title: `Nie połączono z ${label} - nie zaakceptowano uprawnień.`,
            description:
              provider === "meta_ads"
                ? "Kliknij „Połącz” jeszcze raz, zaakceptuj uprawnienia i zostaw zaznaczone konta reklamowe tego klienta."
                : "Kliknij „Połącz” jeszcze raz i zaakceptuj uprawnienia.",
          };
    case "state":
      return {
        title: `Połączenie z ${label} wygasło albo zostało otwarte w innej sesji.`,
        description: `Kliknij „Połącz” jeszcze raz - zgodę trzeba dokończyć w ciągu 10 minut, w tej samej przeglądarce i na tym samym koncie Pato.`,
      };
    case "no_access":
      return provider === "ga4"
        ? {
            title: "To konto Google nie ma dostępu do żadnej usługi GA4.",
            description: `Poproś klienta o dostęp (GA4 → Administracja → Zarządzanie dostępem do usługi) i połącz ponownie - albo połącz innym kontem Google.${serviceAccount}`,
          }
        : provider === "google_ads"
          ? {
              title: "To konto Google nie ma dostępu do żadnego konta Google Ads.",
              description:
                "Poproś klienta o dostęp do jego konta Google Ads (albo podepnij je pod nasze konto menedżera) i połącz ponownie - albo połącz innym kontem Google.",
            }
          : {
              title: `To logowanie nie ma dostępu do żadnego konta reklamowego ${label}.`,
              description:
                "Poproś klienta o dostęp do konta reklamowego (np. przez Business Managera) i połącz ponownie - albo zaloguj się innym kontem.",
            };
    case "provider":
      return {
        title: `${label} zwrócił błąd przy łączeniu.`,
        description: "Spróbuj ponownie za chwilę. Jeśli się powtarza, sprawdź konfigurację aplikacji na Vercelu.",
      };
    default:
      return { title: `Nie udało się połączyć z ${label}. Spróbuj ponownie.` };
  }
}
