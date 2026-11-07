// "Strażnik sklepu", part 1: is the client's website up? The pure half - the
// state machine, how a failed check reads in Polish, what to check, outage
// durations, uptime, the line in Ustawienia, the Alerty card and the e-mails.
//
// Pure and import-free (no "@/", no date library): the unit tests run this
// file directly under Node's type stripping. Times come in as epoch ms, and
// clock labels ("10:05") come in already formatted - the callers format
// Europe/Warsaw with date-fns-tz.
//
// Where things run: the checks run INSIDE Supabase every 5 minutes (pg_cron
// + pg_net, migration 0045), not as Vercel functions - the plan's function
// limits are tight. public.site_guard_apply there is the SQL twin of
// stepSiteState below: keep the two in step. The app only reads the result
// (lib/alerts/site-guard-read.ts) and, when the state CHANGES, the database
// wakes app/api/cron/site-guard to send the e-mail.

/** pg_cron runs the check every 5 minutes. */
export const CHECK_EVERY_MIN = 5;
/** pg_net timeout per request. */
export const CHECK_TIMEOUT_S = 10;
/** DOWN after this many failed checks in a row (~15 min). */
export const DOWN_AFTER_FAILS = 3;
/** UP again after this many good checks in a row. */
export const UP_AFTER_OKS = 2;
/** A new DOWN e-mail waits this long after the previous one (flapping site). */
export const FLAP_GUARD_MIN = 120;
/** No check collected for this long: the guard itself is stuck. */
export const STALE_AFTER_MIN = 20;
/** Uptime window shown in Ustawienia (site_checks keeps 35 days). */
export const UPTIME_DAYS = 30;
/** Below this many checks with a verdict (2 hours) no uptime is shown. */
export const UPTIME_MIN_CHECKS = 24;

const MINUTE = 60_000;

// ---------------------------------------------------------------- state machine

export type SiteState = "up" | "down";

export interface SiteMachine {
  state: SiteState;
  /** When the current state began (epoch ms). */
  since: number;
  failStreak: number;
  okStreak: number;
  /** First check of the current streak (good or failed). */
  streakSince: number | null;
  /** First failed check of the current / last outage. */
  downSince: number | null;
}

export interface SiteCheck {
  at: number;
  /**
   * true = 2xx/3xx; false = 5xx/4xx, timeout, DNS/TLS/connection error;
   * null = no verdict (a firewall's 401/403/429, a lost answer, or a
   * transport error while our own control request failed too).
   */
  ok: boolean | null;
}

/** A newly watched site starts as up. */
export function initialSiteMachine(at: number): SiteMachine {
  return { state: "up", since: at, failStreak: 0, okStreak: 0, streakSince: null, downSince: null };
}

/**
 * One check, oldest first. DOWN after DOWN_AFTER_FAILS failures in a row,
 * dated from the first of them; UP after UP_AFTER_OKS good checks in a row,
 * dated from the first good one (the outage is downSince -> since). A check
 * without a verdict changes nothing - it neither breaks nor extends a streak.
 */
export function stepSiteState(
  m: SiteMachine,
  check: SiteCheck
): { machine: SiteMachine; transition: SiteState | null } {
  if (check.ok === null) return { machine: m, transition: null };
  if (check.ok) {
    const streakSince = m.okStreak === 0 ? check.at : m.streakSince ?? check.at;
    const next: SiteMachine = { ...m, okStreak: m.okStreak + 1, failStreak: 0, streakSince };
    if (m.state === "down" && next.okStreak >= UP_AFTER_OKS) {
      return { machine: { ...next, state: "up", since: streakSince }, transition: "up" };
    }
    return { machine: next, transition: null };
  }
  const streakSince = m.failStreak === 0 ? check.at : m.streakSince ?? check.at;
  const next: SiteMachine = { ...m, failStreak: m.failStreak + 1, okStreak: 0, streakSince };
  if (m.state === "up" && next.failStreak >= DOWN_AFTER_FAILS) {
    return {
      machine: { ...next, state: "down", since: streakSince, downSince: streakSince },
      transition: "down",
    };
  }
  return { machine: next, transition: null };
}

// ---------------------------------------------------------------- what we saw

