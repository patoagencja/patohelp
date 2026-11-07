import { getTimezoneOffset } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";

import { FLOW_STATE_KEY, openFlowAlerts, type FlowAlert, type FlowState } from "@/lib/alerts/data-flow";
import { readSyncState } from "@/lib/integrations/sync-state";

// The read side of the intraday data-flow guards: what detectAnomalies shows
// (and notify-alerts e-mails). The checks themselves run in refresh-ga4
// (lib/alerts/data-flow-check.ts); this module stays free of the GA4 client
// so the dashboard's alert scan doesn't pull googleapis in.

/** Warsaw's UTC offset at `now`, minutes. */
export function warsawOffsetMin(now: Date): number {
  return Math.round(getTimezoneOffset("Europe/Warsaw", now) / 60_000);
}

/**
 * The guards' stored state. Service role only (report_cache has RLS on and
 * no policy), so a user-scoped client simply reads nothing.
 */
export async function readFlowState(db: SupabaseClient, clientId: string): Promise<FlowState | null> {
  const read = await readSyncState<FlowState>(db, clientId, FLOW_STATE_KEY);
  return read.ok ? read.value : null;
}

/** Incidents open right now, worded for the client's type. */
export function currentFlowAlerts(state: FlowState | null, shop: boolean, now: Date = new Date()): FlowAlert[] {
  return openFlowAlerts(state, now.toISOString(), warsawOffsetMin(now), shop);
}
