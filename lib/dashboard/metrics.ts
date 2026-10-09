import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  format,
  startOfMonth,
  subDays,
  subMonths,
} from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";

import {
  adsTotalsViewUsable,
  getAdsDayTotals,
  type AdsDayTotal,
} from "@/lib/dashboard/ads-totals";
import {
  detectCampaignEvents,
  EVENT_LOOKBACK_DAYS,
  EVENT_NEAR_DAYS,
  eventCandidates,
  type CampaignSpendRow,
  type ChartEvent,
} from "@/lib/dashboard/chart-events";
import {
  RANGE_LABELS,
  type CustomRange,
  type RangeKey,
} from "@/lib/dashboard/ranges";
import { syncCached } from "@/lib/dashboard/sync-cache";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchAll,
  fetchAllByDateChunks,
  fetchAllSequential,
} from "@/lib/supabase/fetch-all";
import { createClient } from "@/lib/supabase/server";
import type { AdProvider } from "@/lib/types";

export {
  RANGE_KEYS,
  RANGE_LABELS,
  normalizeRange,
  parseCustomRange,
} from "@/lib/dashboard/ranges";
export type { CustomRange, RangeKey } from "@/lib/dashboard/ranges";

const WARSAW_TZ = "Europe/Warsaw";

interface ResolvedRange {
  start: string;
  end: string;
  prevStart: string;
  prevEnd: string;
}

const fmt = (d: Date) => format(d, "yyyy-MM-dd");

// A selected period plus its comparison baseline. Month presets compare
// day-for-day against the previous month (proportional), not the full month.
function resolveRange(key: RangeKey, today: Date): ResolvedRange {
  if (key === "month") {
    const dayOfMonth = today.getDate();
    const prevMonthStart = startOfMonth(subMonths(today, 1));
    const prevMonthEnd = endOfMonth(prevMonthStart);
    const prevSameDay = addDays(
      prevMonthStart,
      Math.min(dayOfMonth, prevMonthEnd.getDate()) - 1
    );
    return {
      start: fmt(startOfMonth(today)),
      end: fmt(today),
      prevStart: fmt(prevMonthStart),
      prevEnd: fmt(prevSameDay),
    };
  }
  if (key === "prev_month") {
    return {
      start: fmt(startOfMonth(subMonths(today, 1))),
      end: fmt(endOfMonth(subMonths(today, 1))),
      prevStart: fmt(startOfMonth(subMonths(today, 2))),
      prevEnd: fmt(endOfMonth(subMonths(today, 2))),
    };
  }

  const days = key === "7d" ? 7 : key === "90d" ? 90 : key === "365d" ? 365 : 30;
  const start = subDays(today, days - 1);
  const prevEnd = subDays(start, 1);
  const prevStart = subDays(prevEnd, days - 1);
  return {
    start: fmt(start),
    end: fmt(today),
    prevStart: fmt(prevStart),
    prevEnd: fmt(prevEnd),
  };
}

export interface Kpi {
  value: number;
  previous: number;
  deltaPercent: number | null;
}

export interface DashboardKpis {
  spendMinorUnits: Kpi;
  clicks: Kpi;
  sessions: Kpi;
  ctr: Kpi; // percent
  cpcMinorUnits: Kpi;
  conversions: Kpi;
}

export interface TrendPoint {
  date: string;
  spendMinorUnits: number;
  sessions: number;
  clicks: number;
  impressions: number;
  conversions: number;
  revenueMinorUnits: number;
  transactions: number;
}

export interface EcommerceKpis {
  revenueMinorUnits: Kpi;
  transactions: Kpi;
  roas: Kpi; // ratio ×100 (UI divides by 100)
  aovMinorUnits: Kpi;
}

export type CampaignStatus = "active" | "attention" | "critical" | "off";

export interface CampaignRow {
  campaignId: string;
  provider: AdProvider;
  name: string;
  spendMinorUnits: number;
  clicks: number;
  impressions: number;
  ctr: number; // percent
  cpcMinorUnits: number | null;
  conversions: number;
  status: CampaignStatus;
  statusReason: string | null;
  spark: number[]; // daily spend, last 7 days of the range
}

export interface CostTrendPoint {
  date: string;
  metaCpcMinorUnits: number | null;
  googleCpcMinorUnits: number | null;
}

export interface PlatformSplit {
  metaSpendMinorUnits: number;
  googleSpendMinorUnits: number;
  tiktokSpendMinorUnits: number;
}

export interface DashboardData {
  kpis: DashboardKpis;
  ecommerce: EcommerceKpis;
  trend: TrendPoint[];
  campaigns: CampaignRow[];
  costTrend: CostTrendPoint[];
  platformSplit: PlatformSplit;
  rangeKey: RangeKey;
  rangeLabel: string;
  rangeStart: string;
  rangeEnd: string;
  /**
   * Comparison period day by day (same shape as `trend`, aligned by index).
   * Optional so hand-built DashboardData (demo, reports) stays valid.
   */
  prevTrend?: TrendPoint[];
  /** Campaign starts/pauses/budget jumps derived from ads_daily (chart markers). */
  autoEvents?: ChartEvent[];
  /**
   * GA4 engagement rate (percent) over the selected range, sessions-weighted.
   * The sales funnel multiplies range sessions by it; borrowing the Witryna
   * tab's fixed 30-day rate mixed two windows in one card. Null when no
   * daily-total row in range carries a rate. Optional for hand-built data.
   */
  engagementRate?: number | null;
  /**
   * False when the synced history doesn't reach back over the comparison
   * period (long ranges): the deltas are then left out, not guessed.
   */
  comparable?: boolean;
}

/** A raw ads_daily row as the row-reading path reads it. */
interface AdsRow {
  provider: AdProvider;
  campaign_id: string;
  campaign_name: string | null;
  date: string;
  spend_minor_units: number | string;
  clicks: number | string;
  impressions: number | string;
  conversions: number | string | null;
  frequency: number | string | null;
}

