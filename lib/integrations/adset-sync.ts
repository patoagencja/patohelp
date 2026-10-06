import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

import { decrypt } from "@/lib/integrations/encryption";
import { describeError } from "@/lib/integrations/errors";
import { getAdGroupMetrics } from "@/lib/integrations/google-ads";
import { hasClicksAllColumnStrict, intOrZero } from "@/lib/integrations/link-clicks";
import { extractConversions, getAdsetInsights } from "@/lib/integrations/meta-ads";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Ad set (Meta) / ad group (Google) daily delivery into ads_adset_daily
 * (migration 0033), for ad set goals and the goal form's picker. Runs in its
 * own cron (refresh-adsets) and on demand from the goal form: as a side job
 * of the campaign crons it never started on a big account (OLX), whose
 * campaign backfill used up the whole time budget first. Skipped entirely
 * until the table exists.
 */

type AdminClient = ReturnType<typeof createAdminClient>;
type Provider = "meta_ads" | "google_ads";

const WARSAW_TZ = "Europe/Warsaw";
/** Default window: enough for the picker (60 days is read) and most goals. */
const BASE_DAYS = 35;
/** Older running goals widen the window, but never past this. */
const MAX_DAYS = 120;
/** Warsaw hour of the once-a-day full re-pull (late conversions, edits). */
const FULL_REFRESH_HOUR = 5;
const UPSERT_CHUNK = 500;

const day = (d: Date) => formatInTimeZone(d, WARSAW_TZ, "yyyy-MM-dd");
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** False until migration 0033 has run (probe, like the other optional tables). */
export async function hasAdsetTable(admin: AdminClient): Promise<boolean> {
  const probe = await admin.from("ads_adset_daily").select("client_id").limit(1);
  return !probe.error;
}

/**
 * The days to (re)pull for one client + provider. The full window - last 35
 * days, or since the earliest running/upcoming goal if earlier (max 120) -
 * on the first run, whenever its first week has no rows yet (backfill, or a
 * goal reaching further back), and once a day; otherwise just the last 3
 * days, which keeps the half-hourly cron cheap. Meta also gets the full
 * window while it still holds rows from before migration 0034 (clicks_all
 * NULL = clicks (all), not link clicks), so goals compare like with like.
 */
export async function adsetSyncWindow(
  admin: AdminClient,
  clientId: string,
  provider: Provider,
  now = new Date(),
  full = false,
  withClicksAll = false
): Promise<{ since: string; until: string }> {
  const until = day(now);
  let since = day(subDays(now, BASE_DAYS - 1));
  const floor = day(subDays(now, MAX_DAYS - 1));

  const { data: goals } = await admin
    .from("campaign_flights")
    .select("start_date")
    .eq("client_id", clientId)
    .gte("end_date", plusDays(until, -3))
    .order("start_date", { ascending: true })
    .limit(1);
  const earliest = (goals?.[0]?.start_date as string | undefined) ?? null;
  if (earliest && earliest < since) since = earliest < floor ? floor : earliest;

  const hour = Number(formatInTimeZone(now, WARSAW_TZ, "H"));
  if (full || hour === FULL_REFRESH_HOUR) return { since, until };

  const { data: head } = await admin
    .from("ads_adset_daily")
    .select("date")
    .eq("client_id", clientId)
    .eq("provider", provider)
    .gte("date", since)
    .lte("date", plusDays(since, 6))
    .limit(1);
  if (!head || head.length === 0) return { since, until };

  if (withClicksAll && provider === "meta_ads") {
    const { data: stale } = await admin
      .from("ads_adset_daily")
      .select("date")
      .eq("client_id", clientId)
      .eq("provider", provider)
      .gte("date", since)
      .is("clicks_all", null)
      .limit(1);
    if (stale && stale.length > 0) return { since, until };
  }

  return { since: plusDays(until, -2), until };
}

