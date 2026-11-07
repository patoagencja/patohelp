// Pure half of "Twój <miesiąc> w skrócie" (lib/notify/monthly-digest.ts):
// which month, when to send, Polish month names, month-over-month changes
// and the best campaign / ad picks. Import-free on purpose - the unit tests
// run it with Node's type stripping, which can't resolve "@/" paths.

// ---- dates (plain yyyy-MM-dd strings, UTC maths, so no server-TZ drift) ----

const DAY_MS = 86_400_000;
const toMs = (s: string) => Date.parse(`${s}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const pad2 = (n: number) => String(n).padStart(2, "0");

export function addDaysIso(s: string, n: number): string {
  return iso(toMs(s) + n * DAY_MS);
}

/** Days in a calendar month (month 1-12). */
export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Inclusive day count of [start, end] that also falls in [otherStart, otherEnd]. */
export function overlapDays(
  start: string,
  end: string,
  otherStart: string,
  otherEnd: string
): number {
  const from = Math.max(toMs(start), toMs(otherStart));
  const to = Math.min(toMs(end), toMs(otherEnd));
  return to < from ? 0 : Math.round((to - from) / DAY_MS) + 1;
}

// ---- Warsaw clock ----

export interface WarsawClock {
  /** Warsaw calendar day, yyyy-MM-dd. */
  date: string;
  /** Day of the month, 1-31. */
  day: number;
  /** Hour 0-23. */
  hour: number;
}

// Built-in Intl instead of date-fns-tz keeps this file import-free; it
// follows the tz database the same way (CET/CEST switch included).
const WARSAW_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Warsaw",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

/** What the wall clock in Warsaw shows at `now`. */
export function warsawClock(now: Date): WarsawClock {
  const parts = WARSAW_PARTS.formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? NaN);
  const year = get("year");
  const month = get("month");
  const day = get("day");
  return { date: `${year}-${pad2(month)}-${pad2(day)}`, day, hour: get("hour") % 24 };
}

// ---- the reported month ----

export interface DigestMonth {
  year: number;
  /** 1-12. */
  month: number;
  start: string;
  end: string;
  days: number;
  prevYear: number;
  prevMonth: number;
  prevStart: string;
  prevEnd: string;
  prevDays: number;
  /** notifications_sent.alert_key, e.g. "monthly-digest-2026-10". */
  key: string;
  /**
   * notifications_sent.sent_on for the claim: the first day of the sending
   * month, the SAME on every day of the send window. The table is unique on
   * (client_id, alert_key, sent_on); with "today" there, a digest sent on the
   * 1st could be claimed (and sent) again on the 2nd.
   */
  claimDate: string;
}

/** The last COMPLETE calendar month before `today` (a Warsaw yyyy-MM-dd). */
export function previousMonth(today: string): DigestMonth {
  const [y, m] = today.split("-").map(Number);
  const year = m === 1 ? y - 1 : y;
  const month = m === 1 ? 12 : m - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const days = daysInMonth(year, month);
  const prevDays = daysInMonth(prevYear, prevMonth);
  return {
    year,
    month,
    start: `${year}-${pad2(month)}-01`,
    end: `${year}-${pad2(month)}-${pad2(days)}`,
    days,
    prevYear,
    prevMonth,
    prevStart: `${prevYear}-${pad2(prevMonth)}-01`,
    prevEnd: `${prevYear}-${pad2(prevMonth)}-${pad2(prevDays)}`,
    prevDays,
    key: `monthly-digest-${year}-${pad2(month)}`,
    claimDate: `${y}-${pad2(m)}-01`,
  };
}

// ---- when to send ----

/** Days 1-3: a run missed on the 1st (scheduler outage) still goes out. */
export const SEND_LAST_DAY = 3;
/**
 * From 8:00, like the weekly digest: the month's last day has had the night
 * to finish syncing, and nobody gets a report at half past midnight.
 */
export const SEND_FROM_HOUR = 8;
/** Until 19:59 - a retry after a failed send should not land at night. */
export const SEND_UNTIL_HOUR = 20;

/**
 * Whether this tick may send. "Not sent yet" is the caller's claim in
 * notifications_sent; this is only the calendar half of the rule.
 */
export function isMonthlyDigestDue(clock: Pick<WarsawClock, "day" | "hour">): boolean {
  return (
    clock.day >= 1 &&
    clock.day <= SEND_LAST_DAY &&
    clock.hour >= SEND_FROM_HOUR &&
    clock.hour < SEND_UNTIL_HOUR
  );
}

// ---- Polish month names ----

const MONTH_NOMINATIVE = [
  "styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec",
  "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień",
];
const MONTH_LOCATIVE = [
  "styczniu", "lutym", "marcu", "kwietniu", "maju", "czerwcu",
  "lipcu", "sierpniu", "wrześniu", "październiku", "listopadzie", "grudniu",
];
const MONTH_GENITIVE = [
  "stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca",
  "lipca", "sierpnia", "września", "października", "listopada", "grudnia",
];

/** "październik" (month 1-12). */
export function monthNamePl(month: number): string {
  return MONTH_NOMINATIVE[month - 1];
}

/** "Październik". */
export function monthNamePlCapitalized(month: number): string {
  const name = monthNamePl(month);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** "w październiku", "we wrześniu" ("we" before w/f + consonant). */
export function inMonthPl(month: number): string {
  const word = MONTH_LOCATIVE[month - 1];
  return `${/^[wf][^aeiouyąęó]/.test(word) ? "we" : "w"} ${word}`;
}

/** "1–31 października 2026". */
export function monthRangePl(m: Pick<DigestMonth, "year" | "month" | "days">): string {
  return `1–${m.days} ${MONTH_GENITIVE[m.month - 1]} ${m.year}`;
}

/** "3.10–1.11" - for a short caption where a full range doesn't fit. */
export function shortRangePl(start: string, end: string): string {
  const f = (s: string) => {
    const [, mm, dd] = s.split("-").map(Number);
    return `${dd}.${pad2(mm)}`;
  };
  return `${f(start)}–${f(end)}`;
}

// ---- month-over-month changes ----

export type Tone = "good" | "bad" | "flat";

export interface MonthChange {
  /** 0.12 = +12%. */
  ratio: number;
  /** "o 12% więcej niż we wrześniu" / "podobnie jak we wrześniu". */
  text: string;
  tone: Tone;
  direction: "up" | "down" | "flat";
}

/**
 * Previous-month floors below which a % is noise, not news. Same cut-offs as
 * the dashboard story and KPI tiles (lib/dashboard/story.ts MIN_BASE,
 * MIN_PREV_SPEND), so the e-mail never shows a % the panel would hide.
 */
export const MIN_PREV = {
  spend: 10_000, // grosze = 100 zł
  clicks: 50,
  sessions: 50,
  purchases: 10,
} as const;

/**
 * Relative change of `cur` vs `prev`, or null when it can't honestly be
 * said: nothing last month (or below `minPrev`), or nothing this month - a
 * zero there is a missing source (sync gap, GA4 unplugged), not a -100%.
 *
 * Counts on months of different length compare daily averages - the rule of
 * the panel's "Poprzedni miesiąc" (lib/dashboard/metrics.ts kpiRate), which
 * stopped a flat March reading "o 10% więcej" than February. Ratios (CTR)
 * don't depend on the number of days and compare as they are.
 */
export function monthRatio(
  cur: number,
  prev: number,
  opts: { kind: "count" | "ratio"; days?: number; prevDays?: number; minPrev?: number }
): number | null {
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  if (cur <= 0 || prev <= 0 || prev < (opts.minPrev ?? 0)) return null;
  const { days, prevDays } = opts;
  if (opts.kind === "count" && days && prevDays && days !== prevDays) {
    return cur / days / (prev / prevDays) - 1;
  }
  return cur / prev - 1;
}

/**
 * The change in words. `kind`: "more_is_good" (clicks, visits, sales),
 * "neutral" (spend - more of it is a decision, not a result) or "rate"
 * (CTR: "lepiej"/"słabiej" reads better than "więcej" for a percentage).
 * Under 3% it's "podobnie", like the dashboard story.
 */
export function phraseMonthChange(
  ratio: number | null,
  prevMonth: number,
  kind: "more_is_good" | "neutral" | "rate"
): MonthChange | null {
  if (ratio === null || !Number.isFinite(ratio)) return null;
  const pct = Math.round(Math.abs(ratio) * 100);
  const when = inMonthPl(prevMonth);
  if (pct < 3) return { ratio, text: `podobnie jak ${when}`, tone: "flat", direction: "flat" };
  const up = ratio > 0;
  const word =
    kind === "rate" ? (up ? "lepiej" : "słabiej") : up ? "więcej" : "mniej";
  return {
    ratio,
    text: `o ${pct}% ${word} niż ${when}`,
    tone: kind === "neutral" ? "flat" : up ? "good" : "bad",
    direction: up ? "up" : "down",
  };
}

/** Month totals, as summed from ads_daily(_totals) and ga4_daily. */
export interface MonthTotals {
  spend: number; // grosze
  clicks: number;
  impressions: number;
  sessions: number;
  /** Sales from ads (purchase value per Meta / Google), grosze. Shops only. */
  sales: number;
  purchases: number;
}

export interface MonthChanges {
  spend: MonthChange | null;
  clicks: MonthChange | null;
  sessions: MonthChange | null;
  ctr: MonthChange | null;
  sales: MonthChange | null;
}

/** CTR in percent units (2.4 = 2.4%), 0 without impressions. */
export function ctrPercent(clicks: number, impressions: number): number {
  return impressions > 0 ? (clicks / impressions) * 100 : 0;
}

/**
 * Every change the e-mail can show. `covered` says whether each source's
 * synced history reaches back over last month: a client connected on the
 * 20th would otherwise read as "+300%".
 */
export function compareMonths(
  cur: MonthTotals,
  prev: MonthTotals,
  month: Pick<DigestMonth, "days" | "prevDays" | "prevMonth">,
  covered: { ads: boolean; ga4: boolean }
): MonthChanges {
  const span = { days: month.days, prevDays: month.prevDays };
  const count = (c: number, p: number, minPrev: number) =>
    monthRatio(c, p, { kind: "count", ...span, minPrev });
  const say = (ratio: number | null, kind: "more_is_good" | "neutral" | "rate") =>
    phraseMonthChange(ratio, month.prevMonth, kind);

  // CTR on a thin click base swings on a handful of clicks: same guard as
  // the clicks themselves.
  const clicksOk = covered.ads && prev.clicks >= MIN_PREV.clicks;
  // Sales swing on one or two baskets: judged on last month's orders.
  const salesOk = covered.ads && prev.purchases >= MIN_PREV.purchases;

  return {
    spend: covered.ads ? say(count(cur.spend, prev.spend, MIN_PREV.spend), "neutral") : null,
    clicks: covered.ads ? say(count(cur.clicks, prev.clicks, MIN_PREV.clicks), "more_is_good") : null,
    sessions: covered.ga4
      ? say(count(cur.sessions, prev.sessions, MIN_PREV.sessions), "more_is_good")
      : null,
    ctr: clicksOk
      ? say(
          monthRatio(ctrPercent(cur.clicks, cur.impressions), ctrPercent(prev.clicks, prev.impressions), {
            kind: "ratio",
          }),
          "rate"
        )
      : null,
    sales: salesOk ? say(count(cur.sales, prev.sales, 1), "more_is_good") : null,
  };
}

/**
 * Whether a source's history covers last month: its first synced day is no
 * later than a week into it (the dashboard's baseline slack).
 */
export function historyCovers(earliest: string | null, prevStart: string, slackDays = 7): boolean {
  return earliest !== null && earliest <= addDaysIso(prevStart, slackDays);
}

// ---- best campaign / best ad ----

export interface CampaignMonth {
  provider: string;
  campaignId: string;
  name: string;
  spend: number; // grosze
  clicks: number;
  impressions: number;
  purchases: number;
  /** Sales from ads, grosze. 0 for engagement clients (never read). */
  sales: number;
}

export interface AdMonth {
  adId: string;
  name: string;
  campaignName: string | null;
  spend: number; // grosze
  clicks: number;
  impressions: number;
  purchases: number;
  sales: number; // grosze
}

export type BestBy = "sales" | "clicks" | "ctr";

/**
 * The month's best campaign by the client's key metric: sales from ads for
 * a shop, clicks for everyone else (and for a shop whose campaigns sold
 * nothing). Ties go to the higher CTR, then the cheaper campaign.
 */
export function pickBestCampaign(
  campaigns: CampaignMonth[],
  shop: boolean
): { campaign: CampaignMonth; by: BestBy } | null {
  if (shop) {
    const sold = campaigns.filter((c) => c.sales > 0);
    if (sold.length) {
      const best = [...sold].sort((a, b) => b.sales - a.sales || a.spend - b.spend)[0];
      return { campaign: best, by: "sales" };
    }
  }
  const clicked = campaigns.filter((c) => c.clicks > 0);
  if (!clicked.length) return null;
  const best = [...clicked].sort(
    (a, b) =>
      b.clicks - a.clicks ||
      ctrPercent(b.clicks, b.impressions) - ctrPercent(a.clicks, a.impressions) ||
      a.spend - b.spend
  )[0];
  return { campaign: best, by: "clicks" };
}

/**
 * Below these an ad's CTR is luck, not quality - the same floors the
 * "Kreacje" tab uses before it ranks an ad (lib/dashboard/creatives.ts
 * MIN_IMPRESSIONS / MIN_CLICKS).
 */
export const MIN_AD_IMPRESSIONS = 1000;
export const MIN_AD_CLICKS = 30;

/**
 * The month's best ad: most sales from ads for a shop; otherwise the most
 * clicked one (highest CTR - the "Najczęściej klikana" award of the Kreacje
 * tab) among ads with enough impressions and clicks to judge.
 */
export function pickBestAd(ads: AdMonth[], shop: boolean): { ad: AdMonth; by: BestBy } | null {
  if (shop) {
    const sold = ads.filter((a) => a.sales > 0);
    if (sold.length) {
      return { ad: [...sold].sort((a, b) => b.sales - a.sales || a.spend - b.spend)[0], by: "sales" };
    }
  }
  const eligible = ads.filter(
    (a) => a.impressions >= MIN_AD_IMPRESSIONS && a.clicks >= MIN_AD_CLICKS
  );
  if (!eligible.length) return null;
  const best = [...eligible].sort(
    (a, b) =>
      ctrPercent(b.clicks, b.impressions) - ctrPercent(a.clicks, a.impressions) ||
      b.clicks - a.clicks
  )[0];
  return { ad: best, by: "ctr" };
}

/**
 * Campaign and ad names are often dimension-stuffed ("OLX-PL | BRAND | GOODS
 * | ..."): separators become " · " and the tail is cut so the e-mail card
 * stays two lines at most.
 */
export function tidyName(name: string, max = 80): string {
  const clean = name.replace(/\s*\|\s*/g, " · ").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}