/** One campaign over the range: what the table, its status and spark use. */
interface CampaignTotals {
  campaignId: string;
  provider: AdProvider;
  name: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  /** The range's last 2 days ("w ostatnich 48 godzinach"). */
  recentSpend: number;
  recentImpressions: number;
  earlierSpend: number;
  freqSum: number;
  freqCount: number;
  /** Spend on each of the range's last 7 days, oldest first. */
  spark: number[];
}

/** The ads side of the dashboard, whichever way it was read. */
interface AdsInputs {
  /** Per day and platform in [start, end]. */
  range: AdsDayTotal[];
  /** Per day and platform in [prevStart, prevEnd]; empty without a baseline. */
  prev: AdsDayTotal[];
  /**
   * In order of first appearance by (date, provider, campaign_id): the
   * campaign table's spend sort is stable, so this order breaks its ties.
   */
  campaigns: CampaignTotals[];
  autoEvents: ChartEvent[];
}

interface AdsLoad {
  db: SupabaseClient;
  clientId: string;
  range: ResolvedRange;
  todayStr: string;
  adsBaseline: boolean;
  /** First day of ads history in play: prevStart with a baseline, else start. */
  adsFrom: string;
}

const shiftDate = (d: string, days: number) => fmt(addDays(new Date(`${d}T00:00:00`), days));
const laterDate = (a: string, b: string) => (a > b ? a : b);
const campaignKey = (provider: string, campaignId: string) => `${provider}:${campaignId}`;

// Ranges longer than this read per-campaign totals from Postgres (migration
// 0043) instead of one row per campaign per day.
const LONG_RANGE_DAYS = 45;
// "Ta sama osoba widziała reklamę średnio ponad 4 razy".
const FREQ_ATTENTION = 4;

/** Sums rows per (date, provider) - integers, so the order never matters. */
function sumByDay(rows: AdsRow[]): AdsDayTotal[] {
  const byKey = new Map<string, AdsDayTotal>();
  for (const r of rows) {
    const key = `${r.date}|${r.provider}`;
    let t = byKey.get(key);
    if (!t) {
      t = { date: r.date, provider: r.provider, spend: 0, clicks: 0, impressions: 0, conversions: 0 };
      byKey.set(key, t);
    }
    t.spend += Number(r.spend_minor_units);
    t.clicks += Number(r.clicks);
    t.impressions += Number(r.impressions);
    t.conversions += Number(r.conversions ?? 0);
  }
  return Array.from(byKey.values());
}

/**
 * provider/campaign_id/date/spend rows in [from, to], ordered like every
 * ads_daily read here (date, provider, campaign_id). `keys` limits them to
 * those campaigns (null: all); names only when asked for.
 */
async function readSpendRows(
  a: AdsLoad,
  from: string,
  to: string,
  keys: ReadonlySet<string> | null,
  withNames: boolean
): Promise<CampaignSpendRow[]> {
  if (from > to || (keys && keys.size === 0)) return [];
  const ids = keys
    ? Array.from(new Set(Array.from(keys, (k) => k.slice(k.indexOf(":") + 1))))
    : null;
  type Row = {
    provider: AdProvider;
    campaign_id: string;
    campaign_name?: string | null;
    date: string;
    spend_minor_units: number | string;
  };
  const rows = await fetchAllByDateChunks<Row>(from, to, keys ? 31 : 14, (chunkStart, chunkEnd) =>
    (pageFrom, pageTo) => {
      let q = a.db
        .from("ads_daily")
        .select(
          withNames
            ? "provider, campaign_id, campaign_name, date, spend_minor_units"
            : "provider, campaign_id, date, spend_minor_units"
        )
        .eq("client_id", a.clientId)
        .gte("date", chunkStart)
        .lte("date", chunkEnd);
      if (ids) q = q.in("campaign_id", ids);
      return q
        .order("date", { ascending: true })
        .order("provider", { ascending: true })
        .order("campaign_id", { ascending: true })
        .range(pageFrom, pageTo) as unknown as PromiseLike<{
        data: Row[] | null;
        error: { message: string } | null;
      }>;
    }
  );
  const out: CampaignSpendRow[] = [];
  for (const r of rows) {
    // campaign_id alone can match the same id on another platform.
    if (keys && !keys.has(campaignKey(r.provider, r.campaign_id))) continue;
    out.push({
      provider: r.provider,
      campaignId: r.campaign_id,
      campaignName: withNames ? (r.campaign_name ?? null) : null,
      date: r.date,
      spendMinorUnits: Number(r.spend_minor_units),
    });
  }
  return out;
}

/**
 * Chart annotations from rows that start at `leadFrom` (EVENT_LOOKBACK_DAYS
 * before the range) instead of at the baseline's first day. Detection never
 * looks at days before that, so its result only depends on the older rows
 * through two things: a campaign's latest non-empty name, and its first
 * appearance - the tie-break between campaigns of exactly equal spend in the
 * importance window. For the campaigns where either could differ (a
 * candidate without a name in the rows, or tied with another candidate) the
 * older rows are read and put first, as in one read from the baseline's
 * start; everyone else's result is the same by construction.
 */
async function detectAutoEvents(
  a: AdsLoad,
  leadFrom: string,
  rows: CampaignSpendRow[],
  nearSpend: Map<string, number>,
  named: ReadonlySet<string>,
  knownDates?: Iterable<string>
): Promise<ChartEvent[]> {
  let all = rows;
  if (a.adsFrom < leadFrom) {
    const involved = new Set<string>();
    const firstAt = new Map<number, string>();
    for (const key of eventCandidates(nearSpend)) {
      if (!named.has(key)) involved.add(key);
      const spend = nearSpend.get(key) ?? 0;
      const other = firstAt.get(spend);
      if (other === undefined) {
        firstAt.set(spend, key);
      } else {
        involved.add(other);
        involved.add(key);
      }
    }
    if (involved.size > 0) {
      const older = await readSpendRows(a, a.adsFrom, shiftDate(leadFrom, -1), involved, true);
      all = [...older, ...rows];
    }
  }
  return detectCampaignEvents({
    rows: all,
    dataStart: a.range.prevStart,
    rangeStart: a.range.start,
    rangeEnd: a.range.end,
    today: a.todayStr,
    knownDates,
  });
}