async function upsertChunks(admin: AdminClient, rows: Record<string, unknown>[]): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await admin
      .from("ads_adset_daily")
      .upsert(chunk, { onConflict: "client_id,provider,adset_id,date" });
    if (error) throw new Error(error.message);
    written += chunk.length;
  }
  return written;
}

export interface AdsetSyncResult {
  written: number;
  /** Human-readable failures (account + API message), for the form and logs. */
  errors: string[];
}

/**
 * After a clean full pass over [since, until], pre-0034 Meta rows that Meta no
 * longer returns (deleted ad sets) would keep clicks_all NULL and force the
 * full window on every run. Close them with clicks_all = their stored clicks.
 * Upserting only the key columns + clicks_all leaves the rest untouched.
 */
async function closeStaleAdsetClickRows(
  admin: AdminClient,
  clientId: string,
  since: string,
  until: string
): Promise<void> {
  const { data, error } = await admin
    .from("ads_adset_daily")
    .select("adset_id, date, clicks")
    .eq("client_id", clientId)
    .eq("provider", "meta_ads")
    .gte("date", since)
    .lte("date", until)
    .is("clicks_all", null)
    .limit(1000);
  if (error || !data || data.length === 0) return;
  try {
    await upsertChunks(
      admin,
      data.map((r) => ({
        client_id: clientId,
        provider: "meta_ads",
        adset_id: r.adset_id as string,
        date: r.date as string,
        clicks_all: Number(r.clicks ?? 0),
      }))
    );
  } catch (err) {
    console.warn("[adset-sync] closing stale click rows failed", describeError(err));
  }
}

/** Meta: ad set insights per selected account. */
export async function syncMetaAdsets(
  admin: AdminClient,
  clientId: string,
  accessToken: string,
  accountIds: string[],
  shouldStop: () => boolean,
  campaignId?: string,
  /** Migration 0034 ran (probed when omitted). */
  withClicksAll?: boolean
): Promise<AdsetSyncResult> {
  const clicksAll = withClicksAll ?? (await hasClicksAllColumnStrict(admin, "ads_adset_daily"));
  // One campaign on demand: always the full window, it is a handful of calls.
  const { since, until } = await adsetSyncWindow(
    admin,
    clientId,
    "meta_ads",
    new Date(),
    !!campaignId,
    clicksAll
  );
  const result: AdsetSyncResult = { written: 0, errors: [] };
  for (const accountId of accountIds) {
    if (shouldStop()) break;
    try {
      const insights = await getAdsetInsights(accessToken, accountId, since, until, shouldStop, campaignId);
      const now = new Date().toISOString();
      result.written += await upsertChunks(
        admin,
        insights.map((r) => ({
          client_id: clientId,
          provider: "meta_ads",
          account_id: accountId,
          campaign_id: r.campaign_id || null,
          campaign_name: r.campaign_name || null,
          adset_id: r.adset_id,
          adset_name: r.adset_name || null,
          date: r.date,
          spend_minor_units: Math.round(parseFloat(r.spend || "0") * 100) || 0,
          impressions: parseInt(r.impressions, 10) || 0,
          // Link clicks in `clicks` once 0034 ran; before it, clicks (all)
          // exactly as always.
          ...(clicksAll
            ? { clicks: intOrZero(r.link_clicks), clicks_all: intOrZero(r.clicks) }
            : { clicks: intOrZero(r.clicks) }),
          reach: r.reach != null ? parseInt(r.reach, 10) || null : null,
          conversions: extractConversions(r.actions),
          updated_at: now,
        }))
      );
    } catch (err) {
      // One account failing must not stop the others (or the cron).
      result.errors.push(`Meta ${accountId}: ${describeError(err)}`);
    }
  }
  // Only after a complete pass: a single campaign's fetch, a failed account
  // or a time-budget cut leaves rows that a later run will still re-pull.
  if (clicksAll && !campaignId && result.errors.length === 0 && !shouldStop()) {
    await closeStaleAdsetClickRows(admin, clientId, since, until);
  }
  return result;
}

