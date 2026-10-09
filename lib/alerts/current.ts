import { cache } from "react";

import { readAlertAdsWindow } from "@/lib/alerts/ads-window";
import { detectAnomalies, type Anomaly } from "@/lib/alerts/anomalies";
import { detectBudgetSpikes, type BudgetConfig } from "@/lib/alerts/budget";
import { getLastSyncAt } from "@/lib/dashboard/context";
import { syncCached } from "@/lib/dashboard/sync-cache";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Every alert a client currently has: budget spikes first, then the
 * change-based anomalies. Same chain the overview and the Alerty page use
 * (the spike detector needs the client's caps from notification_settings).
 * React `cache` dedupes it within one request, so the header bell's count,
 * the overview's status and the Alerty page share a single scan; the scan
 * itself (three weeks of every campaign's rows, read once for both
 * detectors) is shared across requests until the next sync lands. The caps are read live and are part of the key,
 * so changing them in Ustawienia applies on the next render.
 *
 * Callers MUST pass a client id resolved through RLS (getClientBySlug): the
 * scan reads with the service role.
 */
export const getCurrentAlerts = cache(async (clientId: string): Promise<Anomaly[]> => {
  // The sync stamp (cache key) is read alongside the caps, not after them.
  void getLastSyncAt(clientId).catch(() => null);
  const admin = createAdminClient();
  const { data: notif } = await admin
    .from("notification_settings")
    .select(
      "daily_spend_cap_minor_units, account_daily_spend_cap_minor_units, spike_multiplier"
    )
    .eq("client_id", clientId)
    .maybeSingle();
  const budgetConfig: BudgetConfig = {
    campaignCap: (notif?.daily_spend_cap_minor_units as number | null) ?? null,
    accountCap: (notif?.account_daily_spend_cap_minor_units as number | null) ?? null,
    multiplier:
      notif?.spike_multiplier && Number(notif.spike_multiplier) > 0
        ? Number(notif.spike_multiplier)
        : 3,
  };
  return syncCached(
    "alerts",
    clientId,
    [budgetConfig.campaignCap, budgetConfig.accountCap, budgetConfig.multiplier],
    async () => {
      const db = createAdminClient();
      // One read of the three weeks both detectors look at. The bell and the
      // overview's status stream in after the page, so the scan takes the
      // background lane: it never queues the dashboard's own reads.
      const shared = readAlertAdsWindow(db, clientId, "background");
      const [spikes, anomalies] = await Promise.all([
        detectBudgetSpikes(clientId, db, budgetConfig, shared),
        detectAnomalies(clientId, db, shared),
      ]);
      return [...spikes, ...anomalies];
    }
  );
});

/** What the header bell counts: alerts that need a look (Pilne + Ważne). */
export function countAttentionAlerts(alerts: Anomaly[]): number {
  return alerts.filter((a) => a.severity === "critical" || a.severity === "high").length;
}
