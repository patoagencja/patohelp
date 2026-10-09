import { cache } from "react";
import { formatInTimeZone } from "date-fns-tz";

import { decrypt } from "@/lib/integrations/encryption";
import { isTokenError } from "@/lib/integrations/errors";
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
  /** Google token died ~7 days after it was granted: the OAuth app is almost
   *  certainly still in "Testing", which caps refresh tokens at 7 days. */
  testingModeSuspected: boolean;
  /** Reconnected after the newest run: the old failure no longer applies and
   *  the next sync (cron every 30 min) will pull the missing days. */
  reconnected: boolean;
}

/** A failed run counts once the last success is this old (or it failed twice). */
const FAILING_AFTER_HOURS = 2;

/** Stale threshold: crons run every 30 min, so 12h means genuinely broken. */
const STALE_HOURS = 12;

/** A "running" row older than this was killed (maxDuration is 300s at most). */
const STUCK_RUN_MINUTES = 15;

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
      .select("provider, updated_at")
      .eq("client_id", clientId);
    if (intErr || !integrations?.length) return [];

    const configured = integrations
      .map((i) => i.provider as ProviderKey)
      .filter((p): p is ProviderKey => p in PROVIDER_LABEL);
    if (!configured.length) return [];

    // Providers are independent: check them all at once. A sequential loop
    // made the banner (and the agency's client list) wait one extra round
    // trip per connected integration.
    const checks = await Promise.all(
      configured.map(async (provider): Promise<ProviderHealth | null> => {
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
            .limit(2),
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

        const recent = (newestRes.data ?? []) as Array<{
          status: string;
          started_at: string | null;
          finished_at: string | null;
          error_message: string | null;
        }>;
        const newest = recent[0];
        // A provider with no runs at all was just connected - not a failure yet.
        if (!newest) return null;

        const hoursSinceSuccess = successRes.data?.finished_at
          ? (Date.now() -
              new Date(successRes.data.finished_at as string).getTime()) /
            3_600_000
          : null;

        const lastAttemptAt = (newest.started_at as string | null) ?? null;
        const hoursSinceAttempt = lastAttemptAt
          ? (Date.now() - new Date(lastAttemptAt).getTime()) / 3_600_000
          : null;

        const connectedAt = integrations.find((i) => i.provider === provider)
          ?.updated_at as string | undefined;
        // Credentials saved after the newest run started: that run's error
        // was about the old token. Without this the banner kept saying "token
        // wygasł" right next to the "Połączono" toast until the next cron.
        const reconnected =
          !!connectedAt &&
          !!newest.started_at &&
          new Date(connectedAt).getTime() >
            new Date(newest.started_at as string).getTime();

        // One failed run is often a blip (a Meta rate limit, a GA4 quota
        // hiccup) that the next run fixes; it used to put "liczby są
        // niepełne" in front of the client and page the agency at night.
        // Failing = the token is dead, two runs in a row failed, or the
        // last success is over two hours old.
        const lastFailed = newest.status === "failed" && !reconnected;
        const failing =
          lastFailed &&
          (isTokenError(newest.error_message) ||
            recent[1]?.status === "failed" ||
            hoursSinceSuccess === null ||
            hoursSinceSuccess > FAILING_AFTER_HOURS);
        const stale =
          hoursSinceSuccess === null || hoursSinceSuccess > STALE_HOURS;
        if (!failing && !stale) return null;

        // A run whose function was killed (timeout) stays "running" forever
        // with no message; name that instead of showing nothing.
        const stuck =
          newest.status === "running" &&
          hoursSinceAttempt !== null &&
          hoursSinceAttempt * 60 > STUCK_RUN_MINUTES;
        const lastError =
          (newest.error_message as string | null) ??
          (stuck
            ? "Ostatnia synchronizacja nie została dokończona (funkcja przerwana, np. przekroczony limit czasu)."
            : null);
        const tokenExpired = failing && isTokenError(lastError);

        // Testing-mode tokens die 7 days after consent. If the last success
        // landed 6-8 days after the integration was (re)connected, that is the
        // signature - point at the permanent fix instead of another reconnect.
        let testingModeSuspected = false;
        if (
          tokenExpired &&
          (provider === "ga4" || provider === "google_ads") &&
          connectedAt &&
          successRes.data?.finished_at
        ) {
          const days =
            (new Date(successRes.data.finished_at as string).getTime() -
              new Date(connectedAt).getTime()) /
            86_400_000;
          testingModeSuspected = days >= 6 && days <= 8;
        }

        return {
          provider,
          label: PROVIDER_LABEL[provider],
          hoursSinceSuccess,
          hoursSinceAttempt,
          lastError,
          failing,
          // Only claim "token expired" when that is the CURRENT failure. A stale
          // error from an old run must not keep telling you to reconnect after
          // you already have.
          tokenExpired,
          testingModeSuspected,
          reconnected,
        };
      })
    );

    // Same order as the configured providers, as before.
    return checks.filter((h): h is ProviderHealth => h !== null);
  } catch {
    return [];
  }
}

/** Ad providers: the ones with spend in ads_daily and a per-account selection. */
export const AD_PROVIDERS = ["meta_ads", "google_ads", "tiktok_ads"] as const;
export type AdProviderKey = (typeof AD_PROVIDERS)[number];

/**
 * Days without spend before a healthy ad source reads as "nothing running".
 * Ads data lands with a day's lag and some campaigns pause over a weekend, so
 * one or two quiet days are routine.
 */
