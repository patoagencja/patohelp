import { cache } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw, type LucideIcon } from "lucide-react";

import {
  getExpiringTokens,
  getUnhealthyIntegrations,
  type ProviderHealth,
} from "@/lib/dashboard/integration-health";
import { cn } from "@/lib/utils";

// Per-request memo: the layout starts the health read as soon as it knows the
// client (preloadIntegrationHealth), and the banner - which only renders after
// the layout's own awaits - picks up the same promise instead of starting late.
// Both helpers swallow their own errors.
const getUnhealthyForRequest = cache(getUnhealthyIntegrations);

export function preloadIntegrationHealth(clientId: string): void {
  void getUnhealthyForRequest(clientId);
}

function since(h: ProviderHealth): string {
  if (h.hoursSinceSuccess === null) return "nigdy się nie zsynchronizowało";
  const days = Math.floor(h.hoursSinceSuccess / 24);
  if (days >= 1) return `brak danych od ${days} ${days === 1 ? "dnia" : "dni"}`;
  const hours = Math.max(1, Math.round(h.hoursSinceSuccess));
  return `brak danych od ${hours} godz.`;
}

/** When the last attempt happened - "failing now" vs "nothing even tried". */
function attempt(h: ProviderHealth): string | null {
  if (h.hoursSinceAttempt === null) return null;
  if (h.hoursSinceAttempt < 1.5) return "ostatnia próba przed chwilą";
  const days = Math.floor(h.hoursSinceAttempt / 24);
  if (days >= 1)
    return `ostatnia próba ${days} ${days === 1 ? "dzień" : "dni"} temu`;
  return `ostatnia próba ${Math.round(h.hoursSinceAttempt)} godz. temu`;
}

/** Providers we can re-authorise straight from here in one click. */
export const RECONNECT_PATH: Partial<Record<ProviderHealth["provider"], string>> = {
  ga4: "/api/integrations/ga4/connect",
  google_ads: "/api/integrations/google-ads/connect",
  meta_ads: "/api/integrations/meta/connect",
  tiktok_ads: "/api/integrations/tiktok/connect",
};

function advice(h: ProviderHealth, clientSlug: string): React.ReactNode {
  const reconnect = RECONNECT_PATH[h.provider];

  // Reconnecting overwrites the stored credentials, so there is no need to
  // disconnect first - link straight at the OAuth flow.
  if (h.tokenExpired && reconnect) {
    // Reconnecting alone just restarts the clock; point at the permanent fix
    // where one exists so this is the last time.
    const permanent =
      h.provider === "meta_ads"
        ? "wklej token, który nie wygasa"
        : h.testingModeSuspected
          ? "Google kasuje token co 7 dni (aplikacja w trybie Testing) - napraw na stałe"
          : null;
    return (
      <>
        token wygasł -{" "}
        <a
          href={`${reconnect}?client=${clientSlug}`}
          className="font-medium text-foreground underline underline-offset-2"
        >
          połącz ponownie jednym kliknięciem
        </a>
        {permanent ? (
          <>
            {" "}
            albo{" "}
            <Link
              href={`/${clientSlug}/settings#polaczenia`}
              className="font-medium text-foreground underline underline-offset-2"
            >
              {permanent}
            </Link>
          </>
        ) : null}
        .
      </>
    );
  }
  return (
    <>
      sprawdź połączenie w{" "}
      <Link
        href={`/${clientSlug}/settings`}
        className="font-medium text-foreground underline underline-offset-2"
      >
        Ustawieniach
      </Link>
      {reconnect ? (
        <>
          {" "}
          lub{" "}
          <a
            href={`${reconnect}?client=${clientSlug}`}
            className="font-medium text-foreground underline underline-offset-2"
          >
            połącz ponownie
          </a>
        </>
      ) : null}
      .
    </>
  );
}

/**
 * One health note (Stany board): a soft rounded strip inside the page
 * gutters with an icon tile, an optional bold title + "Widzi tylko
 * agencja" chip, and the details. Presentational; exported so states can be
 * previewed without a database.
 */
