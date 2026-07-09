import { differenceInCalendarDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

import { createAdminClient } from "@/lib/supabase/admin";

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
}

const METRIC_COLUMN: Record<FlightMetric, string> = {
  clicks: "clicks",
  impressions: "impressions",
  spend: "spend_minor_units",
  conversions: "conversions",
};

/**
 * Pacing for each configured campaign flight: realized vs the linear plan over
 * the flight window. `behind` (< 90% of expected) is the "nie dowozi" signal.
 * Admin client — caller has already resolved an authorized client id.
 */
export async function getPacing(clientId: string): Promise<PacingFlight[]> {
  const admin = createAdminClient();
  const { data: flights } = await admin
    .from("campaign_flights")
    .select("id, campaign_id, campaign_name, target_metric, target_value, start_date, end_date")
    .eq("client_id", clientId)
    .order("end_date", { ascending: true });

  if (!flights || flights.length === 0) return [];

  const todayStr = formatInTimeZone(new Date(), WARSAW_TZ, "yyyy-MM-dd");
  const today = new Date(`${todayStr}T00:00:00`);

  // Pull ads_daily once across the widest window the flights need.
  const earliestStart = flights.reduce(
    (min, f) => ((f.start_date as string) < min ? (f.start_date as string) : min),
    flights[0].start_date as string
  );
  const { data: rows } = await admin
    .from("ads_daily")
    .select("campaign_id, date, spend_minor_units, clicks, impressions, conversions")
    .eq("client_id", clientId)
    .gte("date", earliestStart)
    .lte("date", todayStr);

  const ads = rows ?? [];

  return flights.map((f) => {
    const metric = f.target_metric as FlightMetric;
    const col = METRIC_COLUMN[metric];
    const start = f.start_date as string;
    const end = f.end_date as string;

    const realized = ads
      .filter(
        (r) =>
          r.campaign_id === f.campaign_id &&
          (r.date as string) >= start &&
          (r.date as string) <= end
      )
      .reduce((sum, r) => sum + Number((r as Record<string, unknown>)[col] ?? 0), 0);

    const target = Number(f.target_value);
    const startD = new Date(`${start}T00:00:00`);
    const endD = new Date(`${end}T00:00:00`);
    const totalDays = differenceInCalendarDays(endD, startD) + 1;
    const elapsed = Math.min(
      Math.max(differenceInCalendarDays(today, startD) + 1, 0),
      totalDays
    );
    const expectedPct = totalDays > 0 ? elapsed / totalDays : 0;
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
      id: f.id as string,
      campaignId: f.campaign_id as string,
      campaignName: (f.campaign_name as string) || (f.campaign_id as string),
      metric,
      target,
      realized,
      startDate: start,
      endDate: end,
      status,
      realizedPct,
      expectedPct,
      paceRatio,
      daysLeft,
    };
  });
}
