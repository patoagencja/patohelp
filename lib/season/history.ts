import type { createAdminClient } from "@/lib/supabase/admin";

import { parseSeason, seasonLength, seasonWindow, type SeasonConfig } from "./config";

type Admin = ReturnType<typeof createAdminClient>;

/** Default ad history: a year back, for year-over-year comparisons. */
export const DEFAULT_HISTORY_DAYS = 365;
/**
 * Seasonal clients compare a season with the whole previous one: on the last
 * day of an October-January season that one began ~15.5 months earlier.
 */
export const SEASONAL_HISTORY_DAYS = 470;

/**
 * Days back from a season's last day to the previous season's first: a
 * year plus the season's own length (+ a week of slack). Long seasons (mid
 * September to end of January) need more than the default 470.
 */
export function historyDaysForSeason(cfg: SeasonConfig): number {
  const w = seasonWindow(cfg, 2025);
  return Math.max(SEASONAL_HISTORY_DAYS, 366 + seasonLength(w) + 7);
}

/** How many days of ad history the sync keeps for this client. */
export async function historyDaysFor(admin: Admin, clientId: string): Promise<number> {
  // Before migration 0037 the column doesn't exist: the error means "not
  // seasonal", exactly the old behaviour.
  const { data, error } = await admin
    .from("clients")
    .select("season")
    .eq("id", clientId)
    .maybeSingle();
  if (error || !data) return DEFAULT_HISTORY_DAYS;
  const season = parseSeason((data as { season?: unknown }).season);
  return season ? historyDaysForSeason(season) : DEFAULT_HISTORY_DAYS;
}
