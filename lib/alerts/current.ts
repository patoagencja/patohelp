import { cache } from "react";

import { detectAnomalies, type Anomaly } from "@/lib/alerts/anomalies";
import { detectBudgetSpikes, type BudgetConfig } from "@/lib/alerts/budget";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Every alert a client currently has: budget spikes first, then the
 * change-based anomalies. Same chain the overview and the Alerty page use
 * (the spike detector needs the client's caps from notification_settings).
 * React `cache` dedupes it within one request, so the header bell's count
 * and the Alerty page share a single scan.
 */
export const getCurrentAlerts = cache(async (clientId: string): Promise<Anomaly[]> => {
  const spikesPromise = createAdminClient()
    .from("notification_settings")
    .select(
      "daily_spend_cap_minor_units, account_daily_spend_cap_minor_units, spike_multiplier"
    )
    .eq("client_id", clientId)
    .maybeSingle()
    .then(({ data: notif }) => {
      const budgetConfig: BudgetConfig = {
        campaignCap: (notif?.daily_spend_cap_minor_units as number | null) ?? null,
        accountCap:
          (notif?.account_daily_spend_cap_minor_units as number | null) ?? null,
        multiplier:
          notif?.spike_multiplier && Number(notif.spike_multiplier) > 0
            ? Number(notif.spike_multiplier)
            : 3,
      };
      return detectBudgetSpikes(clientId, undefined, budgetConfig);
    });
  const [spikes, anomalies] = await Promise.all([spikesPromise, detectAnomalies(clientId)]);
  return [...spikes, ...anomalies];
});

/** What the header bell counts: alerts that need a look (Pilne + Ważne). */
export function countAttentionAlerts(alerts: Anomaly[]): number {
  return alerts.filter((a) => a.severity === "critical" || a.severity === "high").length;
}
