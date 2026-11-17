// "Wynik dzień po dniu": what is left of a shop's revenue after every ad
// channel, one row per calendar day, against the same day a year earlier -
// the hand-filled sheet seasonal shops keep (ALL IN, ALL FB, ALL G, ... ALL
// SUM, R, R%), computed from the panel's own data.
//
// Pure and import-free on purpose: lib/daily-net/calc.test.ts runs this file
// directly under `node --test` with type stripping, which can't resolve the
// "@/..." alias or extension-less relative imports. Money is grosze
// throughout; dates are Warsaw calendar days as "yyyy-MM-dd" strings.

// ------------------------------------------------------------------ channels

/** Channels kept by hand (migration 0046 manual_ad_costs.channel). */
export const MANUAL_CHANNELS = ["pinterest", "bing", "x", "chatgpt", "tiktok", "other"] as const;
export type ManualChannel = (typeof MANUAL_CHANNELS)[number];

/** Channels with an integration (ads_daily providers). */
export const API_CHANNELS = ["meta", "google", "tiktok"] as const;
export type ApiChannel = (typeof API_CHANNELS)[number];

/** Manual-only channels: summed into "Pozostałe" in the table. */
export const OTHER_CHANNELS = ["pinterest", "bing", "x", "chatgpt", "other"] as const;
export type OtherChannel = (typeof OTHER_CHANNELS)[number];

export const CHANNEL_LABEL: Record<ApiChannel | ManualChannel, string> = {
  meta: "Meta",
  google: "Google",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  bing: "Bing",
  x: "X",
  chatgpt: "ChatGPT",
  other: "Inne",
};

/** ads_daily.provider -> channel; providers not listed are not ad spend here. */
export const PROVIDER_CHANNEL: Readonly<Record<string, ApiChannel>> = {
  meta_ads: "meta",
  google_ads: "google",
  tiktok_ads: "tiktok",
};

const isManualChannel = (c: string): c is ManualChannel =>
  (MANUAL_CHANNELS as readonly string[]).includes(c);

// ---------------------------------------------------------------- date maths

const DAY_MS = 86_400_000;
const toTime = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