export function HealthNote({
  tone,
  icon: Icon,
  title,
  chip,
  role,
  children,
}: {
  tone: "warning" | "neutral";
  icon: LucideIcon;
  title?: React.ReactNode;
  chip?: string;
  role?: "status";
  children: React.ReactNode;
}) {
  return (
    <div
      role={role}
      className={cn(
        "mx-4 mt-4 flex items-start gap-3.5 rounded-[22px] py-3.5 pl-3.5 pr-4 sm:mx-6 sm:pl-[18px] print:hidden",
        tone === "warning" ? "bg-warning-soft" : "bg-chip"
      )}
    >
      <span
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-card shadow-card dark:bg-chip dark:shadow-none",
          tone === "warning" ? "text-warning" : "text-ink-2"
        )}
      >
        <Icon className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-1 pt-0.5 text-sm leading-relaxed text-ink-2">
        {title || chip ? (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {title ? <p className="text-[15px] font-semibold text-foreground">{title}</p> : null}
            {chip ? (
              <span className="inline-flex h-6 items-center rounded-full bg-card px-2.5 text-xs font-semibold text-ink-2 dark:bg-chip">
                {chip}
              </span>
            ) : null}
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}

/**
 * Warns when a configured integration has stopped delivering data. The header's
 * "Zaktualizowano X temu" shows the newest success across ALL providers, so one
 * dead source stays invisible there - this names it explicitly instead.
 */
export async function IntegrationHealthBanner({
  clientId,
  clientSlug,
  isAgency = false,
}: {
  clientId: string;
  clientSlug: string;
  isAgency?: boolean;
}) {
  const [health, expiring] = await Promise.all([
    getUnhealthyForRequest(clientId),
    // Upcoming expiry is our housekeeping - clients don't need to see it.
    isAgency ? getExpiringTokens(clientId) : Promise.resolve([]),
  ]);
  // Just reconnected: the failure is fixed, the data just hasn't arrived yet.
  // Say that calmly instead of repeating the old "token wygasł".
  const unhealthy = health.filter((h) => !h.reconnected);
  const catchingUp = health.filter((h) => h.reconnected);
  const upcoming = expiring.filter(
    (e) => !health.some((u) => u.provider === e.provider)
  );

  const catchingUpNote = catchingUp.length ? (
    <HealthNote tone="neutral" icon={RefreshCw}>
      {catchingUp.map((h) => (
        <p key={h.provider}>
          <span className="font-medium text-foreground">{h.label}</span>: połączone
          ponownie - brakujące dane dociągniemy przy najbliższej synchronizacji
          (zwykle do 30 min).
        </p>
      ))}
    </HealthNote>
  ) : null;

  if (!unhealthy.length) {
    if (!upcoming.length) return catchingUpNote;
    return (
      <>
        {catchingUpNote}
        <HealthNote
          tone="warning"
          icon={AlertTriangle}
          title={upcoming.length === 1 ? "Token wkrótce wygaśnie" : "Tokeny wkrótce wygasną"}
          chip="Widzi tylko agencja"
        >
          {upcoming.map((e) => (
            <p key={e.provider}>
              <span className="font-medium text-foreground">{e.label}</span>: token wygaśnie za{" "}
              {e.daysLeft} {e.daysLeft === 1 ? "dzień" : "dni"} -{" "}
              <Link
                href={`/${clientSlug}/settings#polaczenia`}
                className="font-medium text-foreground underline underline-offset-2"
              >
                wklej token, który nie wygasa
              </Link>
              , żeby dane się nie urwały.
            </p>
          ))}
        </HealthNote>
      </>
    );
  }

  return (
    <>
      {catchingUpNote}
      <HealthNote
        role="status"
        tone="warning"
        icon={AlertTriangle}
        title={
          <>
            {unhealthy.length === 1
              ? "Jedno źródło danych nie działa"
              : "Kilka źródeł danych nie działa"}{" "}
            - liczby poniżej są niepełne.
          </>
        }
      >
        <ul className="space-y-0.5">
          {unhealthy.map((h) => (
            <li key={h.provider}>
              <span className="font-medium text-foreground">{h.label}</span>: {since(h)}
              {attempt(h) ? ` (${attempt(h)})` : ""}, {isAgency ? (
                advice(h, clientSlug)
              ) : (
                // Clients can't reconnect integrations (agency-only routes);
                // tell them it's handled instead of showing dead links.
                <>agencja widzi ten problem w swoim panelu.</>
              )}
              {/* The raw provider error, for us only: "token wygasł" is a
                  guess from keywords, and the actual message is what tells
                  an expired token apart from a key/env/rate-limit problem. */}
              {isAgency && h.lastError ? (
                <span className="mt-0.5 block break-words text-xs text-muted-foreground">
                  Błąd: {h.lastError.length > 300 ? `${h.lastError.slice(0, 300)}…` : h.lastError}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </HealthNote>
    </>
  );
}
