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

import { RANGE_LABELS, type RangeKey } from "@/lib/dashboard/ranges";
import { createClient } from "@/lib/supabase/server";

export { RANGE_KEYS, RANGE_LABELS, normalizeRange } from "@/lib/dashboard/ranges";
export type { RangeKey } from "@/lib/dashboard/ranges";

const WARSAW_TZ = "Europe/Warsaw";

interface ResolvedRange {
  start: string;
  end: string;
  prevStart: string;
  prevEnd: string;
}

const fmt = (d: Date) => format(d, "yyyy-MM-dd");

// A selected period plus the immediately-preceding period of equal length
// (calendar month presets compare against the prior calendar month).
function resolveRange(key: RangeKey, today: Date): ResolvedRange {
  if (key === "month") {
    return {
      start: fmt(startOfMonth(today)),
      end: fmt(today),
      prevStart: fmt(startOfMonth(subMonths(today, 1))),
      prevEnd: fmt(endOfMonth(subMonths(today, 1))),
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
  return { start: fmt(start), end: fmt(today), prevStart: fmt(prevStart), prevEnd: fmt(prevEnd) };
}

export interface Kpi {
  value: number;
  previous: number;
  deltaPercent: number | null;
}

export interface DashboardKpis {
  spendMinorUnits: Kpi;
  clicks: Kpi;
  sessions: Kpi; // GA4 — zero until the GA4 integration lands
  ctr: Kpi; // percent
}

export interface TrendPoint {
  date: string;
  spendMinorUnits: number;
  sessions: number;
}

export type CampaignStatus = "active" | "paused" | "off";

export interface CampaignRow {
  campaignId: string;
  provider: "meta_ads" | "google_ads";
  name: string;
  spendMinorUnits: number;
  clicks: number;
  impressions: number;
  ctr: number;
  status: CampaignStatus;
}

export interface DashboardData {
  kpis: DashboardKpis;
  trend: TrendPoint[];
  campaigns: CampaignRow[];
  rangeKey: RangeKey;
  rangeLabel: string;
}

interface AdsRow {
  provider: "meta_ads" | "google_ads";
  campaign_id: string;
  campaign_name: string | null;
  date: string;
  spend_minor_units: number | string;
  clicks: number | string;
  impressions: number | string;
}

function kpi(value: number, previous: number): Kpi {
  const deltaPercent =
    previous > 0 ? ((value - previous) / previous) * 100 : null;
  return { value, previous, deltaPercent };
}

function ctrOf(clicks: number, impressions: number): number {
  return impressions > 0 ? (clicks / impressions) * 100 : 0;
}

/**
 * Everything the client dashboard needs from ad data for a given date range:
 * period-over-period KPIs, a per-day spend trend and the campaign list.
 * GA4-derived figures (sessions) are stubbed at 0 until that integration ships.
 */
export async function getDashboardData(
  clientId: string,
  rangeKey: RangeKey = "30d"
): Promise<DashboardData> {
  const supabase = createClient();

  const todayStr = formatInTimeZone(new Date(), WARSAW_TZ, "yyyy-MM-dd");
  const today = new Date(`${todayStr}T00:00:00`);
  const range = resolveRange(rangeKey, today);

  const { data } = await supabase
    .from("ads_daily")
    .select(
      "provider, campaign_id, campaign_name, date, spend_minor_units, clicks, impressions"
    )
    .eq("client_id", clientId)
    .gte("date", range.prevStart)
    .lte("date", range.end);

  const rows = (data ?? []) as AdsRow[];

  // --- KPIs (current period vs previous period) ---
  let curSpend = 0;
  let curClicks = 0;
  let curImpr = 0;
  let prevSpend = 0;
  let prevClicks = 0;
  let prevImpr = 0;

  for (const row of rows) {
    const spend = Number(row.spend_minor_units);
    const clicks = Number(row.clicks);
    const impressions = Number(row.impressions);

    if (row.date >= range.start && row.date <= range.end) {
      curSpend += spend;
      curClicks += clicks;
      curImpr += impressions;
    } else if (row.date >= range.prevStart && row.date <= range.prevEnd) {
      prevSpend += spend;
      prevClicks += clicks;
      prevImpr += impressions;
    }
  }

  const kpis: DashboardKpis = {
    spendMinorUnits: kpi(curSpend, prevSpend),
    clicks: kpi(curClicks, prevClicks),
    sessions: kpi(0, 0),
    ctr: kpi(ctrOf(curClicks, curImpr), ctrOf(prevClicks, prevImpr)),
  };

  // --- Per-day spend trend across the selected range (zero-filled) ---
  const spendByDate = new Map<string, number>();
  for (const row of rows) {
    if (row.date >= range.start && row.date <= range.end) {
      spendByDate.set(
        row.date,
        (spendByDate.get(row.date) ?? 0) + Number(row.spend_minor_units)
      );
    }
  }
  const startDate = new Date(`${range.start}T00:00:00`);
  const endDate = new Date(`${range.end}T00:00:00`);
  const totalDays = differenceInCalendarDays(endDate, startDate) + 1;
  const trend: TrendPoint[] = [];
  for (let i = 0; i < totalDays; i++) {
    const dateStr = fmt(addDays(startDate, i));
    trend.push({
      date: dateStr,
      spendMinorUnits: spendByDate.get(dateStr) ?? 0,
      sessions: 0,
    });
  }

  // --- Campaigns aggregated over the selected range ---
  const recentDate = subDays(endDate, 2);
  const recentThreshold = fmt(recentDate < startDate ? startDate : recentDate);
  const campaignMap = new Map<
    string,
    CampaignRow & { recentSpend: number }
  >();

  for (const row of rows) {
    if (row.date < range.start || row.date > range.end) continue;

    const key = `${row.provider}:${row.campaign_id}`;
    const existing =
      campaignMap.get(key) ??
      ({
        campaignId: row.campaign_id,
        provider: row.provider,
        name: row.campaign_name || row.campaign_id,
        spendMinorUnits: 0,
        clicks: 0,
        impressions: 0,
        ctr: 0,
        status: "off" as CampaignStatus,
        recentSpend: 0,
      } as CampaignRow & { recentSpend: number });

    const spend = Number(row.spend_minor_units);
    existing.spendMinorUnits += spend;
    existing.clicks += Number(row.clicks);
    existing.impressions += Number(row.impressions);
    if (row.date >= recentThreshold) existing.recentSpend += spend;

    campaignMap.set(key, existing);
  }

  const campaigns: CampaignRow[] = Array.from(campaignMap.values())
    .map(({ recentSpend, ...c }) => ({
      ...c,
      ctr: ctrOf(c.clicks, c.impressions),
      status:
        recentSpend > 0
          ? ("active" as CampaignStatus)
          : c.spendMinorUnits > 0
            ? ("paused" as CampaignStatus)
            : ("off" as CampaignStatus),
    }))
    .sort((a, b) => b.spendMinorUnits - a.spendMinorUnits);

  return {
    kpis,
    trend,
    campaigns,
    rangeKey,
    rangeLabel: RANGE_LABELS[rangeKey],
  };
}
