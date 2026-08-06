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

import {
  RANGE_LABELS,
  type CustomRange,
  type RangeKey,
} from "@/lib/dashboard/ranges";
import { fetchAll } from "@/lib/supabase/fetch-all";
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

  const days = key === "7d" ? 7 : key === "90d" ? 90 : 30;
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

function ctrOf(clicks: number, impressions: number): number {
  return impressions > 0 ? (clicks / impressions) * 100 : 0;
}

function cpcOf(spend: number, clicks: number): number {
  return clicks > 0 ? spend / clicks : 0;
}

/**
 * Everything the dashboard needs for a date range: period-over-period KPIs
 * (ads + GA4 sessions), per-day trend, campaign list with health status and
 * 7-day sparklines, CPC trends per platform and the Meta/Google spend split.
 */
export async function getDashboardData(
  clientId: string,
  rangeKey: RangeKey = "30d",
  custom?: CustomRange | null
): Promise<DashboardData> {
  const supabase = createClient();

  const todayStr = formatInTimeZone(new Date(), WARSAW_TZ, "yyyy-MM-dd");
  const today = new Date(`${todayStr}T00:00:00`);
  // A custom from/to overrides the preset; its baseline is the same-length
  // period immediately before it (for the vs-previous deltas).
  let range: ResolvedRange;
  let label = RANGE_LABELS[rangeKey];
  if (custom) {
    const start = new Date(`${custom.start}T00:00:00`);
    const end = new Date(`${custom.end}T00:00:00`);
    const len = differenceInCalendarDays(end, start) + 1;
    const prevEnd = subDays(start, 1);
    range = {
      start: custom.start,
      end: custom.end,
      prevStart: fmt(subDays(prevEnd, len - 1)),
      prevEnd: fmt(prevEnd),
    };
    label = `${custom.start} - ${custom.end}`;
  } else {
    range = resolveRange(rangeKey, today);
  }

  // The revenue columns land with migration 0016; probe once so the whole GA4
  // read doesn't error (and drop sessions) before the migration is applied.
  const ga4Probe = await supabase
    .from("ga4_daily")
    .select("revenue_minor_units")
    .limit(1);
  const ga4Select = ga4Probe.error
    ? "date, sessions"
    : "date, sessions, revenue_minor_units, transactions";

  // Paginated reads: a long range on a large account easily exceeds
  // PostgREST's silent ~1000-row cap, which would truncate KPIs and trends.
  const [rows, ga4Rows] = await Promise.all([
    fetchAll<AdsRow>((from, to) =>
      supabase
        .from("ads_daily")
        .select(
          "provider, campaign_id, campaign_name, date, spend_minor_units, clicks, impressions, conversions, frequency"
        )
        .eq("client_id", clientId)
        .gte("date", range.prevStart)
        .lte("date", range.end)
        .order("date", { ascending: true })
        .order("provider", { ascending: true })
        .order("campaign_id", { ascending: true })
        .range(from, to)
    ),
    // GA4 daily totals only (dimension columns null).
    fetchAll<{
      date: string;
      sessions: number | string;
      revenue_minor_units: number | string | null;
      transactions: number | string | null;
    }>((from, to) =>
      supabase
        .from("ga4_daily")
        .select(
          ga4Select as "date, sessions, revenue_minor_units, transactions"
        )
        .eq("client_id", clientId)
        .is("source_medium", null)
        .is("device_category", null)
        .is("page_path", null)
        .gte("date", range.prevStart)
        .lte("date", range.end)
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    ),
  ]);

  const inRange = (d: string) => d >= range.start && d <= range.end;
  const inPrev = (d: string) => d >= range.prevStart && d <= range.prevEnd;

  // --- KPI accumulators ---
  let curSpend = 0, curClicks = 0, curImpr = 0, curConv = 0;
  let prevSpend = 0, prevClicks = 0, prevImpr = 0, prevConv = 0;

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

  const kpis: DashboardKpis = {
    spendMinorUnits: kpi(curSpend, prevSpend),
    clicks: kpi(curClicks, prevClicks),
    sessions: kpi(curSessions, prevSessions),
    ctr: kpi(ctrOf(curClicks, curImpr), ctrOf(prevClicks, prevImpr)),
    cpcMinorUnits: kpi(cpcOf(curSpend, curClicks), cpcOf(prevSpend, prevClicks)),
    conversions: kpi(curConv, prevConv),
  };

  // E-commerce KPIs (revenue from GA4; ROAS/AOV derived). Zero for engagement
  // clients whose GA4 has no purchases.
  const roasOf = (rev: number, spend: number) => (spend > 0 ? rev / spend : 0);
  const aovOf = (rev: number, tx: number) => (tx > 0 ? rev / tx : 0);
  const ecommerce = {
    revenueMinorUnits: kpi(curRevenue, prevRevenue),
    transactions: kpi(curTransactions, prevTransactions),
    // ROAS as a ratio ×100 so the Kpi delta math works on a number; UI divides.
    roas: kpi(
      Math.round(roasOf(curRevenue, curSpend) * 100),
      Math.round(roasOf(prevRevenue, prevSpend) * 100)
    ),
    aovMinorUnits: kpi(
      Math.round(aovOf(curRevenue, curTransactions)),
      Math.round(aovOf(prevRevenue, prevTransactions))
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
          status = "critical";
          statusReason = "Brak wyświetleń w ostatnich 48h";
        } else if (cpc != null && clientAvgCpc > 0 && cpc > 3 * clientAvgCpc) {
          status = "critical";
          statusReason = "CPC ponad 3× wyższy niż średnia konta";
        } else if (avgFreq > 4) {
          status = "attention";
          statusReason = "Częstotliwość > 4 - czas na nowe kreacje";
        } else if (
          clientAvgCtr > 0 &&
          c.impressions > 500 &&
          ctr < 0.5 * clientAvgCtr
        ) {
          status = "attention";
          statusReason = "CTR poniżej 50% średniej konta";
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
  };
}