/**
 * Short ranges: the range's rows (plus the lead-in days chart annotations
 * look at) one per campaign per day, the baseline as per-day totals
 * (ads_daily_totals) - the baseline only ever needed sums per day, and its
 * rows were half of every read. Where the rows already cover the baseline
 * ("Ostatnie 7 dni") or the view is known to be missing, the baseline is
 * summed from the rows as before.
 */
async function loadAdsFromRows(a: AdsLoad): Promise<AdsInputs> {
  const { db, clientId, range } = a;
  const leadFrom = adsTotalsViewUsable()
    ? laterDate(a.adsFrom, shiftDate(range.start, -EVENT_LOOKBACK_DAYS))
    : a.adsFrom;
  const prevFromRows = leadFrom <= range.prevStart;

  // Paginated reads: a long range on a large account easily exceeds
  // PostgREST's silent ~1000-row cap, which would truncate KPIs and trends.
  // Read in two-week chunks side by side (same rows, same order as one read):
  // one long OFFSET-paged read re-walked every earlier page for each new one.
  const [prevTotals, rows] = await Promise.all([
    a.adsBaseline && !prevFromRows
      ? getAdsDayTotals(db, clientId, range.prevStart, range.prevEnd)
      : Promise.resolve([] as AdsDayTotal[]),
    fetchAllByDateChunks<AdsRow>(leadFrom, range.end, 14, (chunkStart, chunkEnd) =>
      (from, to) =>
        db
          .from("ads_daily")
          .select(
            "provider, campaign_id, campaign_name, date, spend_minor_units, clicks, impressions, conversions, frequency"
          )
          .eq("client_id", clientId)
          .gte("date", chunkStart)
          .lte("date", chunkEnd)
          .order("date", { ascending: true })
          .order("provider", { ascending: true })
          .order("campaign_id", { ascending: true })
          .range(from, to)
    ),
  ]);

  const rangeRows = rows.filter((r) => r.date >= range.start && r.date <= range.end);
  const prev =
    a.adsBaseline && prevFromRows
      ? sumByDay(rows.filter((r) => r.date >= range.prevStart && r.date <= range.prevEnd))
      : prevTotals;

  // --- Campaigns with health inputs ---
  const endDate = new Date(`${range.end}T00:00:00`);
  const sparkStart = fmt(subDays(endDate, 6));
  const recentStart = fmt(subDays(endDate, 1)); // last 2 days
  interface CampAgg extends Omit<CampaignTotals, "spark"> {
    sparkByDate: Map<string, number>;
  }
  const campaignMap = new Map<string, CampAgg>();
  for (const row of rangeRows) {
    const key = campaignKey(row.provider, row.campaign_id);
    const agg =
      campaignMap.get(key) ??
      ({
        campaignId: row.campaign_id,
        provider: row.provider,
        name: row.campaign_name || row.campaign_id,
        spend: 0,
        clicks: 0,
        impressions: 0,
        conversions: 0,
        recentSpend: 0,
        recentImpressions: 0,
        earlierSpend: 0,
        freqSum: 0,
        freqCount: 0,
        sparkByDate: new Map<string, number>(),
      } as CampAgg);

    const spend = Number(row.spend_minor_units);
    const impressions = Number(row.impressions);
    agg.spend += spend;
    agg.clicks += Number(row.clicks);
    agg.impressions += impressions;
    agg.conversions += Number(row.conversions ?? 0);

    if (row.date >= recentStart) {
      agg.recentSpend += spend;
      agg.recentImpressions += impressions;
    } else {
      agg.earlierSpend += spend;
    }
    if (row.frequency != null) {
      agg.freqSum += Number(row.frequency);
      agg.freqCount += 1;
    }
    if (row.date >= sparkStart) {
      agg.sparkByDate.set(row.date, (agg.sparkByDate.get(row.date) ?? 0) + spend);
    }
    campaignMap.set(key, agg);
  }
  const campaigns: CampaignTotals[] = Array.from(campaignMap.values(), (c) => {
    const { sparkByDate, ...totals } = c;
    // Zero-filled 7-day spend sparkline.
    const spark: number[] = [];
    for (let i = 6; i >= 0; i--) spark.push(sparkByDate.get(fmt(subDays(endDate, i))) ?? 0);
    return { ...totals, spark };
  });

  // --- Chart annotations ---
  const nearFrom = shiftDate(range.start, -EVENT_NEAR_DAYS);
  const nearSpend = new Map<string, number>();
  const named = new Set<string>();
  const eventRows: CampaignSpendRow[] = rows.map((r) => {
    const key = campaignKey(r.provider, r.campaign_id);
    const spend = Number(r.spend_minor_units);
    if (r.date >= nearFrom) nearSpend.set(key, (nearSpend.get(key) ?? 0) + spend);
    if (r.campaign_name) named.add(key);
    return {
      provider: r.provider,
      campaignId: r.campaign_id,
      campaignName: r.campaign_name,
      date: r.date,
      spendMinorUnits: spend,
    };
  });
  const autoEvents = await detectAutoEvents(a, leadFrom, eventRows, nearSpend, named);

  return { range: sumByDay(rangeRows), prev, campaigns, autoEvents };
}

interface CampaignRangeRow {
  provider: AdProvider;
  campaign_id: string;
  first_date: string;
  first_name: string | null;
  last_name: string | null;
  spend_minor_units: number | string;
  clicks: number | string;
  impressions: number | string;
  conversions: number | string;
  recent_spend: number | string;
  recent_impressions: number | string;
  earlier_spend: number | string;
  freq_sum: number | string | null;
  freq_count: number | string;
  spark: Array<number | string>;
}

const CAMPAIGN_TOTALS_RPC = "campaign_range_totals";
const RETRY_RPC_AFTER_MS = 10 * 60_000;
let rpcMissingUntil = 0;

