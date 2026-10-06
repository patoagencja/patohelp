import { unstable_cache } from "next/cache";
import { formatInTimeZone } from "date-fns-tz";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";

// "Rekordy i kamienie milowe": deterministic, honest highlights computed from
// data we already sync (ads_daily + GA4 daily totals). No external APIs, no AI.
//
// Honesty rules that shape the code below:
// - A record is only claimed against the history we actually hold. Our sync
//   backfills ~1 year before the integration was connected, so the start of
//   the data is NOT the start of the cooperation - copy says "od początku
//   danych w panelu", never "od początku współpracy".
// - Missing days only ever make the past look smaller, so every comparison
//   treats any earlier period that already reaches the candidate as a blocker,
//   and each record needs a minimum amount of history before it is claimed.
// - Engagement clients never get revenue/orders items (the caller passes
//   ecommerce=false and we don't even read the revenue columns).
//
// Callers must have verified the user can see `clientId` (pages resolve the
// client through RLS first); reads here use the admin client, same as
// lib/ecom/insights.ts.

const WARSAW_TZ = "Europe/Warsaw";
const DAY_MS = 86_400_000;
const MAX_ITEMS = 4;

/** Ads history depth. 25 months lets a month that beats everything loaded be
 *  described as "najlepszy od 2 lat" even when older data might exist. */
const ADS_LOOKBACK_MONTHS = 25;
/** How long a crossed YTD threshold stays news. */
const MILESTONE_FRESH_DAYS = 14;
const MIN_WEEKS_HISTORY = 8;
const MIN_MONTHS_HISTORY = 6;
/** "Best since X" is only impressive if it beat a few months in between. */
const MIN_MONTHS_BEATEN = 3;
const MIN_DAYS_HISTORY = 56;
const CPC_WINDOW_DAYS = 7;
const CPC_LOOKBACK_DAYS = 90;
/** Below this a 7-day CPC is noise (a handful of cheap clicks). */
const CPC_MIN_CLICKS = 150;
const CPC_MIN_VALID_WINDOWS = 60;

// ---- public types ----

export type RecordIcon = "trophy" | "flag" | "sparkles" | "trending";

export interface RecordItem {
  id: string;
  icon: RecordIcon;
  /** Short Polish headline. */
  title: string;
  /** One plain Polish sentence with context. */
  detail: string;
  /** Warsaw-local yyyy-MM-dd the record/milestone was reached, if known. */
  achievedOn: string | null;
}

export interface DayAds {
  spend: number; // grosze
  clicks: number;
  impressions: number;
}

export interface DayGa4 {
  sessions: number;
  revenue: number; // grosze
  transactions: number;
}

export interface RecordsInput {
  /** Warsaw-local yyyy-MM-dd. */
  today: string;
  ecommerce: boolean;
  /** Daily ad totals (all providers). A missing date means "no rows". */
  ads: Map<string, DayAds>;
  /** Daily GA4 totals. A missing date means "not synced". */
  ga4: Map<string, DayGa4>;
  /** First date the ads read covered; null when the full history was read.
   *  Ads data starting in that first month may continue further back, so no
   *  "ever" claims are made about ads in that case. */
  adsLookbackStart: string | null;
  /** False before migration 0016 (no revenue columns). */
  hasRevenue: boolean;
}

// ---- date helpers (plain yyyy-MM-dd strings, UTC maths, no TZ drift) ----

const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) =>
  iso(new Date(toDate(s).getTime() + n * DAY_MS));
const diffDays = (from: string, to: string) =>
  Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY_MS);
const monthOf = (s: string) => s.slice(0, 7); // yyyy-MM
const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return iso(d).slice(0, 7);
};
const monthsBetween = (from: string, to: string) => {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
};
const monthEnd = (month: string) => addDays(`${shiftMonth(month, 1)}-01`, -1);
/** ISO week start (Monday). */
const weekStartOf = (s: string) => addDays(s, -((toDate(s).getUTCDay() + 6) % 7));

const MONTHS_NOM = [
  "styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec",
  "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień",
];
const MONTHS_GEN = [
  "stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca",
  "lipca", "sierpnia", "września", "października", "listopada", "grudnia",
];

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "Wrzesień 2026" */
const monthNomPl = (month: string) =>
  capitalize(`${MONTHS_NOM[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`);
