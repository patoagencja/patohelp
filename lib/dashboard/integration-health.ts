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

    // One pass over recent runs beats a query per provider.
    const { data: runs, error: runErr } = await admin
      .from("sync_runs")
      .select("provider, status, finished_at, started_at, error_message")
      .eq("client_id", clientId)
      .order("started_at", { ascending: false })
      .limit(400);
    if (runErr) return [];

    const out: ProviderHealth[] = [];
    for (const provider of configured) {
      const mine = (runs ?? []).filter((r) => r.provider === provider);
      // A provider with no runs at all was just connected - not a failure yet.
      if (!mine.length) continue;

      const newest = mine[0];
      const lastSuccess = mine.find(
        (r) => r.status === "success" && r.finished_at
      );
      const hoursSinceSuccess = lastSuccess?.finished_at
        ? (Date.now() - new Date(lastSuccess.finished_at as string).getTime()) /
          3_600_000
        : null;

      const failing = newest.status === "failed";
      const stale =
        hoursSinceSuccess === null || hoursSinceSuccess > STALE_HOURS;
      if (!failing && !stale) continue;

      const lastError =
        (newest.error_message as string | null) ??
        (mine.find((r) => r.error_message)?.error_message as string | null) ??
        null;

      out.push({
        provider,
        label: PROVIDER_LABEL[provider],
        hoursSinceSuccess,
        lastError,
        failing,
        tokenExpired: isTokenError(lastError),
      });
    }

    return out;
  } catch {
    return [];
  }
}
