import { createAdminClient } from "@/lib/supabase/admin";

// Per-provider sync health. The header's "Zaktualizowano X temu" label takes the
// newest SUCCESSFUL run across ALL providers, so a single dead integration is
// invisible there: Meta syncing every 30 min keeps the header green while GA4
// has been failing for weeks (exactly how SUNEW's revenue silently flatlined
// from 21.08). This computes health per provider so the UI can say so.

export type ProviderKey = "meta_ads" | "google_ads" | "tiktok_ads" | "ga4";

export const PROVIDER_LABEL: Record<ProviderKey, string> = {
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  tiktok_ads: "TikTok Ads",
  ga4: "Google Analytics 4",
};

export interface ProviderHealth {
  provider: ProviderKey;
  label: string;
  /** Hours since the last successful sync; null when it never succeeded. */
  hoursSinceSuccess: number | null;
  /** Hours since the last ATTEMPT. Distinguishes "failing right now" from
   *  "nothing has even tried since X" (e.g. the cron stopped reaching it). */
  hoursSinceAttempt: number | null;
  /** Error from the most recent run, when that run failed. */
  lastError: string | null;
  /** true when the newest run for this provider failed. */
  failing: boolean;
  /** Expired/revoked OAuth token - needs a reconnect, not a retry. */
  tokenExpired: boolean;
}

/** Stale threshold: crons run every 30 min, so 12h means genuinely broken. */
const STALE_HOURS = 12;

function isTokenError(message: string | null): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("invalid_grant") ||
    m.includes("invalid grant") ||
    m.includes("token has been expired") ||
    m.includes("revoked")
  );
}

/**
 * Providers that are configured for this client but whose data is not arriving:
 * the newest run failed, or nothing succeeded in the last STALE_HOURS.
 * Returns [] on any error - health reporting must never break the dashboard.
 */
export async function getUnhealthyIntegrations(
  clientId: string
): Promise<ProviderHealth[]> {
  try {
    const admin = createAdminClient();

    const { data: integrations, error: intErr } = await admin
      .from("integrations")
      .select("provider")
      .eq("client_id", clientId);
    if (intErr || !integrations?.length) return [];

    const configured = integrations
      .map((i) => i.provider as ProviderKey)
      .filter((p): p is ProviderKey => p in PROVIDER_LABEL);
    if (!configured.length) return [];

    const out: ProviderHealth[] = [];
    for (const provider of configured) {
      // Two targeted queries per provider. A single windowed fetch across all
      // providers was wrong: ~4 providers x 48 cron runs/day means a few
      // hundred rows cover barely two days, so an older last-success fell out
      // of the window and the age was reported from incomplete data.
      const [newestRes, successRes] = await Promise.all([
        admin
          .from("sync_runs")
          .select("status, started_at, finished_at, error_message")
          .eq("client_id", clientId)
          .eq("provider", provider)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        admin
          .from("sync_runs")
          .select("finished_at")
          .eq("client_id", clientId)
          .eq("provider", provider)
          .eq("status", "success")
          .not("finished_at", "is", null)
          .order("finished_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const newest = newestRes.data;
      // A provider with no runs at all was just connected - not a failure yet.
      if (!newest) continue;

      const hoursSinceSuccess = successRes.data?.finished_at
        ? (Date.now() -
            new Date(successRes.data.finished_at as string).getTime()) /
          3_600_000
        : null;

      const lastAttemptAt = (newest.started_at as string | null) ?? null;
      const hoursSinceAttempt = lastAttemptAt
        ? (Date.now() - new Date(lastAttemptAt).getTime()) / 3_600_000
        : null;

      const failing = newest.status === "failed";
      const stale =
        hoursSinceSuccess === null || hoursSinceSuccess > STALE_HOURS;
      if (!failing && !stale) continue;

      const lastError = (newest.error_message as string | null) ?? null;

      out.push({
        provider,
        label: PROVIDER_LABEL[provider],
        hoursSinceSuccess,
        hoursSinceAttempt,
        lastError,
        failing,
        // Only claim "token expired" when that is the CURRENT failure. A stale
        // error from an old run must not keep telling you to reconnect after
        // you already have.
        tokenExpired: failing && isTokenError(lastError),
      });
    }

    return out;
  } catch {
    return [];
  }
}