/**
 * Long ranges: per-campaign totals summed in Postgres (0043), per-day totals
 * from ads_daily_totals, and day-by-day rows only where something needs the
 * days: the lead-in days of the chart annotations and the campaigns that can
 * become one (eventCandidates). "Ostatni rok" of an OLX-size account was
 * ~285 000 rows; this is a few thousand.
 */
async function loadAdsFromTotals(a: AdsLoad): Promise<AdsInputs> {
  const { db, clientId, range } = a;
  const leadFrom = laterDate(a.adsFrom, shiftDate(range.start, -EVENT_LOOKBACK_DAYS));
  const [days, totals, leadRows] = await Promise.all([
    // Without the view, plan B is the row path, not every row of the window.
    getAdsDayTotals(db, clientId, a.adsFrom, range.end, { rawFallback: false }),
    // One page for any realistic account (a campaign per row); each page
    // re-runs the aggregate, hence no count and no speculative pages.
    fetchAllSequential<CampaignRangeRow>((from, to) =>
      db
        .rpc(CAMPAIGN_TOTALS_RPC, {
          p_client_id: clientId,
          p_start: range.start,
          p_end: range.end,
        })
        // = first appearance in rows ordered (date, provider, campaign_id).
        .order("first_date", { ascending: true })
        .order("provider", { ascending: true })
        .order("campaign_id", { ascending: true })
        .range(from, to)
    ),
    readSpendRows(a, leadFrom, shiftDate(range.start, -1), null, true),
  ]);

  const rangeDays = days.filter((t) => t.date >= range.start && t.date <= range.end);
  const prev = days.filter((t) => t.date >= range.prevStart && t.date <= range.prevEnd);

  // --- Chart annotations: which campaigns need their days ---
  const nearFrom = shiftDate(range.start, -EVENT_NEAR_DAYS);
  const nearSpend = new Map<string, number>();
  const named = new Set<string>();
  for (const r of leadRows) {
    const key = campaignKey(r.provider, r.campaignId);
    if (r.date >= nearFrom) nearSpend.set(key, (nearSpend.get(key) ?? 0) + r.spendMinorUnits);
    if (r.campaignName) named.add(key);
  }
  for (const t of totals) {
    const key = campaignKey(t.provider, t.campaign_id);
    nearSpend.set(key, (nearSpend.get(key) ?? 0) + Number(t.spend_minor_units));
    if (t.last_name) named.add(key);
  }
  const candidates = eventCandidates(nearSpend);
  const candidatesInRange = new Set(
    totals.map((t) => campaignKey(t.provider, t.campaign_id)).filter((k) => candidates.has(k))
  );

  // avgFreq is only ever compared with FREQ_ATTENTION. The exact numeric sum
  // decides it unless the average sits within 1e-9 of the threshold, where
  // the old per-row float sum (error < 1e-11 for any real range) could land
  // on the other side: those few campaigns are summed from their rows, as
  // before.
  const borderline = new Set(
    totals
      .filter((t) => {
        const n = Number(t.freq_count);
        return n > 0 && Math.abs(Number(t.freq_sum) / n - FREQ_ATTENTION) <= 1e-9;
      })
      .map((t) => campaignKey(t.provider, t.campaign_id))
  );

  const [candidateRows, exactFreq] = await Promise.all([
    readSpendRows(a, range.start, range.end, candidatesInRange, false),
    readFrequencySums(a, borderline),
  ]);

  const campaigns: CampaignTotals[] = totals.map((t) => {
    const exact = exactFreq.get(campaignKey(t.provider, t.campaign_id));
    return {
      campaignId: t.campaign_id,
      provider: t.provider,
      // The first row in the range names the campaign (as the row loop did).
      name: t.first_name || t.campaign_id,
      spend: Number(t.spend_minor_units),
      clicks: Number(t.clicks),
      impressions: Number(t.impressions),
      conversions: Number(t.conversions),
      recentSpend: Number(t.recent_spend),
      recentImpressions: Number(t.recent_impressions),
      earlierSpend: Number(t.earlier_spend),
      freqSum: exact ? exact.sum : Number(t.freq_sum ?? 0),
      freqCount: exact ? exact.count : Number(t.freq_count),
      spark: t.spark.map(Number),
    };
  });

  // Detection input, equivalent to every row from leadFrom on:
  // - lead-in rows of every campaign (as read, names included),
  // - candidates' range rows; their latest non-empty name (0043) rides on
  //   one of them - detection keeps the last name it sees, and these come
  //   after every lead-in row,
  // - everyone else's range spend as one row on a day it really has a row:
  //   only its total counts (importance, account average),
  // - days with any row (ads_daily_totals), so sync gaps stay gaps.
  const lastName = new Map(totals.map((t) => [campaignKey(t.provider, t.campaign_id), t.last_name]));
  const eventRows: CampaignSpendRow[] = [...leadRows];
  const nameGiven = new Set<string>();
  for (const r of candidateRows) {
    const key = campaignKey(r.provider, r.campaignId);
    let campaignName: string | null = null;
    if (!nameGiven.has(key)) {
      nameGiven.add(key);
      campaignName = lastName.get(key) || null;
    }
    eventRows.push({ ...r, campaignName });
  }
  for (const t of totals) {
    const spend = Number(t.spend_minor_units);
    if (candidates.has(campaignKey(t.provider, t.campaign_id)) || spend === 0) continue;
    eventRows.push({
      provider: t.provider,
      campaignId: t.campaign_id,
      campaignName: null,
      date: t.first_date,
      spendMinorUnits: spend,
    });
  }
  const autoEvents = await detectAutoEvents(
    a,
    leadFrom,
    eventRows,
    nearSpend,
    named,
    rangeDays.map((t) => t.date)
  );

  return { range: rangeDays, prev, campaigns, autoEvents };
}

