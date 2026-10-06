import { cache } from "react";
import { differenceInCalendarDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";

const WARSAW_TZ = "Europe/Warsaw";

export type FlightMetric = "clicks" | "impressions" | "spend" | "conversions";
export type PacingStatus =
  | "behind" // nie dowozi
  | "on_track"
  | "ahead"
  | "upcoming"
  | "ended";

export interface PacingFlight {
  id: string;
  campaignId: string;
  campaignName: string;
  /** Ad set (Meta) / ad group (Google) goal; null = the whole campaign. */
  adsetId: string | null;
  adsetName: string | null;
  /** 'meta_ads' | 'google_ads' when known (older goals have none). */
  provider: string | null;
  metric: FlightMetric;
  target: number; // spend in grosze; others raw
  realized: number;
  startDate: string;
  endDate: string;
  status: PacingStatus;
  realizedPct: number; // realized / target
  expectedPct: number; // elapsed / total (linear plan)
  paceRatio: number | null; // realized / expected value
  daysLeft: number;
  /** Calendar days in the flight window (inclusive). */
  totalDays: number;
  /** Days of the window up to and including today (0 before the start). */
  elapsedDays: number;
  /** Delivered value per day from the start, one entry per elapsed day. */
  daily: number[];
}

/** A configured goal (one campaign_flights row) before any data is joined. */
export interface FlightDef {
  id: string;
  campaignId: string;
  campaignName: string;
  adsetId: string | null;
  adsetName: string | null;
  provider: string | null;
  metric: FlightMetric;
  target: number;
  startDate: string;
  endDate: string;
}

const METRIC_COLUMN: Record<FlightMetric, string> = {
  clicks: "clicks",
  impressions: "impressions",
  spend: "spend_minor_units",
  conversions: "conversions",
};

const dayOf = (iso: string) => new Date(`${iso}T00:00:00`);

/**
 * Pure pacing maths for one goal: realized vs the linear plan over the flight
 * window. `behind` (< 90% of expected) is the "nie dowozi" signal. `byDate`
 * holds the delivered value per yyyy-MM-dd (missing days = 0). Shared by the
 * live read below and the demo.
 */
export function computePacing(
  def: FlightDef,
  byDate: Map<string, number>,
  todayStr: string
): PacingFlight {
  const { startDate: start, endDate: end, target } = def;
  const today = dayOf(todayStr);
  const startD = dayOf(start);
  const endD = dayOf(end);
  const totalDays = Math.max(differenceInCalendarDays(endD, startD) + 1, 1);
  const elapsed = Math.min(
    Math.max(differenceInCalendarDays(today, startD) + 1, 0),
    totalDays
  );

  const daily: number[] = [];
  for (let i = 0; i < elapsed; i++) {
    const d = new Date(startD.getFullYear(), startD.getMonth(), startD.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    daily.push(byDate.get(key) ?? 0);
  }
  const realized = daily.reduce((s, v) => s + v, 0);

  const expectedPct = elapsed / totalDays;
  const realizedPct = target > 0 ? realized / target : 0;
  const expectedValue = target * expectedPct;
  const paceRatio = expectedValue > 0 ? realized / expectedValue : null;
  const daysLeft = differenceInCalendarDays(endD, today);

  let status: PacingStatus;
  if (todayStr < start) status = "upcoming";
  else if (todayStr > end) status = "ended";
  else if (paceRatio !== null && paceRatio < 0.9) status = "behind";
  else if (paceRatio !== null && paceRatio > 1.1) status = "ahead";
  else status = "on_track";

  return {
    ...def,
    realized,
    status,
    realizedPct,
    expectedPct,
    paceRatio,
    daysLeft,
    totalDays,
    elapsedDays: elapsed,
    daily,
  };
}

type Row = Record<string, unknown>;

/** Sum `col` per date for the rows `match` accepts. */
function sumByDate(rows: Row[], col: string, match: (r: Row) => boolean): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!match(r)) continue;
    const d = r.date as string;
    out.set(d, (out.get(d) ?? 0) + Number(r[col] ?? 0));
  }
  return out;
}