/** "maja 2025" (as in "od maja 2025") */
const monthGenPl = (month: string) =>
  `${MONTHS_GEN[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
/** "3 października" (+ year when it isn't the current one) */
function dayPl(s: string, today: string): string {
  const d = toDate(s);
  const base = `${d.getUTCDate()} ${MONTHS_GEN[d.getUTCMonth()]}`;
  return s.slice(0, 4) === today.slice(0, 4) ? base : `${base} ${s.slice(0, 4)}`;
}
/** "22–28 września" / "29 września – 5 października" */
function weekPl(weekStart: string, today: string): string {
  const end = addDays(weekStart, 6);
  const s = toDate(weekStart);
  const e = toDate(end);
  const year = end.slice(0, 4) === today.slice(0, 4) ? "" : ` ${end.slice(0, 4)}`;
  if (s.getUTCMonth() === e.getUTCMonth()) {
    return `${s.getUTCDate()}–${e.getUTCDate()} ${MONTHS_GEN[e.getUTCMonth()]}${year}`;
  }
  return `${s.getUTCDate()} ${MONTHS_GEN[s.getUTCMonth()]} – ${e.getUTCDate()} ${MONTHS_GEN[e.getUTCMonth()]}${year}`;
}

// ---- number / plural helpers ----

const NUM = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 });
const NUM_1 = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 1 });
const PLN_2 = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "PLN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmtNum = (n: number) => NUM.format(Math.round(n));
const fmtPln = (grosze: number) => `${fmtNum(grosze / 100)} zł`;

/** Polish noun forms: [1, 2-4 (not 12-14), 5+ / 12-14]. */
export type PluralForms = readonly [string, string, string];

export function plPlural(n: number, forms: PluralForms): string {
  const abs = Math.abs(Math.round(n));
  if (abs === 1) return forms[0];
  const lastDigit = abs % 10;
  const lastTwo = abs % 100;
  if (lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14)) {
    return forms[1];
  }
  return forms[2];
}

/** "1 234 kliknięcia" */
const countPl = (n: number, forms: PluralForms) =>
  `${fmtNum(n)} ${plPlural(n, forms)}`;

/** Round threshold label + noun: "1 mln wyświetleń", "250 000 kliknięć".
 *  "mln" always governs the genitive plural. */
function thresholdPl(n: number, forms: PluralForms | null): string {
  if (n >= 1_000_000) {
    const label = `${NUM_1.format(n / 1_000_000)} mln`;
    return forms ? `${label} ${forms[2]}` : label;
  }
  return forms ? countPl(n, forms) : fmtNum(n);
}

const CLICKS: PluralForms = ["kliknięcie", "kliknięcia", "kliknięć"];
const SESSIONS: PluralForms = ["wizyta", "wizyty", "wizyt"];
const IMPRESSIONS: PluralForms = ["wyświetlenie", "wyświetlenia", "wyświetleń"];
const ORDERS: PluralForms = ["zamówienie", "zamówienia", "zamówień"];

// ---- generic record detectors (pure) ----

type Series = Map<string, number>;

function firstKey(series: Series): string | null {
  let first: string | null = null;
  for (const k of series.keys()) if (first === null || k < first) first = k;
  return first;
}

interface WeekRecord {
  weekStart: string;
  value: number;
  isCurrent: boolean;
  previousBest: number;
  firstDate: string;
}

/**
 * The current or most recent complete ISO week, if it beats every earlier
 * week we hold. Needs MIN_WEEKS_HISTORY complete (7-day) weeks before it.
 */
export function findWeekRecord(series: Series, today: string): WeekRecord | null {
  const firstDate = firstKey(series);
  if (!firstDate) return null;
  const weeks = new Map<string, { value: number; days: number }>();
  for (const [date, v] of series) {
    if (date > today) continue;
    const ws = weekStartOf(date);
    const w = weeks.get(ws) ?? { value: 0, days: 0 };
    w.value += v;
    w.days += 1;
    weeks.set(ws, w);
  }
  const current = weekStartOf(today);
  const candidates = [current, addDays(current, -7)];
  for (const ws of candidates) {
    const cand = weeks.get(ws);
    if (!cand || cand.value <= 0) continue;
    let previousBest = 0;
    let completePrior = 0;
    let beaten = true;
    for (const [pws, w] of weeks) {
      if (pws >= ws) continue;
      if (w.days === 7) completePrior += 1;
      previousBest = Math.max(previousBest, w.value);
      if (w.value >= cand.value) beaten = false;
    }
    if (beaten && completePrior >= MIN_WEEKS_HISTORY) {
      return { weekStart: ws, value: cand.value, isCurrent: ws === current, previousBest, firstDate };
    }
  }
  return null;
}

type MonthRecord =
  | { kind: "ever"; month: string; value: number; isCurrent: boolean; firstMonth: string; previousBest: number }
  | { kind: "window"; month: string; value: number; isCurrent: boolean; years: number }
  | { kind: "since"; month: string; value: number; isCurrent: boolean; since: string; beaten: number };

/**
 * The current (if it already leads) or last complete month as either an
 * all-time record, a "best in N years" (when history was truncated) or a
 * "best since <month>" with at least MIN_MONTHS_BEATEN months in between.
 */
export function findMonthRecord(
  series: Series,
  today: string,
  truncatedFrom: string | null
): MonthRecord | null {
  const firstDate = firstKey(series);
  if (!firstDate) return null;
  const months = new Map<string, number>();
  for (const [date, v] of series) {
    if (date > today) continue;
    const m = monthOf(date);
    months.set(m, (months.get(m) ?? 0) + v);
  }
  const current = monthOf(today);
  const evaluate = (m: string): MonthRecord | null => {
    const value = months.get(m) ?? 0;
    if (value <= 0) return null;
    const isCurrent = m === current;
    // Most recent earlier month that reached this value.
    let since: string | null = null;
    let priorWithData = 0;
    let previousBest = 0;
    for (const [pm, pv] of months) {
      if (pm >= m) continue;
      priorWithData += 1;
      previousBest = Math.max(previousBest, pv);
      if (pv >= value && (since === null || pm > since)) since = pm;
    }
    if (since) {
      let beaten = 0;
      for (const pm of months.keys()) if (pm > since && pm < m) beaten += 1;
      return beaten >= MIN_MONTHS_BEATEN
        ? { kind: "since", month: m, value, isCurrent, since, beaten }
        : null;
    }
    if (priorWithData < MIN_MONTHS_HISTORY) return null;
    if (truncatedFrom) {
      const years = Math.floor(monthsBetween(monthOf(truncatedFrom), m) / 12);
      return years >= 1 ? { kind: "window", month: m, value, isCurrent, years } : null;
    }
    return { kind: "ever", month: m, value, isCurrent, firstMonth: monthOf(firstDate), previousBest };
  };
  // Both the running and the last complete month can qualify (e.g. September
  // was an all-time record and October is "only" best since spring) - show
  // the stronger claim, preferring the running month on a tie.
  const rank = (r: MonthRecord | null) =>
    !r ? -1 : r.kind === "ever" ? 1000 : r.kind === "window" ? 500 : r.beaten;
  const cur = evaluate(current);
  const prev = evaluate(shiftMonth(current, -1));
  return rank(cur) >= rank(prev) ? cur : prev;
}

interface DayRecord {
  date: string;
  value: number;
  previousBest: number;
  previousBestDate: string;
  firstDate: string;
}

/** Best single day of the last 7, if it beats every earlier day we hold. */
export function findDayRecord(series: Series, today: string): DayRecord | null {
  const firstDate = firstKey(series);
  if (!firstDate) return null;
  const recentStart = addDays(today, -6);
  let best: { date: string; value: number } | null = null;
  for (const [date, v] of series) {
    if (date < recentStart || date > today) continue;
    if (!best || v > best.value) best = { date, value: v };
  }
  if (!best || best.value <= 0) return null;
  let priorDays = 0;
  let previousBest = 0;
  let previousBestDate = "";
  for (const [date, v] of series) {
    if (date >= best.date) continue;
    priorDays += 1;
    if (v >= best.value) return null;
    if (v > previousBest) {
      previousBest = v;
      previousBestDate = date;
    }
  }
  if (priorDays < MIN_DAYS_HISTORY) return null;
  return { ...best, previousBest, previousBestDate, firstDate };
}

interface Milestone {
  threshold: number;
  thresholdIndex: number;
  crossedOn: string;
  total: number;
}

/**
 * Highest round year-to-date threshold crossed in the last
 * MILESTONE_FRESH_DAYS. Requires data from the first week of January, so a
 * late-starting history can't produce a wrong (too late) crossing date.
 */
export function findYtdMilestone(
  series: Series,
  today: string,
  thresholds: readonly number[]
): Milestone | null {
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const firstDate = firstKey(series);
  if (!firstDate || firstDate > addDays(yearStart, 6)) return null;
  let total = 0;
  let hit: { idx: number; date: string } | null = null;
  const days = diffDays(yearStart, today) + 1;
  for (let i = 0; i < days; i++) {
    const date = addDays(yearStart, i);
    const before = total;
    total += series.get(date) ?? 0;
    // Thresholds ascend and the total is cumulative, so the last threshold
    // crossed is also the highest one.
    for (let idx = 0; idx < thresholds.length; idx++) {
      if (before < thresholds[idx] && total >= thresholds[idx]) hit = { idx, date };
    }
  }
  // An old crossing isn't news - and showing a lower, fresher one would
  // understate where the client actually is.
  if (!hit || hit.date < addDays(today, -(MILESTONE_FRESH_DAYS - 1))) return null;
  return { threshold: thresholds[hit.idx], thresholdIndex: hit.idx, crossedOn: hit.date, total };
}

interface CpcRecord {
  cpc: number; // grosze per click
  clicks: number;
  avgCpc: number; // whole lookback
  windowEnd: string;
}

/**
 * Last 7 complete days' CPC vs every other 7-day window in the last 90 days.
 * Windows below CPC_MIN_CLICKS are ignored on both sides (too noisy).
 */
export function findCpcRecord(ads: Map<string, DayAds>, today: string): CpcRecord | null {
  const end = addDays(today, -1); // complete days only
  const start = addDays(end, -(CPC_LOOKBACK_DAYS - 1));
  const spend: number[] = [];
  const clicks: number[] = [];
  let daysWithData = 0;
  for (let i = 0; i < CPC_LOOKBACK_DAYS; i++) {
    const d = ads.get(addDays(start, i));
    if (d) daysWithData += 1;
    spend.push(d?.spend ?? 0);
    clicks.push(d?.clicks ?? 0);
  }
  if (daysWithData < CPC_LOOKBACK_DAYS - 15) return null;
  const windowAt = (endIdx: number) => {
    let s = 0;
    let c = 0;
    for (let i = endIdx - CPC_WINDOW_DAYS + 1; i <= endIdx; i++) {
      s += spend[i];
      c += clicks[i];
    }
    return { s, c };
  };
  const last = windowAt(CPC_LOOKBACK_DAYS - 1);
  if (last.c < CPC_MIN_CLICKS || last.s <= 0) return null;
  const cpc = last.s / last.c;
  let valid = 0;
  for (let e = CPC_WINDOW_DAYS - 1; e < CPC_LOOKBACK_DAYS - 1; e++) {
    const w = windowAt(e);
    if (w.c < CPC_MIN_CLICKS || w.s <= 0) continue;
    valid += 1;
    if (w.s / w.c <= cpc) return null;
  }
  if (valid < CPC_MIN_VALID_WINDOWS) return null;
  const totalSpend = spend.reduce((a, b) => a + b, 0);
  const totalClicks = clicks.reduce((a, b) => a + b, 0);
  return { cpc, clicks: last.c, avgCpc: totalClicks > 0 ? totalSpend / totalClicks : cpc, windowEnd: end };
}

// ---- assembling Polish items ----

interface Candidate {
  item: RecordItem;
  score: number;
  /** One item per metric first, so four wins don't all say "clicks". */
  metric: string;
}

const IMPRESSION_THRESHOLDS = [100_000, 250_000, 500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000, 20_000_000, 50_000_000, 100_000_000];
const COUNT_THRESHOLDS = [1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];
const ORDER_THRESHOLDS = [100, 250, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000];
/** grosze: 50 tys. zł ... 50 mln zł */
const REVENUE_THRESHOLDS = [50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000].map((zl) => zl * 100);

function pctMore(value: number, base: number): string | null {
  if (base <= 0) return null;
  const pct = Math.round(((value - base) / base) * 100);
  return pct >= 1 ? `${pct}%` : null;
}

interface MetricSpec {
  key: string;
  forms: PluralForms | null; // null = money
  /** e.g. "kliknięć w reklamy" context noun phrase (genitive plural). */
  what: string;
  amount: (v: number) => string;
  /** Appended to the amount in headlines ("9412 wizyt" + " na stronie"). */
  suffix: string;
}

const recentBonus = (date: string, today: string) => (diffDays(date, today) <= 2 ? 3 : 0);

function weekCandidate(spec: MetricSpec, rec: WeekRecord, today: string, base: number): Candidate {
  const achievedOn = rec.isCurrent ? today : addDays(rec.weekStart, 6);
  const when = rec.isCurrent
    ? `Ten tydzień (od ${dayPl(rec.weekStart, today)}) jeszcze trwa, a już przyniósł`
    : `Tydzień ${weekPl(rec.weekStart, today)} przyniósł`;
  const more = pctMore(rec.value, rec.previousBest);
  const prev = rec.previousBest > 0
    ? ` Poprzedni rekord: ${spec.amount(rec.previousBest)}${more ? ` (teraz o ${more} więcej)` : ""}.`
    : "";
  return {
    metric: spec.key,
    score: base + recentBonus(achievedOn, today),
    item: {
      id: `week-${spec.key}`,
      icon: "trophy",
      title: `Rekordowy tydzień: ${spec.amount(rec.value)}${spec.suffix}`,
      detail: `${when} najwięcej ${spec.what} w jednym tygodniu od ${monthGenPl(monthOf(rec.firstDate))}, czyli od początku danych w panelu.${prev}`,
      achievedOn,
    },
  };
}

function monthCandidate(spec: MetricSpec, rec: MonthRecord, today: string, base: number): Candidate {
  const achievedOn = rec.isCurrent ? today : monthEnd(rec.month);
  const label = rec.isCurrent
    ? `${monthNomPl(rec.month)} (a miesiąc jeszcze trwa)`
    : monthNomPl(rec.month);
  if (rec.kind === "since") {
    return {
      metric: spec.key,
      // More months beaten = more impressive, capped so it never outranks a true record.
      score: base - 25 + Math.min(rec.beaten, 20),
      item: {
        id: `month-${spec.key}`,
        icon: "trending",
        title: `Najlepszy miesiąc od ${monthGenPl(rec.since)}: ${spec.amount(rec.value)}${spec.suffix}`,
        detail: `${label}: więcej ${spec.what} niż w każdym z ${rec.beaten} poprzednich miesięcy z danymi.`,
        achievedOn,
      },
    };
  }
  if (rec.kind === "window") {
    const span = rec.years >= 2 ? `${rec.years} lat` : "roku";
    return {
      metric: spec.key,
      score: base - 5,
      item: {
        id: `month-${spec.key}`,
        icon: "trophy",
        title: `Najlepszy miesiąc od ${span}: ${spec.amount(rec.value)}${spec.suffix}`,
        detail: `${label} to najwięcej ${spec.what} w jednym miesiącu w ciągu ostatnich ${rec.years >= 2 ? `${rec.years} lat` : "12 miesięcy"}.`,
        achievedOn,
      },
    };
  }
  const more = pctMore(rec.value, rec.previousBest);
  return {
    metric: spec.key,
    score: base,
    item: {
      id: `month-${spec.key}`,
      icon: "trophy",
      title: `Rekordowy miesiąc: ${spec.amount(rec.value)}${spec.suffix}`,
      detail: `${label} to najwięcej ${spec.what} w jednym miesiącu od ${monthGenPl(rec.firstMonth)}, czyli od początku danych w panelu${more ? ` - o ${more} więcej niż poprzedni rekord` : ""}.`,
      achievedOn,
    },
  };
}

function milestoneCandidate(
  key: string,
  m: Milestone,
  today: string,
  title: string,
  detail: string
): Candidate {
  return {
    metric: key,
    // Bigger round numbers rank higher; still below genuine records.
    score: 58 + m.thresholdIndex * 2 + recentBonus(m.crossedOn, today),
    item: { id: `ytd-${key}`, icon: "flag", title, detail, achievedOn: m.crossedOn },
  };
}

/** Pure: everything above applied to pre-aggregated daily series. */
export function computeRecords(input: RecordsInput): RecordItem[] {
  const { today, ads, ga4 } = input;
  const year = today.slice(0, 4);
  const out: Candidate[] = [];

  const clicks: Series = new Map();
  const impressions: Series = new Map();
  for (const [d, v] of ads) {
    clicks.set(d, v.clicks);
    impressions.set(d, v.impressions);
  }
  const sessions: Series = new Map();
  const revenue: Series = new Map();
  const orders: Series = new Map();
  for (const [d, v] of ga4) {
    sessions.set(d, v.sessions);
    revenue.set(d, v.revenue);
    orders.set(d, v.transactions);
  }

  const adsFirst = firstKey(clicks);
  // If ads data starts in the very first month we read, older data may exist:
  // only "best in N years" claims are allowed for ads then.
  const adsTruncatedFrom =
    input.adsLookbackStart && adsFirst && monthOf(adsFirst) <= monthOf(input.adsLookbackStart)
      ? input.adsLookbackStart
      : null;

  const sessionsSpec: MetricSpec = {
    key: "sessions",
    forms: SESSIONS,
    what: "wizyt na stronie",
    amount: (v) => countPl(v, SESSIONS),
    suffix: " na stronie",
  };
  const clicksSpec: MetricSpec = {
    key: "clicks",
    forms: CLICKS,
    what: "kliknięć w reklamy",
    amount: (v) => countPl(v, CLICKS),
    suffix: " w reklamy",
  };
  const revenueSpec: MetricSpec = {
    key: "revenue",
    forms: null,
    what: "sprzedaży (wg GA4)",
    amount: (v) => fmtPln(v),
    suffix: "",
  };

  // Sessions: weekly record, best month, YTD milestone.
  const sw = findWeekRecord(sessions, today);
  if (sw) out.push(weekCandidate(sessionsSpec, sw, today, 90));
  const sm = findMonthRecord(sessions, today, null);
  if (sm) out.push(monthCandidate(sessionsSpec, sm, today, 88));
  const sy = findYtdMilestone(sessions, today, COUNT_THRESHOLDS);
  if (sy) {
    out.push(milestoneCandidate("sessions", sy, today,
      `Przekroczyliśmy ${thresholdPl(sy.threshold, SESSIONS)} na stronie w ${year} roku`,
      `Od 1 stycznia: ${countPl(sy.total, SESSIONS)} na stronie - próg ${thresholdPl(sy.threshold, null)} padł ${dayPl(sy.crossedOn, today)}.`));
  }

  // Clicks: best month, YTD milestone.
  const cm = findMonthRecord(clicks, today, adsTruncatedFrom);
  if (cm) out.push(monthCandidate(clicksSpec, cm, today, 86));
  const cy = findYtdMilestone(clicks, today, COUNT_THRESHOLDS);
  if (cy) {
    out.push(milestoneCandidate("clicks", cy, today,
      `Przekroczyliśmy ${thresholdPl(cy.threshold, CLICKS)} w reklamy w ${year} roku`,
      `Od 1 stycznia: ${countPl(cy.total, CLICKS)} w reklamy - próg ${thresholdPl(cy.threshold, null)} padł ${dayPl(cy.crossedOn, today)}.`));
  }

  // Impressions: YTD milestone.
  const iy = findYtdMilestone(impressions, today, IMPRESSION_THRESHOLDS);
  if (iy) {
    out.push(milestoneCandidate("impressions", iy, today,
      `Przekroczyliśmy ${thresholdPl(iy.threshold, IMPRESSIONS)} reklam w ${year} roku`,
      `Od 1 stycznia Twoje reklamy zebrały ${countPl(iy.total, IMPRESSIONS)} - próg ${thresholdPl(iy.threshold, null)} padł ${dayPl(iy.crossedOn, today)}.`));
  }

  // CPC: cheapest 7-day window in 90 days.
  const cpc = findCpcRecord(ads, today);
  if (cpc) {
    const below = cpc.avgCpc > 0 ? Math.round((1 - cpc.cpc / cpc.avgCpc) * 100) : 0;
    out.push({
      metric: "cpc",
      score: 72 + recentBonus(cpc.windowEnd, today),
      item: {
        id: "cpc-90d",
        icon: "sparkles",
        title: `Najtańsze kliknięcie od 90 dni: ${PLN_2.format(cpc.cpc / 100)}`,
        detail: `Średni koszt kliknięcia z ostatnich 7 dni (${countPl(cpc.clicks, CLICKS)}) jest najniższy spośród wszystkich 7-dniowych okresów z ostatnich 90 dni${below >= 5 ? ` i o ${below}% niższy niż średnia z tego czasu` : ""}.`,
        achievedOn: cpc.windowEnd,
      },
    });
  }

  // E-commerce only: revenue records + order / revenue milestones.
  if (input.ecommerce && input.hasRevenue) {
    const rd = findDayRecord(revenue, today);
    if (rd) {
      const more = pctMore(rd.value, rd.previousBest);
      out.push({
        metric: "revenue",
        score: 96 + recentBonus(rd.date, today),
        item: {
          id: "day-revenue",
          icon: "trophy",
          title: `Rekordowy dzień sprzedaży: ${fmtPln(rd.value)}`,
          detail: `${capitalize(dayPl(rd.date, today))} to najwyższa sprzedaż w jednym dniu (wg GA4) od ${monthGenPl(monthOf(rd.firstDate))}, czyli od początku danych w panelu${rd.previousBest > 0 ? ` - poprzedni rekord to ${fmtPln(rd.previousBest)} (${dayPl(rd.previousBestDate, today)})${more ? `, teraz o ${more} więcej` : ""}` : ""}.`,
          achievedOn: rd.date,
        },
      });
    }
    const rw = findWeekRecord(revenue, today);
    if (rw) {
      const c = weekCandidate(revenueSpec, rw, today, 97);
      c.item.title = `Rekordowy tydzień sprzedaży: ${fmtPln(rw.value)}`;
      out.push(c);
    }
    const rm = findMonthRecord(revenue, today, null);
    if (rm) {
      const c = monthCandidate(revenueSpec, rm, today, 98);
      if (rm.kind === "ever") c.item.title = `Rekordowy miesiąc sprzedaży: ${fmtPln(rm.value)}`;
      out.push(c);
    }
    const oy = findYtdMilestone(orders, today, ORDER_THRESHOLDS);
    if (oy) {
      out.push(milestoneCandidate("orders", oy, today,
        `${fmtNum(oy.threshold)}. zamówienie w ${year} roku`,
        `Od 1 stycznia sklep przyjął już ${countPl(oy.total, ORDERS)} (wg GA4) - próg ${thresholdPl(oy.threshold, ORDERS)} padł ${dayPl(oy.crossedOn, today)}.`));
    }
    const ry = findYtdMilestone(revenue, today, REVENUE_THRESHOLDS);
    if (ry) {
      const label = `${thresholdPl(ry.threshold / 100, null)} zł`;
      out.push(milestoneCandidate("revenue-ytd", ry, today,
        `Ponad ${label} sprzedaży w ${year} roku`,
        `Sprzedaż od 1 stycznia (wg GA4): ${fmtPln(ry.total)} - próg ${label} padł ${dayPl(ry.crossedOn, today)}.`));
    }
  }

  // Highest score first; first pass keeps metrics diverse, second fills gaps.
  out.sort((a, b) => b.score - a.score);
  const picked: Candidate[] = [];
  const seen = new Set<string>();
  for (const c of out) {
    if (picked.length >= MAX_ITEMS) break;
    if (seen.has(c.metric)) continue;
    seen.add(c.metric);
    picked.push(c);
  }
  for (const c of out) {
    if (picked.length >= MAX_ITEMS) break;
    if (!picked.includes(c)) picked.push(c);
  }
  picked.sort((a, b) => b.score - a.score);
  return picked.map((c) => c.item);
}

// ---- Supabase reads ----

const todayWarsaw = () => formatInTimeZone(new Date(), WARSAW_TZ, "yyyy-MM-dd");

async function fetchAdsDaily(
  clientId: string,
  start: string,
  end: string
): Promise<Map<string, DayAds>> {
  const admin = createAdminClient();
  // One paginated read per month, in parallel: a 2-year read of a large
  // account is tens of thousands of rows, and sequential 1000-row pages
  // would make the page noticeably slower.
  const chunks: Array<[string, string]> = [];
  for (let m = monthOf(start); m <= monthOf(end); m = shiftMonth(m, 1)) {
    const s = `${m}-01` < start ? start : `${m}-01`;
    const e = monthEnd(m) > end ? end : monthEnd(m);
    chunks.push([s, e]);
  }
  const parts = await Promise.all(
    chunks.map(([s, e]) =>
      fetchAll<Record<string, unknown>>((from, to) =>
        admin
          .from("ads_daily")
          .select("date, spend_minor_units, clicks, impressions")
          .eq("client_id", clientId)
          .gte("date", s)
          .lte("date", e)
          .order("date", { ascending: true })
          .order("provider", { ascending: true })
          .order("campaign_id", { ascending: true })
          .range(from, to)
      )
    )
  );
  const out = new Map<string, DayAds>();
  for (const rows of parts) {
    for (const r of rows) {
      const date = String(r.date).slice(0, 10);
      const cur = out.get(date) ?? { spend: 0, clicks: 0, impressions: 0 };
      cur.spend += Number(r.spend_minor_units ?? 0);
      cur.clicks += Number(r.clicks ?? 0);
      cur.impressions += Number(r.impressions ?? 0);
      out.set(date, cur);
    }
  }
  return out;
}

async function fetchGa4Daily(
  clientId: string,
  end: string,
  withRevenue: boolean
): Promise<Map<string, DayGa4>> {
  const admin = createAdminClient();
  // Daily totals only: rows with every dimension NULL. Dimension snapshot
  // rows (source/device/page) share the table and would double count.
  const rows = await fetchAll<Record<string, unknown>>((from, to) =>
    admin
      .from("ga4_daily")
      // The cast only quiets the select-string parser; rows are read loosely.
      .select(
        (withRevenue
          ? "date, sessions, revenue_minor_units, transactions"
          : "date, sessions") as "date, sessions, revenue_minor_units, transactions"
      )
      .eq("client_id", clientId)
      .is("source_medium", null)
      .is("device_category", null)
      .is("page_path", null)
      .lte("date", end)
      .order("date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
  const out = new Map<string, DayGa4>();
  for (const r of rows) {
    const date = String(r.date).slice(0, 10);
    const cur = out.get(date) ?? { sessions: 0, revenue: 0, transactions: 0 };
    cur.sessions += Number(r.sessions ?? 0);
    cur.revenue += Number(r.revenue_minor_units ?? 0);
    cur.transactions += Number(r.transactions ?? 0);
    out.set(date, cur);
  }
  return out;
}

/**
 * Up to four honest highlights for the client, most impressive first.
 * Never throws: any failure yields [] so the dashboard still renders.
 */
export async function getRecords(
  clientId: string,
  opts: { ecommerce: boolean; today?: string }
): Promise<RecordItem[]> {
  try {
    const today =
      opts.today && /^\d{4}-\d{2}-\d{2}$/.test(opts.today) ? opts.today : todayWarsaw();
    const adsLookbackStart = `${shiftMonth(monthOf(today), -ADS_LOOKBACK_MONTHS)}-01`;

    const ga4Promise = (async () => {
      if (!opts.ecommerce) {
        return { map: await fetchGa4Daily(clientId, today, false), hasRevenue: false };
      }
      try {
        return { map: await fetchGa4Daily(clientId, today, true), hasRevenue: true };
      } catch {
        // Revenue columns missing (pre-0016): sessions records still work.
        return { map: await fetchGa4Daily(clientId, today, false), hasRevenue: false };
      }
    })();

    const [ads, ga4] = await Promise.all([
      fetchAdsDaily(clientId, adsLookbackStart, today),
      ga4Promise,
    ]);

    return computeRecords({
      today,
      ecommerce: opts.ecommerce,
      ads,
      ga4: ga4.map,
      adsLookbackStart,
      hasRevenue: ga4.hasRevenue,
    });
  } catch {
    return [];
  }
}

/**
 * Records move at most once a day but read up to two years of rows, so the
 * overview shares one computed result per client for a few hours instead of
 * re-scanning history on every visit.
 */
export function getCachedRecords(
  clientId: string,
  ecommerce: boolean
): Promise<RecordItem[]> {
  return unstable_cache(
    () => getRecords(clientId, { ecommerce }),
    ["records-v1", clientId, ecommerce ? "ecom" : "eng"],
    { revalidate: 3 * 3600 }
  )();
}