/** Per-row frequency sums (in date order, as the row loop added them). */
async function readFrequencySums(
  a: AdsLoad,
  keys: ReadonlySet<string>
): Promise<Map<string, { sum: number; count: number }>> {
  const out = new Map<string, { sum: number; count: number }>();
  if (keys.size === 0) return out;
  const ids = Array.from(new Set(Array.from(keys, (k) => k.slice(k.indexOf(":") + 1))));
  type Row = { provider: string; campaign_id: string; frequency: number | string | null };
  const rows = await fetchAllByDateChunks<Row>(a.range.start, a.range.end, 31, (chunkStart, chunkEnd) =>
    (from, to) =>
      a.db
        .from("ads_daily")
        .select("provider, campaign_id, date, frequency")
        .eq("client_id", a.clientId)
        .in("campaign_id", ids)
        .gte("date", chunkStart)
        .lte("date", chunkEnd)
        .order("date", { ascending: true })
        .order("provider", { ascending: true })
        .order("campaign_id", { ascending: true })
        .range(from, to)
  );
  for (const r of rows) {
    const key = campaignKey(r.provider, r.campaign_id);
    if (!keys.has(key)) continue;
    const acc = out.get(key) ?? { sum: 0, count: 0 };
    if (r.frequency != null) {
      acc.sum += Number(r.frequency);
      acc.count += 1;
    }
    out.set(key, acc);
  }
  return out;
}

async function loadAdsInputs(a: AdsLoad): Promise<AdsInputs> {
  const days =
    differenceInCalendarDays(
      new Date(`${a.range.end}T00:00:00`),
      new Date(`${a.range.start}T00:00:00`)
    ) + 1;
  if (days > LONG_RANGE_DAYS && Date.now() >= rpcMissingUntil && adsTotalsViewUsable()) {
    try {
      return await loadAdsFromTotals(a);
    } catch (err) {
      // Until 0043 has run the function doesn't exist ("Could not find the
      // function public.campaign_range_totals(...) in the schema cache"):
      // remember that for a while instead of paying a failed call on every
      // miss. Anything else (a timeout, the view missing - ads-totals keeps
      // its own note) just falls back this once. Same numbers either way.
      const msg = String((err as Error)?.message ?? err);
      if (msg.includes(CAMPAIGN_TOTALS_RPC)) {
        rpcMissingUntil = Date.now() + RETRY_RPC_AFTER_MS;
      }
    }
  }
  return loadAdsFromRows(a);
}

function kpi(value: number, previous: number): Kpi {
  const deltaPercent =
    previous > 0 ? ((value - previous) / previous) * 100 : null;
  return { value, previous, deltaPercent };
}

/**
 * Like kpi(), but the % compares like with like when the range ends today
 * (or the two windows differ in length - then per-day rates, too).
 * Today is a partial day (synced hourly) while the baseline's days are all
 * complete, so raw totals read as a drop every morning: "Bieżący miesiąc" on
 * the 2nd at 9:00 showed clicks "-60%" and the story claimed a slump. The
 * change is then the per-day rate over the finished days vs the baseline's
 * per-day rate; value/previous stay the real totals. `cmp` is null for a
 * range that is only today (nothing finished to compare yet).
 */
function kpiRate(
  value: number,
  previous: number,
  cmp: { value: number; days: number; prevDays: number } | null
): Kpi {
  if (!cmp) return kpi(value, previous);
  if (cmp.days <= 0 || cmp.prevDays <= 0 || previous <= 0) {
    return { value, previous, deltaPercent: null };
  }
  const rate = cmp.value / cmp.days;
  const prevRate = previous / cmp.prevDays;
  return { value, previous, deltaPercent: ((rate - prevRate) / prevRate) * 100 };
}

/** Ratio KPIs (CTR, CPC, ROAS, AOV): the % compares finished days only. */
function kpiRatio(value: number, previous: number, cmpValue: number | null): Kpi {
  if (cmpValue === null) return kpi(value, previous);
  return {
    value,
    previous,
    deltaPercent: previous > 0 ? ((cmpValue - previous) / previous) * 100 : null,
  };
}

function ctrOf(clicks: number, impressions: number): number {
  return impressions > 0 ? (clicks / impressions) * 100 : 0;
}

function cpcOf(spend: number, clicks: number): number {
  return clicks > 0 ? spend / clicks : 0;
}

// Zero-filled daily series for the comparison period, so the chart can draw
// "previous period" aligned by day index without a second round-trip.
function buildPrevTrend(
  rows: AdsDayTotal[],
  ga4Rows: Array<{
    date: string;
    sessions: number | string;
    revenue_minor_units?: number | string | null;
    transactions?: number | string | null;
  }>,
  prevStart: string,
  prevEnd: string
): TrendPoint[] {
  const start = new Date(`${prevStart}T00:00:00`);
  const days =
    differenceInCalendarDays(new Date(`${prevEnd}T00:00:00`), start) + 1;
  if (days <= 0) return [];

  const byDate = new Map<string, TrendPoint>();
  const out: TrendPoint[] = [];
  for (let i = 0; i < days; i++) {
    const point: TrendPoint = {
      date: fmt(addDays(start, i)),
      spendMinorUnits: 0,
      sessions: 0,
      clicks: 0,
      impressions: 0,
      conversions: 0,
      revenueMinorUnits: 0,
      transactions: 0,
    };
    byDate.set(point.date, point);
    out.push(point);
  }
  for (const r of rows) {
    const p = byDate.get(r.date);
    if (!p) continue;
    p.spendMinorUnits += r.spend;
    p.clicks += r.clicks;
    p.impressions += r.impressions;
    p.conversions += r.conversions;
  }
  for (const r of ga4Rows) {
    const p = byDate.get(r.date);
    if (!p) continue;
    p.sessions += Number(r.sessions);
    p.revenueMinorUnits += Number(r.revenue_minor_units ?? 0);
    p.transactions += Number(r.transactions ?? 0);
  }
  return out;
}

export interface DashboardRange extends ResolvedRange {
  label: string;
  /** Warsaw "today" the range was resolved against. */
  today: string;
}

/**
 * The window getDashboardData reads, without reading it. Pages use it to
 * start range-dependent queries (events, YoY, products) in the same round as
 * the dashboard data instead of waiting for `data.rangeStart`.
 */
