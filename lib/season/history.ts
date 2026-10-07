import type { createAdminClient } from "@/lib/supabase/admin";

import { parseSeason } from "./config";

type Admin = ReturnType<typeof createAdminClient>;

/** Default ad history: a year back, for year-over-year comparisons. */
export const DEFAULT_HISTORY_DAYS = 365;
/**
 * Seasonal clients compare a season with the whole previous one: on the last
 * day of an October-January season that one began ~15.5 months earlier.
 */
export const SEASONAL_HISTORY_DAYS = 470;

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
  return parseSeason((data as { season?: unknown }).season)
    ? SEASONAL_HISTORY_DAYS
    : DEFAULT_HISTORY_DAYS;
}