export type FailureKind =
  | "http_5xx"
  | "http_missing"
  | "http_other"
  | "timeout"
  | "dns"
  | "tls"
  | "connect"
  | "unknown";

export type CheckKind = "ok" | "blocked" | "lost" | FailureKind;

/** Robots blocked by a firewall / rate limit: says nothing about the site. */
const BLOCKED_STATUSES: ReadonlySet<number> = new Set([401, 403, 429]);

/** The SQL's marker for an answer pg_net never delivered. */
const LOST_MARKER = "no response (pg_net)";

/**
 * A check's HTTP status / pg_net (libcurl) error -> kind. Same split as the
 * SQL verdict: 2xx/3xx ok, 401/403/429 blocked, any other status failed.
 */
export function classifyCheck(httpStatus: number | null, error: string | null): CheckKind {
  if (httpStatus !== null && httpStatus > 0) {
    if (httpStatus >= 200 && httpStatus < 400) return "ok";
    if (BLOCKED_STATUSES.has(httpStatus)) return "blocked";
    if (httpStatus >= 500) return "http_5xx";
    if (httpStatus === 404 || httpStatus === 410) return "http_missing";
    return "http_other";
  }
  const e = (error ?? "").toLowerCase();
  if (e.includes(LOST_MARKER)) return "lost";
  // Order matters: "Connection timed out" is a timeout, "SSL connect error" TLS.
  if (/timeout|timed out/.test(e)) return "timeout";
  if (/resolve|name or service|getaddrinfo|nxdomain|\bdns\b/.test(e)) return "dns";
  if (/ssl|tls|certificate|handshake/.test(e)) return "tls";
  if (/connect|refused|reset|unreachable|no route/.test(e)) return "connect";
  return "unknown";
}

const isCloudflareStatus = (s: number | null) => s !== null && s >= 520 && s <= 530;

const HTTP_NOTE: Record<number, string> = {
  500: "wewnętrzny błąd serwera",
  502: "błąd bramy - serwer za nią nie odpowiada",
  503: "usługa niedostępna - przeciążenie albo prace serwisowe",
  504: "serwer za bramą nie odpowiedział na czas",
};

/** "serwer odpowiada błędem HTTP 503 (usługa niedostępna - ...)" - for a sentence. */
export function failureText(kind: CheckKind, httpStatus: number | null): string {
  switch (kind) {
    case "http_5xx": {
      const note = isCloudflareStatus(httpStatus)
        ? "Cloudflare nie może połączyć się z serwerem strony"
        : httpStatus !== null
          ? HTTP_NOTE[httpStatus]
          : undefined;
      return `serwer odpowiada błędem HTTP ${httpStatus ?? "5xx"}${note ? ` (${note})` : ""}`;
    }
    case "http_missing":
      return `serwer odpowiada „nie znaleziono” (HTTP ${httpStatus ?? 404}) - strony głównej nie ma pod tym adresem`;
    case "http_other":
      return `serwer odpowiada błędem HTTP ${httpStatus ?? "4xx"}`;
    case "blocked":
      return `strona odrzuca automatyczne sprawdzanie (HTTP ${httpStatus ?? 403})`;
    case "timeout":
      return `strona nie odpowiedziała w ciągu ${CHECK_TIMEOUT_S} s`;
    case "dns":
      return "nie da się odnaleźć domeny - adres nie wskazuje na żaden serwer (DNS)";
    case "tls":
      return "błąd połączenia szyfrowanego - certyfikat SSL jest nieważny albo wygasł";
    case "connect":
      return "serwer odrzuca połączenie";
    case "lost":
      return "brak wyniku sprawdzenia";
    case "ok":
      return "strona odpowiada poprawnie";
    default:
      return "nie udało się połączyć ze stroną";
  }
}

/** Two-word version for the one-line status: "HTTP 503", "błąd DNS". */
export function failureShort(kind: CheckKind, httpStatus: number | null): string {
  switch (kind) {
    case "http_5xx":
    case "http_missing":
    case "http_other":
    case "blocked":
      return `HTTP ${httpStatus ?? "?"}`;
    case "timeout":
      return `brak odpowiedzi w ${CHECK_TIMEOUT_S} s`;
    case "dns":
      return "błąd DNS";
    case "tls":
      return "błąd certyfikatu SSL";
    case "connect":
      return "połączenie odrzucone";
    default:
      return "błąd połączenia";
  }
}