export function resolveDashboardRange(
  rangeKey: RangeKey = "30d",
  custom?: CustomRange | null
): DashboardRange {
  const todayStr = formatInTimeZone(new Date(), WARSAW_TZ, "yyyy-MM-dd");
  // A custom from/to overrides the preset; its baseline is the same-length
  // period immediately before it (for the vs-previous deltas).
  if (custom) {
    // Days after today have no data yet: a range reaching into the future
    // read as a collapse against its full baseline and drew empty days.
    const endStr = custom.end > todayStr ? todayStr : custom.end;
    const startStr = custom.start > endStr ? endStr : custom.start;
    const start = new Date(`${startStr}T00:00:00`);
    const end = new Date(`${endStr}T00:00:00`);
    const len = differenceInCalendarDays(end, start) + 1;
    const prevEnd = subDays(start, 1);
    return {
      start: startStr,
      end: endStr,
      prevStart: fmt(subDays(prevEnd, len - 1)),
      prevEnd: fmt(prevEnd),
      label: `${startStr} - ${endStr}`,
      today: todayStr,
    };
  }
  return {
    ...resolveRange(rangeKey, new Date(`${todayStr}T00:00:00`)),
    label: RANGE_LABELS[rangeKey],
    today: todayStr,
  };
}

/**
 * Everything the dashboard needs for a date range: period-over-period KPIs
 * (ads + GA4 sessions), per-day trend, campaign list with health status and
 * 7-day sparklines, CPC trends per platform and the Meta/Google spend split.
 */