/** Google: ad group metrics per selected account. */
export async function syncGoogleAdGroups(
  admin: AdminClient,
  clientId: string,
  refreshToken: string,
  accounts: Array<{ id: string; video_only?: boolean }>,
  shouldStop: () => boolean,
  campaignId?: string,
  /** Migration 0034 ran (probed when omitted). */
  withClicksAll?: boolean
): Promise<AdsetSyncResult> {
  const clicksAll = withClicksAll ?? (await hasClicksAllColumnStrict(admin, "ads_adset_daily"));
  const { since, until } = await adsetSyncWindow(admin, clientId, "google_ads", new Date(), !!campaignId);
  const result: AdsetSyncResult = { written: 0, errors: [] };
  for (const account of accounts) {
    if (shouldStop()) break;
    try {
      const metrics = await getAdGroupMetrics(
        refreshToken,
        account.id,
        since,
        until,
        account.video_only === true,
        campaignId
      );
      const now = new Date().toISOString();
      result.written += await upsertChunks(
        admin,
        metrics
          .filter((m) => m.ad_group_id)
          .map((m) => ({
            client_id: clientId,
            provider: "google_ads",
            account_id: account.id,
            campaign_id: m.campaign_id || null,
            campaign_name: m.campaign_name || null,
            adset_id: m.ad_group_id,
            adset_name: m.ad_group_name || null,
            date: m.date,
            spend_minor_units: Math.round(m.cost_micros / 10_000),
            impressions: m.impressions,
            clicks: m.clicks,
            // Google ad clicks are link-like already: both columns agree.
            ...(clicksAll ? { clicks_all: m.clicks } : {}),
            reach: null,
            conversions: m.conversions,
            updated_at: now,
          }))
      );
    } catch (err) {
      result.errors.push(`Google ${account.id}: ${describeError(err)}`);
    }
  }
  return result;
}

interface StoredAccount {
  id: string;
  selected?: boolean;
  video_only?: boolean;
}

/**
 * Every selected Meta/Google account of one client (or one provider, or one
 * campaign of it). Reads and decrypts the stored credentials itself so the
 * cron and the goal form share one path.
 */
export async function syncAdsetsForClient(
  admin: AdminClient,
  clientId: string,
  opts: { provider?: Provider; campaignId?: string; shouldStop?: () => boolean } = {}
): Promise<AdsetSyncResult> {
  const shouldStop = opts.shouldStop ?? (() => false);
  const total: AdsetSyncResult = { written: 0, errors: [] };
  let withClicksAll: boolean;
  try {
    withClicksAll = await hasClicksAllColumnStrict(admin, "ads_adset_daily");
  } catch (probeErr) {
    // Unknown write shape: write nothing this time, the next run retries.
    total.errors.push(describeError(probeErr));
    return total;
  }
  const { data: integrations, error } = await admin
    .from("integrations")
    .select("provider, credentials_encrypted, account_ids")
    .eq("client_id", clientId)
    .in("provider", opts.provider ? [opts.provider] : ["meta_ads", "google_ads"]);
  if (error) {
    total.errors.push(error.message);
    return total;
  }
  for (const integration of integrations ?? []) {
    if (shouldStop()) break;
    const accounts = ((integration.account_ids ?? []) as StoredAccount[]).filter(
      (a) => a.selected === true
    );
    if (!accounts.length) continue;
    try {
      const creds = JSON.parse(decrypt(integration.credentials_encrypted as string));
      const r =
        integration.provider === "meta_ads"
          ? await syncMetaAdsets(
              admin,
              clientId,
              creds.access_token,
              accounts.map((a) => a.id),
              shouldStop,
              opts.campaignId,
              withClicksAll
            )
          : await syncGoogleAdGroups(
              admin,
              clientId,
              creds.refresh_token,
              accounts,
              shouldStop,
              opts.campaignId,
              withClicksAll
            );
      total.written += r.written;
      total.errors.push(...r.errors);
    } catch (err) {
      total.errors.push(`${integration.provider}: ${describeError(err)}`);
    }
  }
  return total;
}