const HINT = {
  hosting:
    "Hosting: czy serwer działa i nie skończył się limit zasobów ani abonament - panel i strona statusu dostawcy.",
  load: "Hosting: czy serwer nie jest przeciążony (limit zasobów, nagły ruch, boty) - panel i strona statusu dostawcy.",
  recent:
    "Ostatnie zmiany: aktualizacja sklepu, wtyczek albo motywu tuż przed awarią (logi błędów serwera).",
  domain: "Domena: czy nie wygasła - opłacenie u rejestratora.",
  dns: "DNS: czy rekordy A/CNAME wskazują na właściwy serwer (zmiany potrafią rozchodzić się kilka godzin).",
  ssl: "Certyfikat SSL: czy nie wygasł (np. Let's Encrypt nie odnowił się sam) i czy obejmuje adres z www i bez www.",
  firewall: "Zapora / CDN (np. Cloudflare): czy nie blokuje ruchu i ma połączenie z serwerem strony.",
  missing:
    "Strona główna: czy nie została usunięta, przeniesiona albo wyłączona (tryb konserwacji, przekierowania).",
} as const;

/** "Co sprawdzić" - the likeliest causes first. */
export function whatToCheck(kind: CheckKind, httpStatus: number | null): string[] {
  switch (kind) {
    case "tls":
      return [HINT.ssl, HINT.hosting];
    case "dns":
      return [HINT.domain, HINT.dns];
    case "timeout":
      return [HINT.load, HINT.firewall];
    case "connect":
      return [HINT.hosting, HINT.dns];
    case "http_5xx":
      return isCloudflareStatus(httpStatus) ? [HINT.firewall, HINT.hosting] : [HINT.hosting, HINT.recent];
    case "http_missing":
      return [HINT.missing, HINT.recent];
    default:
      return [HINT.hosting, HINT.domain, HINT.ssl];
  }
}

// ---------------------------------------------------------------- numbers

/** "42 min", "1 godz. 5 min", "2 dni 3 godz." (at least 1 min). */
export function durationText(ms: number): string {
  const totalMin = Math.max(1, Math.round(ms / MINUTE));
  if (totalMin < 60) return `${totalMin} min`;
  const hours = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (hours < 24) return min ? `${hours} godz. ${min} min` : `${hours} godz.`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  const dayText = `${days} ${days === 1 ? "dzień" : "dni"}`;
  return restHours ? `${dayText} ${restHours} godz.` : dayText;
}

/** "przed chwilą", "3 min temu", "2 godz. temu". */
export function agoText(ms: number): string {
  return ms < MINUTE ? "przed chwilą" : `${durationText(ms)} temu`;
}

/** Share of good checks among those with a verdict; null with too few. */
export function uptimePercent(okChecks: number, checksWithVerdict: number): number | null {
  if (!(checksWithVerdict >= UPTIME_MIN_CHECKS)) return null;
  const ok = Math.max(0, Math.min(okChecks, checksWithVerdict));
  return (ok / checksWithVerdict) * 100;
}

/**
 * "99,9%" / "100%". Rounded DOWN: a site that was down for a while must not
 * read "100%" (the epsilon only undoes float noise, e.g. 99.7 * 10).
 */
export function formatUptime(pct: number): string {
  if (pct >= 100) return "100%";
  const v = Math.floor(Math.max(0, pct) * 10 + 1e-9) / 10;
  return `${v.toFixed(1).replace(".", ",")}%`;
}

function plPlural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.round(n));
  if (abs === 1) return one;
  const last = abs % 10;
  const lastTwo = abs % 100;
  return last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14) ? few : many;
}

/** "dre.pl" from "https://www.dre.pl/" - the card's "where" line. */
export function siteHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------- the panel

/** site_status as the panel and the route read it (times as epoch ms). */
export interface SiteSnapshot {
  url: string;
  state: SiteState;
  since: number;
  downSince: number | null;
  failStreak: number;
  okStreak: number;
  lastCheckedAt: number | null;
  lastOk: boolean | null;
  lastHttpStatus: number | null;
  lastError: string | null;
  lastFailStatus: number | null;
  lastFailError: string | null;
}

