import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

import { getAdGroupMetrics } from "@/lib/integrations/google-ads";
import { extractConversions, getAdsetInsights } from "@/lib/integrations/meta-ads";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Ad set (Meta) / ad group (Google) daily delivery into ads_adset_daily
 * (migration 0033), for ad set goals and the goal form's picker. A side job
 * of the ads crons: callers run it after the campaign-level sync, inside a
 * try/catch and only while their time budget allows, so it can never break
 * the main sync. Skipped entirely until the table exists.
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
 * days, which keeps the half-hourly cron cheap.
 */
export async function adsetSyncWindow(
  admin: AdminClient,
  clientId: string,
  provider: Provider,
  now = new Date()
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
  if (hour === FULL_REFRESH_HOUR) return { since, until };

  const { data: head } = await admin
    .from("ads_adset_daily")
    .select("date")
    .eq("client_id", clientId)
    .eq("provider", provider)
    .gte("date", since)
    .lte("date", plusDays(since, 6))
    .limit(1);
  if (!head || head.length === 0) return { since, until };

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

/** Meta: ad set insights per selected account. Returns rows written. */
export async function syncMetaAdsets(
  admin: AdminClient,
  clientId: string,
  accessToken: string,
  accountIds: string[],
  shouldStop: () => boolean
): Promise<number> {
  const { since, until } = await adsetSyncWindow(admin, clientId, "meta_ads");
  let written = 0;
  for (const accountId of accountIds) {
    if (shouldStop()) break;
    try {
      const insights = await getAdsetInsights(accessToken, accountId, since, until, shouldStop);
      const now = new Date().toISOString();
      written += await upsertChunks(
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
          clicks: parseInt(r.clicks, 10) || 0,
          reach: r.reach != null ? parseInt(r.reach, 10) || null : null,
          conversions: extractConversions(r.actions),
          updated_at: now,
        }))
      );
    } catch (err) {
      // One account failing must not stop the others (or the cron).
      console.error(`[adset-sync] meta account ${accountId} failed`, (err as Error).message);
    }
  }
  return written;
}

/** Google: ad group metrics per selected account. Returns rows written. */
export async function syncGoogleAdGroups(
  admin: AdminClient,
  clientId: string,
  refreshToken: string,
  accounts: Array<{ id: string; video_only?: boolean }>,
  shouldStop: () => boolean
): Promise<number> {
  const { since, until } = await adsetSyncWindow(admin, clientId, "google_ads");
  let written = 0;
  for (const account of accounts) {
    if (shouldStop()) break;
    try {
      const metrics = await getAdGroupMetrics(
        refreshToken,
        account.id,
        since,
        until,
        account.video_only === true
      );
      const now = new Date().toISOString();
      written += await upsertChunks(
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
            reach: null,
            conversions: m.conversions,
            updated_at: now,
          }))
      );
    } catch (err) {
      console.error(`[adset-sync] google account ${account.id} failed`, (err as Error).message);
    }
  }
  return written;
}
