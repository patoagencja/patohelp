import { cache, Fragment } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CircleAlert,
  PauseCircle,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";

import {
  getExpiringTokens,
  getIdleAdSources,
  getPartialSyncFailures,
  getUnhealthyIntegrations,
  type IdleAdSource,
  type PartialSyncFailure,
  type ProviderHealth,
} from "@/lib/dashboard/integration-health";
import { isMetaSessionInvalidated } from "@/lib/integrations/errors";
import { cn } from "@/lib/utils";

// Per-request memo: the layout starts the health read as soon as it knows the
// client (preloadIntegrationHealth), and the banner - which only renders after
// the layout's own awaits - picks up the same promise instead of starting late.
// The helpers swallow their own errors.
const getUnhealthyForRequest = cache(getUnhealthyIntegrations);
const getIdleForRequest = cache(getIdleAdSources);

export function preloadIntegrationHealth(clientId: string): void {
  void getUnhealthyForRequest(clientId);
  void getIdleForRequest(clientId);
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

const LINK = "font-medium text-foreground underline underline-offset-2";

function advice(h: ProviderHealth, clientSlug: string): React.ReactNode {
  const reconnect = RECONNECT_PATH[h.provider];

  if (h.provider === "meta_ads" && isMetaSessionInvalidated(h.lastError)) {
    return (
      <>
        Facebook unieważnił sesję (ktoś zmienił hasło do konta, którym podpięto
        klientów, albo Facebook zresetował ją ze względów bezpieczeństwa) - zwykły
        token z logowania przestał działać i nie wróci sam. Rozwiązanie na stałe:{" "}
        <Link href={`/${clientSlug}/settings#meta-system-token`} className={LINK}>
          wklej token System User, który nie wygasa i nie zależy od hasła
        </Link>
        {reconnect ? (
          <>
            {" "}
            (albo na szybko{" "}
            <a href={`${reconnect}?client=${clientSlug}`} className={LINK}>
              połącz ponownie
            </a>{" "}
            - naprawi też innych klientów z tym samym logowaniem)
          </>
        ) : null}
        .
      </>
    );
  }

  // Google refresh tokens dying ~7 days after consent = OAuth app in Testing.
  // Another reconnect only buys another week; say exactly where to fix it.
  if (h.tokenExpired && h.testingModeSuspected) {
    return (
      <>
        <b className="font-semibold text-foreground">
          Aplikacja Google jest w trybie Testing - tokeny wygasają po 7 dniach.
        </b>{" "}
        Napraw: Google Cloud Console → APIs &amp; Services → OAuth consent screen →
        Publish app (
        <Link href={`/${clientSlug}/settings#google-stability`} className={LINK}>
          który projekt
        </Link>
        ), potem{" "}
        {reconnect ? (
          <a href={`${reconnect}?client=${clientSlug}`} className={LINK}>
            połącz ponownie
          </a>
        ) : (
          "połącz ponownie"
        )}{" "}
        - naprawi to wszystkich klientów z tym samym kontem Google
        {h.provider === "ga4" ? (
          <>
            {" "}
            (albo{" "}
            <Link href={`/${clientSlug}/settings/ga4-service-account`} className={LINK}>
              podłącz GA4 przez konto usługi
            </Link>
            )
          </>
        ) : null}
        .
      </>
    );
  }

  // Reconnecting overwrites the stored credentials, so there is no need to
  // disconnect first - link straight at the OAuth flow.
  if (h.tokenExpired && reconnect) {
    // Reconnecting alone just restarts the clock; point at the permanent fix
    // where one exists so this is the last time.
    const permanent =
      h.provider === "meta_ads"
        ? { text: "wklej token, który nie wygasa", href: `/${clientSlug}/settings#meta-system-token` }
        : h.provider === "ga4"
          ? {
              text: "połącz przez konto usługi (nie wygasa)",
              href: `/${clientSlug}/settings/ga4-service-account`,
            }
          : null;
    return (
      <>
        token wygasł -{" "}
        <a href={`${reconnect}?client=${clientSlug}`} className={LINK}>
          połącz ponownie jednym kliknięciem
        </a>{" "}
        (naprawi też innych klientów z tym samym logowaniem)
        {permanent ? (
          <>
            {" "}
            albo{" "}
            <Link href={permanent.href} className={LINK}>
              {permanent.text}
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

/** Provider errors can be long (five accounts joined); one line is enough. */
function shortError(message: string): string {
  return message.length > 160 ? `${message.slice(0, 160)}…` : message;
}

/**
 * The calm notes about WORKING sources: an ad platform with nothing running
 * (so an empty chart doesn't read as a broken sync) and, for us, accounts that
 * error inside an otherwise fine sync.
 */
function QuietNotes({
  idle,
  partial,
}: {
  idle: IdleAdSource[];
  partial: PartialSyncFailure[];
}) {
  return (
    <>
      {idle.length ? (
        // One strip however many sources are quiet: reassurance, not an alarm.
        <HealthNote tone="neutral" icon={PauseCircle}>
          <p>
            {idle.map((s, i) => (
              <Fragment key={s.provider}>
                {i > 0 ? "; " : null}
                <span className="font-medium text-foreground">{s.label}</span>: od {s.daysIdle}{" "}
                dni żadna reklama się nie wyświetla
              </Fragment>
            ))}{" "}
            - dane spływają normalnie, kampanie są po prostu wstrzymane.
          </p>
        </HealthNote>
      ) : null}
      {partial.length ? (
        <HealthNote tone="neutral" icon={CircleAlert} chip="Widzi tylko agencja">
          {partial.map((p) => (
            <p key={p.provider} className="break-words">
              <span className="font-medium text-foreground">{p.label}</span>: część
              kont zwraca błąd: {shortError(p.error)}
            </p>
          ))}
        </HealthNote>
      ) : null}
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
  const [health, expiring, idleSources, partialFailures] = await Promise.all([
    getUnhealthyForRequest(clientId),
    // Upcoming expiry is our housekeeping - clients don't need to see it.
    isAgency ? getExpiringTokens(clientId) : Promise.resolve([]),
    getIdleForRequest(clientId),
    // Which of the client's accounts error is ours to chase, not theirs.
    isAgency ? getPartialSyncFailures(clientId) : Promise.resolve([]),
  ]);
  // Just reconnected: the failure is fixed, the data just hasn't arrived yet.
  // Say that calmly instead of repeating the old "token wygasł".
  const unhealthy = health.filter((h) => !h.reconnected);
  const catchingUp = health.filter((h) => h.reconnected);
  const upcoming = expiring.filter(
    (e) => !health.some((u) => u.provider === e.provider)
  );
  // A provider already named as broken or catching up gets just that message.
  const quietNotes = (
    <QuietNotes
      idle={idleSources.filter((s) => !health.some((u) => u.provider === s.provider))}
      partial={partialFailures.filter((p) => !health.some((u) => u.provider === p.provider))}
    />
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
    if (!upcoming.length) {
      return (
        <>
          {catchingUpNote}
          {quietNotes}
        </>
      );
    }
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
                href={`/${clientSlug}/settings#meta-system-token`}
                className="font-medium text-foreground underline underline-offset-2"
              >
                wklej token, który nie wygasa
              </Link>
              , żeby dane się nie urwały.
            </p>
          ))}
        </HealthNote>
        {quietNotes}
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
      {quietNotes}
    </>
  );
}
