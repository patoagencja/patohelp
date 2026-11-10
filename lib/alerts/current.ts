import { cache } from "react";

import { readAlertAdsWindow } from "@/lib/alerts/ads-window";
import { detectAnomalies, type Anomaly } from "@/lib/alerts/anomalies";
import { detectBudgetSpikes, type BudgetConfig } from "@/lib/alerts/budget";
import { isSiteDownSymptom } from "@/lib/alerts/data-flow";
import { getSiteDownAlerts } from "@/lib/alerts/site-guard-read";
import { getLastSyncAt } from "@/lib/dashboard/context";
import { syncCached } from "@/lib/dashboard/sync-cache";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A scan where one detector failed: what the other found rides out of the
 * cache inside the error, so a half result is shown for this render but
 * never cached as the scan of this sync.
 */
class PartialAlertScan extends Error {
  readonly partialAlerts: Anomaly[];
  constructor(alerts: Anomaly[], cause: unknown) {
    super(`alert scan incomplete: ${(cause as Error)?.message ?? String(cause)}`);
    this.partialAlerts = alerts;
  }
}

/** The alerts a failed scan still carries (duck-typed: it crossed the cache). */
function partialAlertsOf(err: unknown): Anomaly[] {
  const alerts = (err as { partialAlerts?: unknown } | null)?.partialAlerts;
  return Array.isArray(alerts) ? (alerts as Anomaly[]) : [];
}

/**
 * Every alert a client currently has: a website outage first (the site
 * guard, migration 0045), then budget spikes, then the
 * change-based anomalies. Same chain the overview and the Alerty page use
 * (the spike detector needs the client's caps from notification_settings).
 * React `cache` dedupes it within one request, so the header bell's count,
 * the overview's status and the Alerty page share a single scan; the scan
 * itself (five weeks of every campaign's rows - the weekday streaks compare
 * with the same weekday of the last four weeks - read once for both
 * detectors) is shared across requests until the next sync lands. The caps are read live and are part of the key,
 * so changing them in Ustawienia applies on the next render.
 *
 * One broken source never takes the others down: a detector that fails
 * leaves what the other found (uncached, retried on the next render), and
 * an outage card survives a failed scan. Only when nothing at all could be
 * said does it throw - the callers then show "not checked", never "all
 * clear".
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
  // The website guard (Supabase checks the site every 5 min): a live
  // one-row read, outside the sync cache - an outage doesn't wait for a sync.
  const siteDown = getSiteDownAlerts(clientId);
  let scanned: Anomaly[];
  let failure: unknown = null;
  try {
    scanned = await syncCached(
      "alerts",
      clientId,
      [budgetConfig.campaignCap, budgetConfig.accountCap, budgetConfig.multiplier],
      async () => {
        const db = createAdminClient();
        // One read of the five weeks both detectors look at. The bell and the
        // overview's status stream in after the page, so the scan takes the
        // background lane: it never queues the dashboard's own reads.
        const shared = readAlertAdsWindow(db, clientId, "background");
        const [spikes, anomalies] = await Promise.allSettled([
          detectBudgetSpikes(clientId, db, budgetConfig, shared),
          detectAnomalies(clientId, db, shared),
        ]);
        const found = [
          ...(spikes.status === "fulfilled" ? spikes.value : []),
          ...(anomalies.status === "fulfilled" ? anomalies.value : []),
        ];
        const failed = spikes.status === "rejected" ? spikes : anomalies.status === "rejected" ? anomalies : null;
        if (failed) throw new PartialAlertScan(found, failed.reason);
        return found;
      }
    );
  } catch (err) {
    failure = err;
    scanned = partialAlertsOf(err);
    console.warn(`[alerts/current] scan for ${clientId} failed`, (err as Error)?.message ?? err);
  }
  const down = await siteDown;
  if (failure !== null && scanned.length === 0 && down.length === 0) throw failure;
  // While the site is down, "Analytics sees nobody" and "the shop stopped
  // sending sales" are that outage, not two more urgent things to check.
  const rest = down.length > 0 ? scanned.filter((a) => !isSiteDownSymptom(a.id)) : scanned;
  return [...down, ...rest];
});

/** What the header bell counts: alerts that need a look (Pilne + Ważne). */
export function countAttentionAlerts(alerts: Anomaly[]): number {
  return alerts.filter((a) => a.severity === "critical" || a.severity === "high").length;
}
