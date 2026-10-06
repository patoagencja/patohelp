import type { SupabaseClient } from "@supabase/supabase-js";
import { formatInTimeZone } from "date-fns-tz";

import type { TrendPoint } from "@/lib/dashboard/metrics";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";

// Year-over-year for every client (engagement metrics: spend, clicks,
// impressions, sessions). Same 52-week shift as the shop YoY in
// lib/ecom/insights.ts getYearOverYear: weekday alignment matters more than
// the calendar date (a Saturday vs a Monday swings traffic far more than the
// one-day drift). Reads only what the hourly sync already stored.

/** 52 weeks - keeps weekdays aligned. Must match lib/ecom/insights.ts. */
export const YOY_SHIFT_DAYS = 364;
/**
 * A sparse last year (integration connected mid-window, a sync gap) would
 * produce a confident but wrong "+300%". Below this share of days with data
 * the metric is reported as unavailable instead.
 */
const MIN_COVERAGE = 0.8;
const DAY_MS = 86_400_000;

export interface YoYPoint {
  /** Last year's date (this period's day i minus 364 days). */
  date: string;
  /** Null = nothing synced that day (not a real zero). */
  spendMinorUnits: number | null;
  clicks: number | null;
  impressions: number | null;
  conversions: number | null;
  sessions: number | null;
}

export interface EngagementYoY {
  lyStart: string;
  lyEnd: string;
  /** Share of last year's days with ads / GA4 rows (0-1), judged separately. */
  adsCoverage: number;
  ga4Coverage: number;
  /** Totals for last year's window; null when coverage is below 80%. */
  spendMinorUnits: number | null;
  clicks: number | null;
  impressions: number | null;
  conversions: number | null;
  sessions: number | null;
  /** Aligned to the current period by day index. */
  series: YoYPoint[];
  /**
   * The current window ends today (a partial day), so "this year vs last"
   * percentages should compare per-day rates over finished days (story.ts).
   */
  endsToday?: boolean;
}

const toTime = (s: string) => new Date(`${s}T00:00:00Z`).getTime();
const addDays = (s: string, n: number) =>
  new Date(toTime(s) + n * DAY_MS).toISOString().slice(0, 10);

interface AdsDay {
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
}

/**
 * Pure aggregation (also used by the demo): applies the coverage rule per
 * source and builds the index-aligned series. A date missing from a map means
 * "no data that day".
 */
export function buildEngagementYoY(
  start: string,
  end: string,
  ads: Map<string, AdsDay>,
  ga4: Map<string, number>
): EngagementYoY {
  const lyStart = addDays(start, -YOY_SHIFT_DAYS);
  const lyEnd = addDays(end, -YOY_SHIFT_DAYS);
  const days = Math.max(1, Math.round((toTime(end) - toTime(start)) / DAY_MS) + 1);

  const series: YoYPoint[] = [];
  const tot = { spend: 0, clicks: 0, impressions: 0, conversions: 0, sessions: 0 };
  let adsDays = 0;
  let ga4Days = 0;
  for (let i = 0; i < days; i++) {
    const date = addDays(lyStart, i);
    const a = ads.get(date);
    const s = ga4.get(date);
    if (a) {
      adsDays += 1;
      tot.spend += a.spend;
      tot.clicks += a.clicks;
      tot.impressions += a.impressions;
      tot.conversions += a.conversions;
    }
    if (s !== undefined) {
      ga4Days += 1;
      tot.sessions += s;
    }
    series.push({
      date,
      spendMinorUnits: a ? a.spend : null,
      clicks: a ? a.clicks : null,
      impressions: a ? a.impressions : null,
      conversions: a ? a.conversions : null,
      sessions: s ?? null,
    });
  }
  const adsCoverage = adsDays / days;
  const ga4Coverage = ga4Days / days;
  const adsOk = adsCoverage >= MIN_COVERAGE;
  const ga4Ok = ga4Coverage >= MIN_COVERAGE;
  return {
    lyStart,
    lyEnd,
    adsCoverage,
    ga4Coverage,
    spendMinorUnits: adsOk ? tot.spend : null,
    clicks: adsOk ? tot.clicks : null,
    impressions: adsOk ? tot.impressions : null,
    conversions: adsOk ? tot.conversions : null,
    sessions: ga4Ok ? tot.sessions : null,
    series,
  };
}

