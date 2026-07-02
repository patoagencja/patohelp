import {
  endOfMonth,
  format,
  startOfMonth,
  subDays,
  subMonths,
} from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

import { createClient } from "@/lib/supabase/server";

const WARSAW_TZ = "Europe/Warsaw";
const TREND_DAYS = 30;

export interface Kpi {
  value: number;
  previous: number;
  /** Relative change vs previous period, in percent (null if no baseline). */
  deltaPercent: number | null;
}

export interface DashboardKpis {
  spendMinorUnits: Kpi;
  clicks: Kpi;
  sessions: Kpi; // GA4 — zero until the GA4 integration lands
  ctr: Kpi; // percent
}

export interface TrendPoint {
  date: string; // yyyy-MM-dd
  spendMinorUnits: number;
  sessions: number; // GA4 — zero until integrated
}

export type CampaignStatus = "active" | "paused" | "off";

export interface CampaignRow {
  campaignId: string;
  provider: "meta_ads" | "google_ads";
  name: string;
  spendMinorUnits: number;
  clicks: number;
  impressions: number;
  ctr: number; // percent
  status: CampaignStatus;
}

export interface DashboardData {
  kpis: DashboardKpis;
  trend: TrendPoint[];
  campaigns: CampaignRow[];
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
 * Everything the client dashboard needs from ad data, in one round-trip:
 * month-over-month KPIs, a 30-day spend trend and the active campaign list.
 * GA4-derived figures (sessions) are stubbed at 0 until that integration ships.
 */
export async function getDashboardData(clientId: string): Promise<DashboardData> {
  const supabase = createClient();

  const now = new Date();
  const todayStr = formatInTimeZone(now, WARSAW_TZ, "yyyy-MM-dd");
  const today = new Date(`${todayStr}T00:00:00`);

  const curMonthStart = format(startOfMonth(today), "yyyy-MM-dd");
  const prevMonthStart = format(startOfMonth(subMonths(today, 1)), "yyyy-MM-dd");
  const prevMonthEnd = format(endOfMonth(subMonths(today, 1)), "yyyy-MM-dd");
  const trendStart = format(subDays(today, TREND_DAYS - 1), "yyyy-MM-dd");
  const earliest = prevMonthStart < trendStart ? prevMonthStart : trendStart;

  const { data } = await supabase
    .from("ads_daily")
    .select(
      "provider, campaign_id, campaign_name, date, spend_minor_units, clicks, impressions"
    )
    .eq("client_id", clientId)
    .gte("date", earliest);

  const rows = (data ?? []) as AdsRow[];

  // --- KPIs (current vs previous calendar month) ---
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

    if (row.date >= curMonthStart && row.date <= todayStr) {
      curSpend += spend;
      curClicks += clicks;
      curImpr += impressions;
    } else if (row.date >= prevMonthStart && row.date <= prevMonthEnd) {
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

  // --- 30-day spend trend (zero-filled) ---
  const spendByDate = new Map<string, number>();
  for (const row of rows) {
    if (row.date >= trendStart && row.date <= todayStr) {
      spendByDate.set(
        row.date,
        (spendByDate.get(row.date) ?? 0) + Number(row.spend_minor_units)
      );
    }
  }
  const trend: TrendPoint[] = [];
  for (let i = TREND_DAYS - 1; i >= 0; i--) {
    const dateStr = format(subDays(today, i), "yyyy-MM-dd");
    trend.push({
      date: dateStr,
      spendMinorUnits: spendByDate.get(dateStr) ?? 0,
      sessions: 0,
    });
  }

  // --- Active campaigns (current month, aggregated) ---
  const recentThreshold = format(subDays(today, 2), "yyyy-MM-dd"); // last 3 days
  const campaignMap = new Map<
    string,
    CampaignRow & { recentSpend: number }
  >();

  for (const row of rows) {
    if (row.date < curMonthStart || row.date > todayStr) continue;

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

  return { kpis, trend, campaigns };
}