export async function getDashboardData(
  clientId: string,
  rangeKey: RangeKey = "30d",
  custom?: CustomRange | null,
  // Background jobs (cron) have no user session/cookies, so they pass the
  // service-role client. Pages omit it and keep reading through RLS.
  db?: SupabaseClient
): Promise<DashboardData> {
  const supabase: SupabaseClient = db ?? createClient();

  const resolved = resolveDashboardRange(rangeKey, custom);
  const todayStr = resolved.today;
  const label = resolved.label;
  const range: ResolvedRange = resolved;

  // The baseline must exist in the synced history: "Ostatni rok", a past
  // season picked by hand, or simply a client connected three weeks ago -
  // a half-empty baseline reads as "+300%". Where a source's history starts
  // after the baseline's first few days, that baseline is neither read nor
  // compared. Two one-row lookups (cached with the rest per sync stamp).
  const baselineSlack = Math.min(
    7,
    Math.floor(
      (differenceInCalendarDays(new Date(`${range.prevEnd}T00:00:00`), new Date(`${range.prevStart}T00:00:00`)) + 1) / 4
    )
  );
  const coveredFrom = (earliest: string | null) =>
    earliest !== null && earliest <= fmt(addDays(new Date(`${range.prevStart}T00:00:00`), baselineSlack));
  const [adsEarliest, ga4Earliest] = await Promise.all([
        supabase
          .from("ads_daily")
          .select("date")
          .eq("client_id", clientId)
          .order("date", { ascending: true })
          .limit(1)
          .maybeSingle()
          .then((r) => (r.data?.date as string | undefined) ?? null),
        supabase
          .from("ga4_daily")
          .select("date")
          .eq("client_id", clientId)
          .is("source_medium", null)
          .is("device_category", null)
          .is("page_path", null)
          .order("date", { ascending: true })
          .limit(1)
          .maybeSingle()
          .then((r) => (r.data?.date as string | undefined) ?? null),
      ]);
  const adsBaseline = coveredFrom(adsEarliest);
  const ga4Baseline = coveredFrom(ga4Earliest);
  const adsFrom = adsBaseline ? range.prevStart : range.start;
  const ga4From = ga4Baseline ? range.prevStart : range.start;

  type Ga4TotalRow = {
    date: string;
    sessions: number | string;
    engagement_rate: number | string | null;
    revenue_minor_units: number | string | null;
    transactions: number | string | null;
  };
  const readGa4 = (columns: string) =>
    fetchAll<Ga4TotalRow>((from, to) =>
      supabase
        .from("ga4_daily")
        .select(
          columns as "date, sessions, engagement_rate, revenue_minor_units, transactions"
        )
        .eq("client_id", clientId)
        .is("source_medium", null)
        .is("device_category", null)
        .is("page_path", null)
        .gte("date", ga4From)
        .lte("date", range.end)
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    );

  // The ads side, read by range length (loadAdsInputs): every number is a
  // sum of the same integers the old one-row-per-campaign-per-day read
  // summed, so it does not depend on the path.
  const [ads, ga4Rows] = await Promise.all([
    loadAdsInputs({ db: supabase, clientId, range, todayStr, adsBaseline, adsFrom }),
    // GA4 daily totals only (dimension columns null). The revenue columns
    // land with migration 0016: ask for them straight away and only fall
    // back to the base columns when that select errors. This used to be a
    // separate probe query awaited before both reads - a whole extra round
    // trip on every dashboard render to cover a long-applied migration.
    readGa4("date, sessions, engagement_rate, revenue_minor_units, transactions").catch(
      () => readGa4("date, sessions, engagement_rate")
    ),
  ]);

  const inRange = (d: string) => d >= range.start && d <= range.end;
  const inPrev = (d: string) => d >= range.prevStart && d <= range.prevEnd;

  // --- KPI accumulators ---
  let curSpend = 0, curClicks = 0, curImpr = 0, curConv = 0;
  let prevSpend = 0, prevClicks = 0, prevImpr = 0, prevConv = 0;
  // Today's share of the current totals (see kpiRate).
  let todSpend = 0, todClicks = 0, todImpr = 0, todConv = 0;
  let todSessions = 0, todRevenue = 0, todTransactions = 0;

  for (const t of ads.range) {
    curSpend += t.spend;
    curClicks += t.clicks;
    curImpr += t.impressions;
    curConv += t.conversions;
    if (t.date === todayStr) {
      todSpend += t.spend;
      todClicks += t.clicks;
      todImpr += t.impressions;
      todConv += t.conversions;
    }
  }
  for (const t of ads.prev) {
    prevSpend += t.spend;
    prevClicks += t.clicks;
    prevImpr += t.impressions;
    prevConv += t.conversions;
  }

  let curSessions = 0;
  let prevSessions = 0;
  let curRevenue = 0, prevRevenue = 0;
  let curTransactions = 0, prevTransactions = 0;
  let curEngWeighted = 0, curEngSessions = 0;
  const sessionsByDate = new Map<string, number>();
  const revenueByDate = new Map<string, number>();
  const transactionsByDate = new Map<string, number>();
  for (const row of ga4Rows) {
    const sessions = Number(row.sessions);
    const revenue = Number(row.revenue_minor_units ?? 0);
    const transactions = Number(row.transactions ?? 0);
    if (inRange(row.date)) {
      curSessions += sessions;
      curRevenue += revenue;
      curTransactions += transactions;
      if (row.date === todayStr) {
        todSessions += sessions;
        todRevenue += revenue;
        todTransactions += transactions;
      }
      if (row.engagement_rate != null) {
        curEngWeighted += sessions * Number(row.engagement_rate);
        curEngSessions += sessions;
      }
      sessionsByDate.set(
        row.date,
        (sessionsByDate.get(row.date) ?? 0) + sessions
      );
      revenueByDate.set(row.date, (revenueByDate.get(row.date) ?? 0) + revenue);
      transactionsByDate.set(
        row.date,
        (transactionsByDate.get(row.date) ?? 0) + transactions
      );
    } else if (inPrev(row.date)) {
      prevSessions += sessions;
      prevRevenue += revenue;
      prevTransactions += transactions;
    }
  }

  // Range ending today: compare the finished days only (kpiRate). Per-day
  // rates also when the two windows differ in length: "Poprzedni miesiąc" in
  // March put 28 February days against 31 January ones and called a flat
  // month "o 10% mniej" (and a "Słabszy okres").
  const dayCount = (a: string, b: string) =>
    differenceInCalendarDays(new Date(`${b}T00:00:00`), new Date(`${a}T00:00:00`)) + 1;
  const partialToday = range.end === todayStr;
  const doneDays = dayCount(range.start, range.end) - (partialToday ? 1 : 0);
  const prevDays = dayCount(range.prevStart, range.prevEnd);
  const useRate = partialToday || doneDays !== prevDays;
  const cmp = (cur: number, tod: number) =>
    useRate ? { value: partialToday ? cur - tod : cur, days: doneDays, prevDays } : null;
  // Ratios over finished days; NaN-free (null = no finished days yet).
  const doneRatio = (f: () => number, base: number) =>
    !partialToday ? null : doneDays > 0 && base > 0 ? f() : Number.NaN;
  const ratioKpi = (value: number, previous: number, done: number | null) =>
    done !== null && Number.isNaN(done)
      ? { value, previous, deltaPercent: null }
      : kpiRatio(value, previous, done);

  const kpis: DashboardKpis = {
    spendMinorUnits: kpiRate(curSpend, prevSpend, cmp(curSpend, todSpend)),
    clicks: kpiRate(curClicks, prevClicks, cmp(curClicks, todClicks)),
    sessions: kpiRate(curSessions, prevSessions, cmp(curSessions, todSessions)),
    ctr: ratioKpi(
      ctrOf(curClicks, curImpr),
      ctrOf(prevClicks, prevImpr),
      doneRatio(() => ctrOf(curClicks - todClicks, curImpr - todImpr), curImpr - todImpr)
    ),
    cpcMinorUnits: ratioKpi(
      cpcOf(curSpend, curClicks),
      cpcOf(prevSpend, prevClicks),
      doneRatio(() => cpcOf(curSpend - todSpend, curClicks - todClicks), curClicks - todClicks)
    ),
    conversions: kpiRate(curConv, prevConv, cmp(curConv, todConv)),
  };

  // E-commerce KPIs (revenue from GA4; ROAS/AOV derived). Zero for engagement
  // clients whose GA4 has no purchases.
  const roasOf = (rev: number, spend: number) => (spend > 0 ? rev / spend : 0);
  const aovOf = (rev: number, tx: number) => (tx > 0 ? rev / tx : 0);
  const ecommerce = {
    revenueMinorUnits: kpiRate(curRevenue, prevRevenue, cmp(curRevenue, todRevenue)),
    transactions: kpiRate(
      curTransactions,
      prevTransactions,
      cmp(curTransactions, todTransactions)
    ),
    // ROAS as a ratio ×100 so the Kpi delta math works on a number; UI divides.
    roas: ratioKpi(
      Math.round(roasOf(curRevenue, curSpend) * 100),
      Math.round(roasOf(prevRevenue, prevSpend) * 100),
      doneRatio(
        () => Math.round(roasOf(curRevenue - todRevenue, curSpend - todSpend) * 100),
        curSpend - todSpend
      )
    ),
    aovMinorUnits: ratioKpi(
      Math.round(aovOf(curRevenue, curTransactions)),
      Math.round(aovOf(prevRevenue, prevTransactions)),
      doneRatio(
        () => Math.round(aovOf(curRevenue - todRevenue, curTransactions - todTransactions)),
        curTransactions - todTransactions
      )
    ),
  };

  // --- Per-day trend + per-platform CPC trend ---
  const byDate = new Map<
    string,
    { spend: number; clicks: number; impressions: number; conversions: number }
  >();
  const byDateProvider = new Map<string, { spend: number; clicks: number }>();

  for (const t of ads.range) {
    const agg = byDate.get(t.date) ?? {
      spend: 0,
      clicks: 0,
      impressions: 0,
      conversions: 0,
    };
    agg.spend += t.spend;
    agg.clicks += t.clicks;
    agg.impressions += t.impressions;
    agg.conversions += t.conversions;
    byDate.set(t.date, agg);

    const pKey = `${t.date}:${t.provider}`;
    const pAgg = byDateProvider.get(pKey) ?? { spend: 0, clicks: 0 };
    pAgg.spend += t.spend;
    pAgg.clicks += t.clicks;
    byDateProvider.set(pKey, pAgg);
  }

  const startDate = new Date(`${range.start}T00:00:00`);
  const endDate = new Date(`${range.end}T00:00:00`);
  const totalDays = differenceInCalendarDays(endDate, startDate) + 1;

  const trend: TrendPoint[] = [];
  const costTrend: CostTrendPoint[] = [];
  for (let i = 0; i < totalDays; i++) {
    const dateStr = fmt(addDays(startDate, i));
    const agg = byDate.get(dateStr);
    trend.push({
      date: dateStr,
      spendMinorUnits: agg?.spend ?? 0,
      sessions: sessionsByDate.get(dateStr) ?? 0,
      clicks: agg?.clicks ?? 0,
      impressions: agg?.impressions ?? 0,
      conversions: agg?.conversions ?? 0,
      revenueMinorUnits: revenueByDate.get(dateStr) ?? 0,
      transactions: transactionsByDate.get(dateStr) ?? 0,
    });

    const meta = byDateProvider.get(`${dateStr}:meta_ads`);
    const google = byDateProvider.get(`${dateStr}:google_ads`);
    costTrend.push({
      date: dateStr,
      metaCpcMinorUnits:
        meta && meta.clicks > 0 ? meta.spend / meta.clicks : null,
      googleCpcMinorUnits:
        google && google.clicks > 0 ? google.spend / google.clicks : null,
    });
  }

  // --- Previous-period trend (per-day baseline totals already read) ---
  // Half a baseline drawn as a line is the same lie as half a baseline in a %.
  const prevTrend =
    adsBaseline && ga4Baseline ? buildPrevTrend(ads.prev, ga4Rows, range.prevStart, range.prevEnd) : undefined;

  // --- Platform split ---
  let metaSpend = 0;
  let googleSpend = 0;
  let tiktokSpend = 0;
  for (const t of ads.range) {
    if (t.provider === "meta_ads") metaSpend += t.spend;
    else if (t.provider === "tiktok_ads") tiktokSpend += t.spend;
    else googleSpend += t.spend;
  }

  // --- Campaigns with health status ---
  // "Last 48 hours" only means now when the range reaches yesterday; in a
  // past range (prev month, custom) a campaign that stopped before its end
  // simply ended - flagging it critical with "w ostatnich 48 godzinach" was
  // false for every campaign that finished mid-period.
  const rangeIsCurrent =
    range.end >= fmt(subDays(new Date(`${todayStr}T00:00:00`), 1));
  const clientAvgCtr = ctrOf(curClicks, curImpr);
  const clientAvgCpc = cpcOf(curSpend, curClicks);

  const campaigns: CampaignRow[] = ads.campaigns
    .map((c) => {
      const ctr = ctrOf(c.clicks, c.impressions);
      const cpc = c.clicks > 0 ? c.spend / c.clicks : null;
      const avgFreq = c.freqCount > 0 ? c.freqSum / c.freqCount : 0;
      const isActive = c.recentSpend > 0 || c.recentImpressions > 0;

      let status: CampaignStatus = isActive ? "active" : "off";
      let statusReason: string | null = null;

      if (isActive || c.earlierSpend > 0) {
        if (c.earlierSpend > 0 && c.recentImpressions === 0 && c.recentSpend === 0) {
          // Past range: it just ended within the period - stays "off".
          if (rangeIsCurrent) {
            status = "critical";
            statusReason = "Brak wyświetleń w ostatnich 48 godzinach";
          }
        } else if (cpc != null && clientAvgCpc > 0 && cpc > 3 * clientAvgCpc) {
          status = "critical";
          statusReason = "Koszt kliknięcia ponad 3× wyższy niż średnia konta";
        } else if (avgFreq > FREQ_ATTENTION) {
          status = "attention";
          statusReason = "Ta sama osoba widziała reklamę średnio ponad 4 razy - czas ją odświeżyć";
        } else if (
          clientAvgCtr > 0 &&
          c.impressions > 500 &&
          ctr < 0.5 * clientAvgCtr
        ) {
          status = "attention";
          statusReason = "Klikalność poniżej połowy średniej konta";
        }
      }

      return {
        campaignId: c.campaignId,
        provider: c.provider,
        name: c.name,
        spendMinorUnits: c.spend,
        clicks: c.clicks,
        impressions: c.impressions,
        ctr,
        cpcMinorUnits: cpc,
        conversions: c.conversions,
        status,
        statusReason,
        spark: c.spark,
      };
    })
    .sort((a, b) => b.spendMinorUnits - a.spendMinorUnits);

  return {
    kpis,
    ecommerce,
    trend,
    campaigns,
    costTrend,
    platformSplit: {
      metaSpendMinorUnits: metaSpend,
      googleSpendMinorUnits: googleSpend,
      tiktokSpendMinorUnits: tiktokSpend,
    },
    rangeKey,
    rangeLabel: label,
    rangeStart: range.start,
    rangeEnd: range.end,
    prevTrend,
    comparable: adsBaseline || ga4Baseline,
    autoEvents: ads.autoEvents,
    engagementRate:
      curEngSessions > 0 ? (curEngWeighted / curEngSessions) * 100 : null,
  };
}

/**
 * getDashboardData for the dashboard pages: shared across pages, viewers and
 * refreshes until the next sync lands (lib/dashboard/sync-cache.ts), and
 * deduped within a request. Reads with the service role, so `clientId` MUST
 * come from getClientBySlug (resolved through RLS). Background jobs and
 * share links keep calling getDashboardData directly.
 */
export const loadDashboardData = cache(
  (
    clientId: string,
    rangeKey: RangeKey,
    customStart: string | null = null,
    customEnd: string | null = null
  ): Promise<DashboardData> => {
    const custom =
      customStart && customEnd ? { start: customStart, end: customEnd } : null;
    return syncCached("dashboard", clientId, [rangeKey, customStart, customEnd], () =>
      getDashboardData(clientId, rangeKey, custom, createAdminClient())
    );
  }
);
