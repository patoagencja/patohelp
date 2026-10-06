import { cache } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";

import {
  getExpiringTokens,
  getUnhealthyIntegrations,
  type ProviderHealth,
} from "@/lib/dashboard/integration-health";

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
          className="font-medium underline underline-offset-2"
        >
          połącz ponownie jednym kliknięciem
        </a>
        {permanent ? (
          <>
            {" "}
            albo{" "}
            <Link
              href={`/${clientSlug}/settings#polaczenia`}
              className="font-medium underline underline-offset-2"
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
        className="font-medium underline underline-offset-2"
      >
        Ustawieniach
      </Link>
      {reconnect ? (
        <>
          {" "}
          lub{" "}
          <a
            href={`${reconnect}?client=${clientSlug}`}
            className="font-medium underline underline-offset-2"
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
    <div className="border-b border-hairline bg-muted/40 px-6 py-2 text-sm text-muted-foreground print:hidden">
      {catchingUp.map((h) => (
        <p key={h.provider} className="flex items-start gap-2">
          <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            <span className="font-medium text-foreground">{h.label}</span>: połączone
            ponownie - brakujące dane dociągniemy przy najbliższej synchronizacji
            (zwykle do 30 min).
          </span>
        </p>
      ))}
    </div>
  ) : null;

  if (!unhealthy.length) {
    if (!upcoming.length) return catchingUpNote;
    return (
      <>
      {catchingUpNote}
      <div className="border-b border-amber-500/30 bg-amber-500/5 px-6 py-2 text-sm text-amber-800 dark:text-amber-300/90 print:hidden">
        {upcoming.map((e) => (
          <p key={e.provider} className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <span className="font-medium">{e.label}</span>: token wygaśnie za{" "}
              {e.daysLeft} {e.daysLeft === 1 ? "dzień" : "dni"} -{" "}
              <Link
                href={`/${clientSlug}/settings#polaczenia`}
                className="font-medium underline underline-offset-2"
              >
                wklej token, który nie wygasa
              </Link>
              , żeby dane się nie urwały.
            </span>
          </p>
        ))}
      </div>
      </>
    );
  }

  return (
    <>
    {catchingUpNote}
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-6 py-3 print:hidden">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
        <div className="text-sm">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            {unhealthy.length === 1
              ? "Jedno źródło danych nie działa"
              : "Kilka źródeł danych nie działa"}{" "}
            - liczby poniżej są niepełne.
          </p>
          <ul className="mt-1 space-y-0.5 text-amber-800 dark:text-amber-300/90">
            {unhealthy.map((h) => (
              <li key={h.provider}>
                <span className="font-medium">{h.label}</span>: {since(h)}
                {attempt(h) ? ` (${attempt(h)})` : ""}, {isAgency ? (
                  advice(h, clientSlug)
                ) : (
                  // Clients can't reconnect integrations (agency-only routes);
                  // tell them it's handled instead of showing dead links.
                  <>agencja widzi ten problem w swoim panelu.</>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
    </>
  );
}