const IDLE_DAYS = 3;

/**
 * Connected ad providers whose newest run succeeded within STALE_HOURS - the
 * ones getUnhealthyIntegrations stays silent about. The newest run being a
 * success makes it the last success too, so one query per provider is enough.
 * Memoised per request: the idle note and the partial-failure note both read
 * these rows.
 */
const readHealthyAdRuns = cache(
  async (
    clientId: string
  ): Promise<Array<{ provider: AdProviderKey; errorMessage: string | null }>> => {
    const admin = createAdminClient();
    const { data: integrations, error } = await admin
      .from("integrations")
      .select("provider")
      .eq("client_id", clientId)
      .in("provider", [...AD_PROVIDERS]);
    if (error) throw new Error(error.message);

    const runs = await Promise.all(
      (integrations ?? []).map(async (i) => {
        const provider = i.provider as AdProviderKey;
        const { data: newest } = await admin
          .from("sync_runs")
          .select("status, finished_at, error_message")
          .eq("client_id", clientId)
          .eq("provider", provider)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (newest?.status !== "success" || !newest.finished_at) return null;
        const hours =
          (Date.now() - new Date(newest.finished_at as string).getTime()) / 3_600_000;
        if (hours > STALE_HOURS) return null;
        return { provider, errorMessage: (newest.error_message as string | null) ?? null };
      })
    );
    return runs.filter((r): r is NonNullable<typeof r> => r !== null);
  }
);

export interface IdleAdSource {
  provider: AdProviderKey;
  label: string;
  /** Whole days between the last day with spend and today (Europe/Warsaw). */
  daysIdle: number;
  /** yyyy-MM-dd of the newest ads_daily row with spend > 0. */
  lastSpendDate: string;
}

/**
 * Healthy ad sources that have spent nothing for IDLE_DAYS or more. Paused
 * campaigns write no rows, which used to look identical to a broken sync;
 * this lets the dashboard say "nothing is running" calmly instead. A source
 * that never spent at all is skipped - that is a client still being set up.
 * Returns [] on any error, like the other health helpers.
 */
export async function getIdleAdSources(clientId: string): Promise<IdleAdSource[]> {
  try {
    const healthy = await readHealthyAdRuns(clientId);
    if (!healthy.length) return [];

    const admin = createAdminClient();
    const today = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");
    const idle = await Promise.all(
      healthy.map(async ({ provider }): Promise<IdleAdSource | null> => {
        const { data, error } = await admin
          .from("ads_daily")
          .select("date")
          .eq("client_id", clientId)
          .eq("provider", provider)
          .gt("spend_minor_units", 0)
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error || !data?.date) return null;

        const lastSpendDate = data.date as string;
        // Both sides are plain calendar dates parsed as UTC midnight, so the
        // difference is a whole number of days with no DST drift.
        const daysIdle = Math.round(
          (Date.parse(today) - Date.parse(lastSpendDate)) / 86_400_000
        );
        if (!(daysIdle >= IDLE_DAYS)) return null;
        return { provider, label: PROVIDER_LABEL[provider], daysIdle, lastSpendDate };
      })
    );
    return idle.filter((s): s is IdleAdSource => s !== null);
  } catch {
    return [];
  }
}

export interface PartialSyncFailure {
  provider: AdProviderKey;
  label: string;
  /** The run's joined per-account errors ("act_1: ... | act_2: ..."). */
  error: string;
}

/**
 * Healthy ad sources whose newest run still reported per-account errors (some
 * accounts broke, the rest synced - see resolveSyncOutcome). Deliberately NOT
 * part of getUnhealthyIntegrations: one disabled account among dozens must
 * not flip a working integration to "broken" everywhere.
 */
export async function getPartialSyncFailures(
  clientId: string
): Promise<PartialSyncFailure[]> {
  try {
    const healthy = await readHealthyAdRuns(clientId);
    return healthy
      .filter((r) => r.errorMessage)
      .map((r) => ({
        provider: r.provider,
        label: PROVIDER_LABEL[r.provider],
        error: r.errorMessage as string,
      }));
  } catch {
    return [];
  }
}

export interface ExpiringToken {
  provider: ProviderKey;
  label: string;
  daysLeft: number;
}

/** Warn this many days ahead - enough to swap in a permanent token calmly. */
const EXPIRY_WARN_DAYS = 14;

/**
 * Integrations whose stored token has a known expiry date coming up. Today
 * only Meta stores one (OAuth user tokens live ~60 days; system user tokens
 * have none). Catching it before it dies means no gap in the data.
 */
export async function getExpiringTokens(
  clientId: string
): Promise<ExpiringToken[]> {
  try {
    const { data } = await createAdminClient()
      .from("integrations")
      .select("provider, credentials_encrypted")
      .eq("client_id", clientId)
      .eq("provider", "meta_ads")
      .maybeSingle();
    if (!data?.credentials_encrypted) return [];
    const creds = JSON.parse(decrypt(data.credentials_encrypted as string)) as {
      expires_at?: string | null;
    };
    if (!creds.expires_at) return [];
    const daysLeft = Math.ceil(
      (new Date(creds.expires_at).getTime() - Date.now()) / 86_400_000
    );
    // Already expired is reported by getUnhealthyIntegrations as a failure.
    if (daysLeft <= 0 || daysLeft > EXPIRY_WARN_DAYS) return [];
    return [{ provider: "meta_ads", label: PROVIDER_LABEL.meta_ads, daysLeft }];
  } catch {
    return [];
  }
}