export function addDaysIso(iso: string, days: number): string {
  return new Date(toTime(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

export function diffDaysIso(from: string, to: string): number {
  return Math.round((toTime(to) - toTime(from)) / DAY_MS);
}

/** Every day from `start` to `end`, inclusive (empty when start > end). */
export function datesBetween(start: string, end: string): string[] {
  const n = diffDaysIso(start, end) + 1;
  return Array.from({ length: Math.max(0, n) }, (_, i) => addDaysIso(start, i));
}

/** True for a "yyyy-MM-dd" that names a real calendar day. */
export function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = toTime(value);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === value;
}

/** The same calendar date `years` later (negative = earlier); 29 Feb -> 28 Feb. */
export function shiftYears(iso: string, years: number): string {
  const y = Number(iso.slice(0, 4)) + years;
  const md = iso.slice(5);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return `${String(y).padStart(4, "0")}-${md === "02-29" && !leap ? "02-28" : md}`;
}

/**
 * How a day is matched with last year:
 * - "date": the same calendar date, as in the shop's own sheet;
 * - "weekday": 364 days back - the same weekday, so a Friday meets a Friday
 *   and Black Friday meets last year's Black Friday.
 */
export type CompareMode = "date" | "weekday";

export function alignedDate(date: string, mode: CompareMode, yearsBack = 1): string {
  return mode === "weekday" ? addDaysIso(date, -364 * yearsBack) : shiftYears(date, -yearsBack);
}

export function parseCompareMode(value: unknown): CompareMode {
  return value === "weekday" ? "weekday" : "date";
}

// ------------------------------------------------------------ sales moments

export type DayMoment = "black-friday" | "cyber-monday" | "black-week" | null;

/**
 * Black Week around a Black Friday date: from the Monday of that week
 * through Cyber Monday (Black Friday + 3).
 */
export function blackWeekOf(blackFriday: string): { start: string; blackFriday: string; cyberMonday: string } {
  return { start: addDaysIso(blackFriday, -4), blackFriday, cyberMonday: addDaysIso(blackFriday, 3) };
}

/**
 * The day's sales moment, and whether it is on or after its year's Black
 * Week start (the sheet bolds those rows - the part of the season that
 * decides it). `blackFridays`: the Black Friday dates of the years shown
 * (lib/ecom/insights blackFriday()).
 */
export function momentOf(date: string, blackFridays: readonly string[]): { moment: DayMoment; fromBlackWeek: boolean } {
  const bf = blackFridays.find((d) => d.slice(0, 4) === date.slice(0, 4));
  if (!bf) return { moment: null, fromBlackWeek: false };
  const week = blackWeekOf(bf);
  const moment: DayMoment =
    date === week.blackFriday
      ? "black-friday"
      : date === week.cyberMonday
        ? "cyber-monday"
        : date >= week.start && date <= week.cyberMonday
          ? "black-week"
          : null;
  return { moment, fromBlackWeek: date >= week.start };
}

// ------------------------------------------------------------- day inputs

/** What the panel knows about one day, before merging. */
export interface DayInput {
  /** Shop revenue (grosze). Absent / null = the shop reported nothing that day. */
  revenue?: number | null;
  /** Integration totals per channel. A key present = the integration has data that day (0 included). */
  api?: Partial<Record<ApiChannel, number>>;
  /** Hand-entered costs per channel. */
  manual?: Partial<Record<ManualChannel, number>>;
}

/** Day inputs by date. A plain object so it stays JSON-safe (cacheable). */
export type DayInputs = Record<string, DayInput | undefined>;

export interface DaySpend {
  meta: number;
  google: number;
  tiktok: number;
  /** Manual-only channels, only those with an entry. */
  others: Partial<Record<OtherChannel, number>>;
  othersTotal: number;
  total: number;
  /** Where each integration channel's number came from (null = nothing that day). */
  source: Record<ApiChannel, "api" | "manual" | null>;
  /** Hand entries an integration's data replaced that day (the API wins). */
  overridden: ManualChannel[];
  /** Any ad-cost number at all that day - an integration row or a hand entry. */
  hasData: boolean;
}

/**
 * One day's ad costs per channel. An integration's number wins whenever it
 * has data for that day; a hand entry fills in otherwise (TikTok can be
 * either: before the integration was connected, or for a second account),
 * so a day is never counted twice.
 */
export function mergeDaySpend(day: DayInput | undefined): DaySpend {
  const api = day?.api ?? {};
  const manual = day?.manual ?? {};
  const out: DaySpend = {
    meta: 0,
    google: 0,
    tiktok: 0,
    others: {},
    othersTotal: 0,
    total: 0,
    source: { meta: null, google: null, tiktok: null },
    overridden: [],
    hasData: false,
  };
  for (const c of API_CHANNELS) {
    const fromApi = api[c];
    const fromHand = isManualChannel(c) ? manual[c] : undefined;
    if (fromApi !== undefined && fromApi !== null) {
      out[c] = fromApi;
      out.source[c] = "api";
      if (fromHand !== undefined && fromHand !== null && isManualChannel(c)) out.overridden.push(c);
    } else if (fromHand !== undefined && fromHand !== null) {
      out[c] = fromHand;
      out.source[c] = "manual";
    }
  }
  for (const c of OTHER_CHANNELS) {
    const v = manual[c];
    if (v === undefined || v === null) continue;
    out.others[c] = v;
    out.othersTotal += v;
  }
  out.total = out.meta + out.google + out.tiktok + out.othersTotal;
  out.hasData =
    out.source.meta !== null || out.source.google !== null || out.source.tiktok !== null || Object.keys(out.others).length > 0;
  return out;
}

// --------------------------------------------------------------------- rows

/** One day of one year: revenue, merged ad costs, what is left. */
export interface NetSide {
  date: string;
  /** null = the shop reported nothing that day (not the same as zero). */
  revenue: number | null;
  spend: DaySpend;
  /** revenue - all ad costs; null without revenue. */
  net: number | null;
}

export function sideOf(date: string, days: DayInputs): NetSide {
  const day = days[date];
  const revenue = day?.revenue ?? null;
  const spend = mergeDaySpend(day);
  return { date, revenue, spend, net: revenue === null ? null : revenue - spend.total };
}

export interface NetRow extends NetSide {
  /** Today: still being synced, shown but kept out of totals and comparisons. */
  partial: boolean;
  moment: DayMoment;
  /** On or after Black Week - bolded, as in the sheet. */
  emphasis: boolean;
  /** The matched day last year and two years back. */
  ly: NetSide;
  y2: NetSide;
  /** net - last year's net (the sheet's R); null when either is unknown. */
  diff: number | null;
  /** diff / last year's net (R%); null unless last year's net is above zero. */
  diffPct: number | null;
}

/** R and R%: change against last year's net, % only on a positive base. */
export function netChange(net: number | null, lyNet: number | null): { diff: number | null; pct: number | null } {
  if (net === null || lyNet === null) return { diff: null, pct: null };
  const diff = net - lyNet;
  return { diff, pct: lyNet > 0 ? diff / lyNet : null };
}

export function buildRows(
  dates: readonly string[],
  today: string,
  mode: CompareMode,
  days: DayInputs,
  blackFridays: readonly string[]
): NetRow[] {
  return dates.map((date) => {
    const cur = sideOf(date, days);
    const ly = sideOf(alignedDate(date, mode, 1), days);
    const y2 = sideOf(alignedDate(date, mode, 2), days);
    const { moment, fromBlackWeek } = momentOf(date, blackFridays);
    const { diff, pct } = netChange(cur.net, ly.net);
    return { ...cur, partial: date === today, moment, emphasis: fromBlackWeek, ly, y2, diff, diffPct: pct };
  });
}

// ------------------------------------------------------------------- totals

export interface SideTotals {
  days: number;
  /** Days the shop reported revenue for. */
  revenueDays: number;
  /** Days with any ad-cost number. */
  spendDays: number;
  revenue: number;
  /** All ad costs over all days. */
  ads: number;
  /** Ad costs of the days with revenue only - what `net` subtracts. */
  adsOnRevenueDays: number;
  /** revenue - adsOnRevenueDays: a day without sales data doesn't count as a loss. */
  net: number;
  meta: number;
  google: number;
  tiktok: number;
  others: Record<OtherChannel, number>;
  othersTotal: number;
  /** adsOnRevenueDays / revenue (0..1); null without revenue. */
  adShare: number | null;
}

export function totalsOf(sides: readonly NetSide[]): SideTotals {
  const t: SideTotals = {
    days: sides.length,
    revenueDays: 0,
    spendDays: 0,
    revenue: 0,
    ads: 0,
    adsOnRevenueDays: 0,
    net: 0,
    meta: 0,
    google: 0,
    tiktok: 0,
    others: { pinterest: 0, bing: 0, x: 0, chatgpt: 0, other: 0 },
    othersTotal: 0,
    adShare: null,
  };
  for (const s of sides) {
    t.ads += s.spend.total;
    t.meta += s.spend.meta;
    t.google += s.spend.google;
    t.tiktok += s.spend.tiktok;
    t.othersTotal += s.spend.othersTotal;
    for (const c of OTHER_CHANNELS) t.others[c] += s.spend.others[c] ?? 0;
    if (s.spend.hasData) t.spendDays += 1;
    if (s.revenue !== null) {
      t.revenueDays += 1;
      t.revenue += s.revenue;
      t.adsOnRevenueDays += s.spend.total;
    }
  }
  t.net = t.revenue - t.adsOnRevenueDays;
  t.adShare = t.revenue > 0 ? t.adsOnRevenueDays / t.revenue : null;
  return t;
}

/** Finished days only: today's half-synced row stays out of every sum. */
export const finishedRows = (rows: readonly NetRow[]) => rows.filter((r) => !r.partial);

export interface NetComparison {
  /** This range (finished days) and the matched days a year earlier. */
  cur: SideTotals;
  ly: SideTotals;
  /** Two years back; null when the panel has no sales from then. */
  y2: SideTotals | null;
  /**
   * What the revenue / net / share changes compare:
   * - "full": every day with sales this year has its match last year;
   * - "matched": only days with sales in both years (the rest of last year
   *   isn't in the panel - the shop history may not reach back);
   * - "none": no sales last year in the panel.
   */
  basis: "full" | "matched" | "none";
  /** Days with sales in both years. */
  matchedDays: number;
  curMatched: SideTotals;
  lyMatched: SideTotals;
  /** Ad costs on days both years have cost data (null = none last year). */
  adsMatched: { cur: number; ly: number; days: number } | null;
}

export function compareRows(rows: readonly NetRow[]): NetComparison {
  const done = finishedRows(rows);
  const cur = totalsOf(done);
  const ly = totalsOf(done.map((r) => r.ly));
  const y2Totals = totalsOf(done.map((r) => r.y2));
  const both = done.filter((r) => r.revenue !== null && r.ly.revenue !== null);
  const curMatched = totalsOf(both);
  const lyMatched = totalsOf(both.map((r) => r.ly));
  const basis: NetComparison["basis"] =
    both.length === 0 ? "none" : both.length === cur.revenueDays && both.length === ly.revenueDays ? "full" : "matched";
  const spendBoth = done.filter((r) => r.spend.hasData && r.ly.spend.hasData);
  return {
    cur,
    ly,
    y2: y2Totals.revenueDays > 0 ? y2Totals : null,
    basis,
    matchedDays: both.length,
    curMatched,
    lyMatched,
    adsMatched: spendBoth.length
      ? {
          cur: spendBoth.reduce((a, r) => a + r.spend.total, 0),
          ly: spendBoth.reduce((a, r) => a + r.ly.spend.total, 0),
          days: spendBoth.length,
        }
      : null,
  };
}

/** Sum of the per-day differences (the totals row's R), and R% on its base. */
export function totalChange(rows: readonly NetRow[]): { diff: number | null; pct: number | null; days: number } {
  let diff = 0;
  let base = 0;
  let days = 0;
  for (const r of finishedRows(rows)) {
    if (r.diff === null || r.ly.net === null) continue;
    diff += r.diff;
    base += r.ly.net;
    days += 1;
  }
  if (days === 0) return { diff: null, pct: null, days };
  return { diff, pct: base > 0 ? diff / base : null, days };
}

/**
 * Two years back is worth a column only when the panel has that year's
 * sales AND some ad costs from it - sales alone would read as everything
 * being left over.
 */
export function showTwoYearsBack(rows: readonly NetRow[]): boolean {
  return rows.some((r) => r.y2.revenue !== null) && rows.some((r) => r.y2.spend.hasData);
}

// ------------------------------------------------------------- the chart

export interface CumulativePoint {
  date: string;
  lyDate: string;
  /** Running "left after ads" through this day; null = not finished yet. */
  cur: number | null;
  ly: number | null;
  moment: DayMoment;
}

/**
 * Running net, this period against last year's matched days. This year
 * stops at the last finished day (today is half-synced); last year runs the
 * whole axis, so "where is this going" reads at a glance. A day without
 * sales data adds nothing (as in the totals). `ly` is null throughout when
 * the panel has no sales from last year at all.
 */
export function cumulativeNet(rows: readonly NetRow[], today: string): CumulativePoint[] {
  const hasLy = rows.some((r) => r.ly.revenue !== null);
  let cur = 0;
  let ly = 0;
  return rows.map((r) => {
    const finished = r.date < today;
    if (finished) cur += r.net ?? 0;
    ly += r.ly.net ?? 0;
    return {
      date: r.date,
      lyDate: r.ly.date,
      cur: finished ? cur : null,
      ly: hasLy ? ly : null,
      moment: r.moment,
    };
  });
}

// ------------------------------------------------------------------- range

export type RangePreset = "season" | "month" | "30d" | "custom";

export interface SeasonWindowInput {
  start: string;
  end: string;
  /** The season's name year ("Sezon 2026"). */
  year: number;
}

export interface NetRange {
  preset: RangePreset;
  /** First and last day of the table (last <= today). */
  start: string;
  end: string;
  /** Last day of the chart's axis: the whole season / month, for last year's line. */
  axisEnd: string;
  label: string;
  /** True when a long custom range was cut to MAX_RANGE_DAYS. */
  clamped: boolean;
}

/** Longest range read at once: a year and a bit (a season with its run-up). */
export const MAX_RANGE_DAYS = 400;

const MONTHS = [
  "styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec",
  "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień",
];
const MONTHS_GEN = [
  "stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca",
  "lipca", "sierpnia", "września", "października", "listopada", "grudnia",
];
const WEEKDAYS = ["nd", "pn", "wt", "śr", "cz", "pt", "sb"];

/** "1 października" */
export function dayMonthPl(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTHS_GEN[Number(iso.slice(5, 7)) - 1]}`;
}

/** "27.11" */
export function dayDot(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

/** "pt" */
export function weekdayPl(iso: string): string {
  return WEEKDAYS[new Date(toTime(iso)).getUTCDay()];
}

const monthEnd = (iso: string) => {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/**
 * The window the page shows. Quick picks: the current season (seasonal
 * shops' default), this month (everyone else's) and the last 30 days; or a
 * custom from/to. The table never runs past today; today itself is shown
 * as a partial day.
 */
export function resolveNetRange(input: {
  range?: string | null;
  from?: string | null;
  to?: string | null;
  today: string;
  season: SeasonWindowInput | null;
}): NetRange {
  const { today, season } = input;
  if (isIsoDay(input.from) && isIsoDay(input.to) && input.from <= input.to) {
    const end = input.to > today ? today : input.to;
    let start = input.from > end ? end : input.from;
    const clamped = diffDaysIso(start, end) + 1 > MAX_RANGE_DAYS;
    if (clamped) start = addDaysIso(end, -(MAX_RANGE_DAYS - 1));
    const label = `${dayMonthPl(start)} ${start.slice(0, 4)} - ${dayMonthPl(end)} ${end.slice(0, 4)}`;
    return { preset: "custom", start, end, axisEnd: end, label, clamped };
  }
  const preset: RangePreset =
    input.range === "30d" || input.range === "month" || (input.range === "season" && season)
      ? (input.range as RangePreset)
      : season
        ? "season"
        : "month";
  if (preset === "season" && season) {
    // A season that hasn't started yet this year shows the last one.
    const end = season.end < today ? season.end : today;
    const running = today >= season.start && today <= season.end;
    return {
      preset,
      start: season.start,
      end,
      axisEnd: season.end,
      label: running
        ? `Sezon ${season.year} · od ${dayMonthPl(season.start)} do dziś`
        : `Sezon ${season.year} · ${dayMonthPl(season.start)} - ${dayMonthPl(season.end)}`,
      clamped: false,
    };
  }
  if (preset === "30d") {
    return { preset, start: addDaysIso(today, -30), end: today, axisEnd: today, label: "Ostatnie 30 dni", clamped: false };
  }
  const start = `${today.slice(0, 7)}-01`;
  const name = MONTHS[Number(today.slice(5, 7)) - 1];
  return {
    preset: "month",
    start,
    end: today,
    axisEnd: monthEnd(today),
    label: `${name.charAt(0).toUpperCase()}${name.slice(1)} ${today.slice(0, 4)}`,
    clamped: false,
  };
}

// -------------------------------------------------------------- the view

export interface DailyNetView {
  /** The table: range start .. range end (today included, as partial). */
  rows: NetRow[];
  /** The chart: range start .. axis end (the rest of the season / month). */
  chart: CumulativePoint[];
  comparison: NetComparison;
  change: ReturnType<typeof totalChange>;
  showY2: boolean;
}

/** Everything the page shows, from the merged day inputs. Shared by the live page and the demo. */
export function buildDailyNetView(
  range: Pick<NetRange, "start" | "end" | "axisEnd">,
  mode: CompareMode,
  today: string,
  days: DayInputs,
  blackFridays: readonly string[]
): DailyNetView {
  const axis = buildRows(datesBetween(range.start, range.axisEnd), today, mode, days, blackFridays);
  const rows = axis.filter((r) => r.date <= range.end);
  return {
    rows,
    chart: cumulativeNet(axis, today),
    comparison: compareRows(rows),
    change: totalChange(rows),
    showY2: showTwoYearsBack(rows),
  };
}

/** Years whose Black Friday the view may need (two years back to the axis end). */
export function yearsOf(range: Pick<NetRange, "start" | "axisEnd">): number[] {
  const from = Number(range.start.slice(0, 4)) - 2;
  const to = Number(range.axisEnd.slice(0, 4));
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** The windows the page reads: this range (with its axis), a year back, two years back. */
export function readWindows(range: Pick<NetRange, "start" | "axisEnd">): Array<{ start: string; end: string }> {
  const span = (years: number) => {
    // Both comparison modes at once (the date and 364 days back differ by a
    // day or two), so switching modes reads nothing new.
    const starts = [alignedDate(range.start, "date", years), alignedDate(range.start, "weekday", years)].sort();
    const ends = [alignedDate(range.axisEnd, "date", years), alignedDate(range.axisEnd, "weekday", years)].sort();
    return { start: starts[0], end: ends[1] };
  };
  return [{ start: range.start, end: range.axisEnd }, span(1), span(2)];
}
