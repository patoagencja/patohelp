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
  detectCampaignEvents,
  type ChartEvent,
} from "@/lib/dashboard/chart-events";
import {
  RANGE_LABELS,
  type CustomRange,
  type RangeKey,
} from "@/lib/dashboard/ranges";
import { syncCached } from "@/lib/dashboard/sync-cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll, fetchAllByDateChunks } from "@/lib/supabase/fetch-all";
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
  rows: AdsRow[],
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
    p.spendMinorUnits += Number(r.spend_minor_units);
    p.clicks += Number(r.clicks);
    p.impressions += Number(r.impressions);
    p.conversions += Number(r.conversions ?? 0);
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

  // Paginated reads: a long range on a large account easily exceeds
  // PostgREST's silent ~1000-row cap, which would truncate KPIs and trends.
  // Read in two-week chunks side by side (same rows, same order as one read):
  // 90 days + baseline of an OLX-size account is ~70 000 rows, and one long
  // OFFSET-paged read re-walked every earlier page for each new one.
  const [rows, ga4Rows] = await Promise.all([
    fetchAllByDateChunks<AdsRow>(adsFrom, range.end, 14, (chunkStart, chunkEnd) =>
      (from, to) =>
        supabase
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

  for (const row of rows) {
    const spend = Number(row.spend_minor_units);
    const clicks = Number(row.clicks);
    const impressions = Number(row.impressions);
    const conversions = Number(row.conversions ?? 0);

    if (inRange(row.date)) {
      curSpend += spend;
      curClicks += clicks;
      curImpr += impressions;
      curConv += conversions;
      if (row.date === todayStr) {
        todSpend += spend;
        todClicks += clicks;
        todImpr += impressions;
        todConv += conversions;
      }
    } else if (inPrev(row.date)) {
      prevSpend += spend;
      prevClicks += clicks;
      prevImpr += impressions;
      prevConv += conversions;
    }
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

  for (const row of rows) {
    if (!inRange(row.date)) continue;
    const agg = byDate.get(row.date) ?? {
      spend: 0,
      clicks: 0,
      impressions: 0,
      conversions: 0,
    };
    agg.spend += Number(row.spend_minor_units);
    agg.clicks += Number(row.clicks);
    agg.impressions += Number(row.impressions);
    agg.conversions += Number(row.conversions ?? 0);
    byDate.set(row.date, agg);

    const pKey = `${row.date}:${row.provider}`;
    const pAgg = byDateProvider.get(pKey) ?? { spend: 0, clicks: 0 };
    pAgg.spend += Number(row.spend_minor_units);
    pAgg.clicks += Number(row.clicks);
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

  // --- Previous-period trend + chart annotations (from rows already read) ---
  // Half a baseline drawn as a line is the same lie as half a baseline in a %.
  const prevTrend =
    adsBaseline && ga4Baseline ? buildPrevTrend(rows, ga4Rows, range.prevStart, range.prevEnd) : undefined;
  const autoEvents = detectCampaignEvents({
    rows: rows.map((r) => ({
      provider: r.provider,
      campaignId: r.campaign_id,
      campaignName: r.campaign_name,
      date: r.date,
      spendMinorUnits: Number(r.spend_minor_units),
    })),
    dataStart: range.prevStart,
    rangeStart: range.start,
    rangeEnd: range.end,
    today: todayStr,
  });

  // --- Platform split ---
  let metaSpend = 0;
  let googleSpend = 0;
  let tiktokSpend = 0;
  for (const row of rows) {
    if (!inRange(row.date)) continue;
    const spend = Number(row.spend_minor_units);
    if (row.provider === "meta_ads") metaSpend += spend;
    else if (row.provider === "tiktok_ads") tiktokSpend += spend;
    else googleSpend += spend;
  }

  // --- Campaigns with health status ---
  const sparkStart = fmt(subDays(endDate, 6));
  const recentStart = fmt(subDays(endDate, 1)); // last 2 days
  // "Last 48 hours" only means now when the range reaches yesterday; in a
  // past range (prev month, custom) a campaign that stopped before its end
  // simply ended - flagging it critical with "w ostatnich 48 godzinach" was
  // false for every campaign that finished mid-period.
  const rangeIsCurrent =
    range.end >= fmt(subDays(new Date(`${todayStr}T00:00:00`), 1));
  const clientAvgCtr = ctrOf(curClicks, curImpr);
  const clientAvgCpc = cpcOf(curSpend, curClicks);

  interface CampAgg {
    campaignId: string;
    provider: AdProvider;
    name: string;
    spend: number;
    clicks: number;
    impressions: number;
    conversions: number;
    recentSpend: number;
    recentImpressions: number;
    earlierSpend: number;
    freqSum: number;
    freqCount: number;
    sparkByDate: Map<string, number>;
  }
  const campaignMap = new Map<string, CampAgg>();

  for (const row of rows) {
    if (!inRange(row.date)) continue;
    const key = `${row.provider}:${row.campaign_id}`;
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
      agg.sparkByDate.set(
        row.date,
        (agg.sparkByDate.get(row.date) ?? 0) + spend
      );
    }
    campaignMap.set(key, agg);
  }

  const campaigns: CampaignRow[] = Array.from(campaignMap.values())
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
        } else if (avgFreq > 4) {
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

      // Zero-filled 7-day spend sparkline.
      const spark: number[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = fmt(subDays(endDate, i));
        spark.push(c.sparkByDate.get(d) ?? 0);
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
        spark,
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
    autoEvents,
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
