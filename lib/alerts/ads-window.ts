import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchAllByDateChunks, type FetchLane } from "@/lib/supabase/fetch-all";

// The budget-spike detector reads the last 22 days of every campaign, the
// anomaly detector the 17 days before today - side by side, so an OLX-size
// account fetched ~30 000 rows of which ~13 000 twice. Callers that run both
// (getCurrentAlerts, the agency client picker) read the wider window once
// and hand it to each; a detector without it reads its own window as before.

const WARSAW_TZ = "Europe/Warsaw";
const fmtDate = (d: Date) => formatInTimeZone(d, WARSAW_TZ, "yyyy-MM-dd");

/** The budget detector's history, the widest window either detector reads. */
const WINDOW_DAYS = 22;

/** One ads_daily row with every column either detector uses. */
export type AlertAdsRow = {
  date: string;
  campaign_id: string;
  campaign_name: string | null;
  spend_minor_units: number | string;
  clicks: number | string;
  impressions: number | string;
};

/** ads_daily rows of [start, end], ordered (date, provider, campaign_id). */
export interface AlertAdsWindow {
  start: string;
  end: string;
  rows: AlertAdsRow[];
}

/**
 * Today's alert window for one client (Warsaw "today", computed the way the
 * detectors compute theirs). `lane: "background"` for scans that stream in
 * after the page (see FetchOptions).
 */
export async function readAlertAdsWindow(
  db: SupabaseClient,
  clientId: string,
  lane: FetchLane = "foreground"
): Promise<AlertAdsWindow> {
  const end = fmtDate(new Date());
  const start = fmtDate(subDays(new Date(`${end}T00:00:00`), WINDOW_DAYS));
  // Week-long chunks side by side (same rows, same order as one read).
  const rows = await fetchAllByDateChunks<AlertAdsRow>(
    start,
    end,
    7,
    (s, e) => (from, to) =>
      db
        .from("ads_daily")
        .select("date, campaign_id, campaign_name, spend_minor_units, clicks, impressions")
        .eq("client_id", clientId)
        .gte("date", s)
        .lte("date", e)
        .order("date", { ascending: true })
        .order("provider", { ascending: true })
        .order("campaign_id", { ascending: true })
        .range(from, to),
    { lane }
  );
  return { start, end, rows };
}

/**
 * The rows a read of [start, end] alone returns - same rows, same order, as
 * the shared read is ordered by date first - or null when `shared` doesn't
 * cover that window (e.g. the Warsaw day turned over in between): the
 * caller then reads its own.
 */
export function rowsWithin(
  shared: AlertAdsWindow | null | undefined,
  start: string,
  end: string
): AlertAdsRow[] | null {
  if (!shared || start < shared.start || end > shared.end) return null;
  return shared.rows.filter((r) => r.date >= start && r.date <= end);
}