/**
 * Down, and the guard is still checking. A DOWN row the guard stopped
 * updating (job stopped, website removed mid-outage) is not shown as an
 * urgent alert: we no longer know.
 */
export function isSiteDownNow(s: SiteSnapshot, now: number): boolean {
  return s.state === "down" && s.lastCheckedAt !== null && now - s.lastCheckedAt <= STALE_AFTER_MIN * MINUTE;
}

const siteNoun = (isShop: boolean) => (isShop ? "Strona sklepu" : "Strona");

/** "Strona sklepu nie odpowiada od 15 min". */
export function downTitle(isShop: boolean, downForMs: number): string {
  return `${siteNoun(isShop)} nie odpowiada od ${durationText(downForMs)}`;
}

/** "Strona znowu działa (przerwa: 42 min)". */
export function upTitle(isShop: boolean, outageMs: number): string {
  return `${siteNoun(isShop)} znowu działa (przerwa: ${durationText(outageMs)})`;
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The Alerty card (an Anomaly's title / description / why / action). */
export function siteDownAlertCopy(input: {
  isShop: boolean;
  downSince: number;
  now: number;
  failStatus: number | null;
  failError: string | null;
  /** "10:05" or "10:05 (06.11)", Europe/Warsaw. */
  startedLabel: string;
}): { title: string; description: string; why: string; action: string } {
  const kind = classifyCheck(input.failStatus, input.failError);
  return {
    title: downTitle(input.isShop, input.now - input.downSince),
    description: `${capitalize(failureText(kind, input.failStatus))}. Nie działa od ${input.startedLabel}, sprawdzamy co ${CHECK_EVERY_MIN} minut.`,
    why: input.isShop
      ? "Kto kliknie reklamę albo wejdzie na stronę, zobaczy błąd: budżet reklam idzie na próżno, a sklep nie sprzedaje."
      : "Kto kliknie reklamę albo wejdzie na stronę, zobaczy błąd: budżet reklam idzie na próżno, a zapytania nie wpływają.",
    action: `Co sprawdzić: ${whatToCheck(kind, input.failStatus).join(" ")}`,
  };
}

export type SiteLineTone = "ok" | "down" | "warn" | "muted";
export interface SiteLine {
  tone: SiteLineTone;
  text: string;
}

const STUCK_HINT = "sprawdź zadanie site-guard w Supabase (cron.job)";

/**
 * The one line under "Strona klienta" in Ustawienia:
 * "Strona działa · sprawdzono 3 min temu · uptime 30 dni 99,9%".
 * null = nothing to say (no website set).
 */
export function siteGuardLine(input: {
  /** False before migration 0045 (site_status unreadable). */
  available: boolean;
  websiteUrl: string | null;
  status: SiteSnapshot | null;
  uptimePct: number | null;
  now: number;
}): SiteLine | null {
  const { status: s, now } = input;
  if (!input.websiteUrl) return null;
  if (!input.available) {
    return {
      tone: "muted",
      text: "Uruchom migrację 0045_site_guard.sql, żeby co 5 minut sprawdzać, czy strona działa.",
    };
  }
  // Not watched yet, or watched under the previous address until the next tick.
  if (!s || s.url !== input.websiteUrl) {
    return { tone: "muted", text: `Pierwsze sprawdzenie strony w ciągu ${CHECK_EVERY_MIN} min.` };
  }
  if (s.lastCheckedAt === null) {
    return now - s.since > STALE_AFTER_MIN * MINUTE
      ? { tone: "warn", text: `Strażnik jeszcze nie sprawdził strony - ${STUCK_HINT}.` }
      : { tone: "muted", text: `Pierwsze sprawdzenie strony w ciągu ${CHECK_EVERY_MIN} min.` };
  }
  const sinceCheck = now - s.lastCheckedAt;
  if (sinceCheck > STALE_AFTER_MIN * MINUTE) {
    return {
      tone: "warn",
      text: `Strażnik nie sprawdzał strony od ${durationText(sinceCheck)} - ${STUCK_HINT}.`,
    };
  }
  const checked = `sprawdzono ${agoText(sinceCheck)}`;
  const uptime = input.uptimePct !== null ? ` · uptime ${UPTIME_DAYS} dni ${formatUptime(input.uptimePct)}` : "";
  if (s.state === "down") {
    const kind = classifyCheck(s.lastFailStatus, s.lastFailError);
    return {
      tone: "down",
      text: `Strona nie działa od ${durationText(now - (s.downSince ?? s.since))} (${failureShort(kind, s.lastFailStatus)}) · ${checked}`,
    };
  }
  if (s.lastOk === null && classifyCheck(s.lastHttpStatus, s.lastError) === "blocked") {
    return {
      tone: "warn",
      text: `Strona odrzuca automatyczne sprawdzanie (HTTP ${s.lastHttpStatus}), więc nie wiemy, czy działa - wpuść robota „PatoSiteGuard” w zaporze · ${checked}`,
    };
  }
  if (s.failStreak > 0) {
    const kind = classifyCheck(s.lastFailStatus, s.lastFailError);
    return {
      tone: "warn",
      text: `Strona nie odpowiedziała przy ostatnim sprawdzeniu (${failureShort(kind, s.lastFailStatus)}) · ${checked}${uptime}`,
    };
  }
  return { tone: "ok", text: `Strona działa · ${checked}${uptime}` };
}

// ---------------------------------------------------------------- notifications

export type SiteEvent = "down" | "up";

/** notifications_sent key: one outage (named by its first failed check) = one DOWN + one UP e-mail. */
export function siteNoticeKey(event: SiteEvent, downSinceIso: string): string {
  const ms = Date.parse(downSinceIso);
  const stamp = Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 16) : downSinceIso;
  return `site-${event}-${stamp}`;
}

/** Prefix of every DOWN key (the flap guard looks for recent ones). */
export const SITE_DOWN_KEY_PREFIX = "site-down-";

export type NoticePlan =
  | { action: "send" }
  | { action: "defer"; reason: string }
  | { action: "drop"; reason: string };

/**
 * What to do with a pending state change. "defer" leaves it pending (the
 * database retries with backoff), "drop" clears it without a message.
 * - DOWN: at most one e-mail per outage; not while the newest check was good
 *   (it may be coming back); not within FLAP_GUARD_MIN of the previous DOWN
 *   e-mail - a flapping site gets one e-mail per two hours, the outage that
 *   is still on after that is announced then.
 * - UP: only for an outage whose DOWN e-mail went out, once.
 */
export function planSiteNotice(input: {
  event: SiteEvent;
  state: SiteState;
  okStreak: number;
  downAnnounced: boolean;
  upAnnounced: boolean;
  /** Newest DOWN e-mail of this client, any outage (epoch ms). */
  lastDownAnnouncedAt: number | null;
  now: number;
}): NoticePlan {
  if (input.event === "down") {
    if (input.state !== "down") return { action: "drop", reason: "recovered before it was announced" };
    if (input.downAnnounced) return { action: "drop", reason: "already announced" };
    if (input.okStreak > 0) return { action: "defer", reason: "newest check was good" };
    if (
      input.lastDownAnnouncedAt !== null &&
      input.now - input.lastDownAnnouncedAt < FLAP_GUARD_MIN * MINUTE
    ) {
      return { action: "defer", reason: "flapping: a DOWN e-mail went out recently" };
    }
    return { action: "send" };
  }
  if (input.state !== "up") return { action: "drop", reason: "down again" };
  if (!input.downAnnounced) return { action: "drop", reason: "the outage was never announced" };
  if (input.upAnnounced) return { action: "drop", reason: "already announced" };
  return { action: "send" };
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export interface SiteNoticeInput {
  event: SiteEvent;
  clientName: string;
  isShop: boolean;
  url: string;
  now: number;
  downSince: number;
  /** UP only: the first good check (end of the outage). */
  upSince: number | null;
  failStatus: number | null;
  failError: string | null;
  failStreak: number;
  /** Europe/Warsaw clock labels, e.g. "10:05" / "10:05 (06.11)". */
  startedLabel: string;
  endedLabel: string | null;
}

/**
 * The e-mail (HTML + plain text) and the Telegram / WhatsApp texts. Same
 * look as lib/notify/send.ts buildDigest (inline styles: e-mail clients
 * ignore stylesheets), with a "Co sprawdzić" list instead of a table.
 */
export function siteNoticeMessage(i: SiteNoticeInput): {
  subject: string;
  html: string;
  text: string;
  telegram: string;
} {
  const kind = classifyCheck(i.failStatus, i.failError);
  const saw = failureText(kind, i.failStatus);
  const down = i.event === "down";
  const title = down
    ? downTitle(i.isShop, i.now - i.downSince)
    : upTitle(i.isShop, (i.upSince ?? i.now) - i.downSince);
  const subject = `${down ? "🚨" : "✅"} ${title} — ${i.clientName}`;
  const streak = Math.max(i.failStreak, DOWN_AFTER_FAILS);
  const streakText = `${streak} ${plPlural(streak, "nieudane sprawdzenie", "nieudane sprawdzenia", "nieudanych sprawdzeń")} z rzędu`;
  const hints = whatToCheck(kind, i.failStatus);

  const facts: Array<[string, string]> = down
    ? [
        ["Co widzimy", `${capitalize(saw)}.`],
        ["Od kiedy", `${i.startedLabel} - ${streakText}, sprawdzamy co ${CHECK_EVERY_MIN} minut.`],
      ]
    : [
        ["Przerwa", `Od ${i.startedLabel} do ${i.endedLabel ?? "teraz"}.`],
        ["Co widzieliśmy", `${capitalize(saw)}.`],
      ];

  const text = [
    `${down ? "PILNE - " : ""}${title} (${i.clientName})`,
    "",
    ...facts.map(([k, v]) => `${k}: ${v}`),
    `Adres: ${i.url}`,
    ...(down ? ["", "Co sprawdzić:", ...hints.map((h) => `- ${h}`), "", "Damy znać, gdy strona znowu zacznie działać."] : []),
  ].join("\n");

  const factRows = [...facts, ["Adres", ""] as [string, string]]
    .map(([k, v]) => {
      const value =
        k === "Adres"
          ? `<a href="${esc(i.url)}" style="color:#4f46e5">${esc(i.url)}</a>`
          : esc(v);
      return `<p style="margin:0 0 10px"><b style="color:#0f172a">${esc(k)}:</b> ${value}</p>`;
    })
    .join("");

  const hintsHtml = down
    ? `
      <tr>
        <td style="padding:4px 24px 0;color:#0f172a;font-size:14px;font-weight:700">Co sprawdzić</td>
      </tr>
      <tr>
        <td style="padding:6px 24px 8px;color:#334155;font-size:14px;line-height:1.6">
          <ul style="margin:0;padding-left:18px">${hints.map((h) => `<li style="margin:0 0 6px">${esc(h)}</li>`).join("")}</ul>
        </td>
      </tr>
      <tr>
        <td style="padding:4px 24px 20px;color:#64748b;font-size:13px">Damy znać, gdy strona znowu zacznie działać.</td>
      </tr>`
    : "";

  const html = `
  <div style="background:#f1f5f9;padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
    <table role="presentation" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;border-collapse:separate;overflow:hidden">
      <tr>
        <td style="background:${down ? "#dc2626" : "#16a34a"};padding:22px 24px;color:#ffffff">
          <div style="font-size:13px;font-weight:700;opacity:0.9">${down ? "🚨 PILNE · " : "✅ "}${esc(i.clientName)}</div>
          <div style="font-size:20px;font-weight:800;margin-top:4px;letter-spacing:-0.2px">${esc(title)}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 24px 6px;color:#334155;font-size:14px;line-height:1.6">${factRows}</td>
      </tr>${hintsHtml}
      <tr>
        <td style="padding:16px 24px;text-align:center;color:#94a3b8;font-size:12px;border-top:1px solid #f1f5f9">
          Wysłane automatycznie przez panel · patoagencja
        </td>
      </tr>
    </table>
  </div>`;

  const telegram = down
    ? `🚨 <b>${esc(i.clientName)}: ${esc(title.toLowerCase())}</b>\n${esc(capitalize(saw))}.\n<i>${esc(i.url)}</i>`
    : `✅ <b>${esc(i.clientName)}: ${esc(title.toLowerCase())}</b>\n<i>${esc(i.url)}</i>`;

  return { subject, html, text, telegram };
}