/**
 * Last year's totals for the same window shifted by 364 days. `db` defaults
 * to the cookie-bound RLS client; the public board passes the service-role
 * client (already pinned to the link's client). Null on any read error - YoY
 * is a nice-to-have and must never break the overview.
 */
export async function getEngagementYoY(
  clientId: string,
  start: string,
  end: string,
  db?: SupabaseClient
): Promise<EngagementYoY | null> {
  try {
    const supabase: SupabaseClient = db ?? createClient();
    const lyStart = addDays(start, -YOY_SHIFT_DAYS);
    const lyEnd = addDays(end, -YOY_SHIFT_DAYS);
    // Paged: a year-old window on a large account still exceeds PostgREST's
    // silent 1000-row cap. `id` as the tie-break keeps page boundaries stable.
    const [adsRows, ga4Rows] = await Promise.all([
      fetchAll<Record<string, unknown>>((from, to) =>
        supabase
          .from("ads_daily")
          .select("date, spend_minor_units, clicks, impressions, conversions")
          .eq("client_id", clientId)
          .gte("date", lyStart)
          .lte("date", lyEnd)
          .order("date", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
      ),
      fetchAll<Record<string, unknown>>((from, to) =>
        supabase
          .from("ga4_daily")
          .select("date, sessions")
          .eq("client_id", clientId)
          .is("source_medium", null)
          .is("device_category", null)
          .is("page_path", null)
          .gte("date", lyStart)
          .lte("date", lyEnd)
          .order("date", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
      ),
    ]);

    const ads = new Map<string, AdsDay>();
    for (const r of adsRows) {
      const date = String(r.date).slice(0, 10);
      const cur = ads.get(date) ?? { spend: 0, clicks: 0, impressions: 0, conversions: 0 };
      cur.spend += Number(r.spend_minor_units ?? 0);
      cur.clicks += Number(r.clicks ?? 0);
      cur.impressions += Number(r.impressions ?? 0);
      cur.conversions += Number(r.conversions ?? 0);
      ads.set(date, cur);
    }
    const ga4 = new Map<string, number>();
    for (const r of ga4Rows) {
      const date = String(r.date).slice(0, 10);
      ga4.set(date, (ga4.get(date) ?? 0) + Number(r.sessions ?? 0));
    }
    const today = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");
    return { ...buildEngagementYoY(start, end, ads, ga4), endsToday: end === today };
  } catch {
    return null;
  }
}

/**
 * Demo pages only: a plausible last year from the demo trend (about 18% lower,
 * with deterministic noise so it isn't a scaled copy of this year).
 */
export function demoEngagementYoY(trend: TrendPoint[]): EngagementYoY | null {
  const start = trend[0]?.date;
  const end = trend[trend.length - 1]?.date;
  if (!start || !end) return null;
  const ads = new Map<string, AdsDay>();
  const ga4 = new Map<string, number>();
  trend.forEach((p, i) => {
    const noise = 0.82 * (1 + 0.07 * Math.sin(i * 2.3) + 0.04 * Math.cos(i * 0.9));
    const date = addDays(p.date, -YOY_SHIFT_DAYS);
    ads.set(date, {
      spend: Math.round(p.spendMinorUnits * noise * 0.95),
      clicks: Math.round(p.clicks * noise),
      impressions: Math.round(p.impressions * noise * 1.05),
      conversions: Math.round(p.conversions * noise),
    });
    ga4.set(date, Math.round(p.sessions * noise));
  });
  return buildEngagementYoY(start, end, ads, ga4);
}