/**
 * Pacing for each configured goal (campaign_flights). Campaign goals read
 * ads_daily; ad set / ad group goals read ads_adset_daily. Admin client -
 * the caller has already resolved an authorized client id. React `cache`
 * dedupes it within one request (Alerty page, overview plan + goal tiles).
 */
export const getPacing = cache(async (clientId: string): Promise<PacingFlight[]> => {
  const admin = createAdminClient();
  // "*": the adset columns arrive with migration 0033; naming them would
  // fail the whole read on a database that hasn't run it yet.
  const { data: flights } = await admin
    .from("campaign_flights")
    .select("*")
    .eq("client_id", clientId)
    .order("end_date", { ascending: true });

  if (!flights || flights.length === 0) return [];

  const todayStr = formatInTimeZone(new Date(), WARSAW_TZ, "yyyy-MM-dd");

  const defs: FlightDef[] = (flights as Row[]).map((f) => ({
    id: f.id as string,
    campaignId: f.campaign_id as string,
    campaignName: (f.campaign_name as string) || (f.campaign_id as string),
    adsetId: (f.adset_id as string | null | undefined) || null,
    adsetName: (f.adset_name as string | null | undefined) || null,
    provider: (f.provider as string | null | undefined) || null,
    metric: f.target_metric as FlightMetric,
    target: Number(f.target_value),
    startDate: f.start_date as string,
    endDate: f.end_date as string,
  }));

  const campaignDefs = defs.filter((d) => !d.adsetId);
  const adsetDefs = defs.filter((d) => d.adsetId);
  const earliest = (list: FlightDef[]) =>
    list.reduce((min, f) => (f.startDate < min ? f.startDate : min), list[0].startDate);

  // Only the goals' campaigns, paginated: every campaign since the earliest
  // flight start passes PostgREST's silent 1000-row cap within weeks, which
  // undercounted "realized" and painted on-track rings as "behind".
  const adsPromise =
    campaignDefs.length > 0
      ? fetchAll<Row>((from, to) =>
          admin
            .from("ads_daily")
            .select("provider, campaign_id, date, spend_minor_units, clicks, impressions, conversions")
            .eq("client_id", clientId)
            .in("campaign_id", Array.from(new Set(campaignDefs.map((f) => f.campaignId))))
            .gte("date", earliest(campaignDefs))
            .lte("date", todayStr)
            .order("date", { ascending: true })
            .order("provider", { ascending: true })
            .order("campaign_id", { ascending: true })
            .range(from, to)
        )
      : Promise.resolve([] as Row[]);
  // A missing table (migration not run) or a failed read leaves ad set goals
  // at zero rather than failing every goal.
  const adsetPromise =
    adsetDefs.length > 0
      ? fetchAll<Row>((from, to) =>
          admin
            .from("ads_adset_daily")
            .select("provider, adset_id, date, spend_minor_units, clicks, impressions, conversions")
            .eq("client_id", clientId)
            .in("adset_id", Array.from(new Set(adsetDefs.map((f) => f.adsetId as string))))
            .gte("date", earliest(adsetDefs))
            .lte("date", todayStr)
            .order("date", { ascending: true })
            .order("provider", { ascending: true })
            .order("adset_id", { ascending: true })
            .range(from, to)
        ).catch((err) => {
          console.error("[pacing] ads_adset_daily read failed", (err as Error).message);
          return [] as Row[];
        })
      : Promise.resolve([] as Row[]);

  const [ads, adsets] = await Promise.all([adsPromise, adsetPromise]);

  return defs.map((def) => {
    const col = METRIC_COLUMN[def.metric];
    const inWindow = (r: Row) =>
      (r.date as string) >= def.startDate && (r.date as string) <= def.endDate;
    const byDate = def.adsetId
      ? sumByDate(
          adsets,
          col,
          (r) =>
            r.adset_id === def.adsetId &&
            (!def.provider || r.provider === def.provider) &&
            inWindow(r)
        )
      : sumByDate(ads, col, (r) => r.campaign_id === def.campaignId && inWindow(r));
    return computePacing(def, byDate, todayStr);
  });
});
