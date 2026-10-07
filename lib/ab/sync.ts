import { formatInTimeZone } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";

import { decrypt } from "@/lib/integrations/encryption";
import { describeError } from "@/lib/integrations/errors";
import {
  getActiveDays,
  getAdDailyInsights,
  getAdsMeta,
  type MetaAdDailyInsight,
  type MetaAdMeta,
} from "@/lib/integrations/meta-ads";
import { addDaysIso, seasonState, type SeasonConfig } from "@/lib/season/config";
import { fetchAll } from "@/lib/supabase/fetch-all";

import type { AbClient } from "./eligibility";

/**
 * Meta ad x day rows with purchases into ads_ad_daily (migration 0039), for
 * the creative test view. Called by /api/cron/refresh-ads-meta-ads every ~30
 * minutes - an owner spending tens of thousands a day must see a losing ad
 * within hours, not on the 6-hourly creatives snapshot.
 *
 * Per run and client:
 * 1. today + yesterday, always (even past the time budget);
 * 2. D-7..D-2 again once a day (their newest row older than 20h): purchases
 *    keep landing on past days for the whole attribution window;
 * 3. missing days back to max(35 days, the current / last season window),
 *    newest first, until the time budget runs out - the next run resumes.
 */

const WARSAW_TZ = "Europe/Warsaw";
/** Every eligible client keeps at least this much (30-day window + slack). */
const BASE_DAYS = 35;
const REFRESH_FROM = 7;
const REFRESH_TO = 2;
const REFRESH_AFTER_MS = 20 * 3_600_000;
/** Matches getAdDailyInsights' request slice, so each request upserts at once. */
const SLICE_DAYS = 3;
const UPSERT_CHUNK = 500;
/** sync_runs.provider of this job (free text column, no CHECK). */
export const AD_DAILY_SYNC_PROVIDER = "meta_ads_ads";

export interface AdDailySyncResult {
  /** Selected Meta accounts of the client. */
  accounts: number;
  written: number;
  /** Days requested this run (every selected account), newest first. */
  days: string[];
  /** Older days still to fetch (next run continues). */
  pending: number;
  creativesUpdated: number;
  /** Per-account fetch failures (they decide the sync_runs status). */
  errors: string[];
  /** Best-effort parts that failed (metadata, day bookkeeping). */
  warnings: string[];
}

/** False until migration 0039 has run. */
export async function hasAdDailyTable(admin: SupabaseClient): Promise<boolean> {
  const { error } = await admin.from("ads_ad_daily").select("ad_id").limit(1);
  return !error;
}

/**
 * Days the client should hold besides today and yesterday, oldest first:
 * the last 35 days plus the current season so far (or the last finished
 * season) - what the "Cały sezon" window reads. Off-season days between a
 * finished season and the last 35 days are read by nothing, so not pulled.
 */
export function targetDays(today: string, season: SeasonConfig | null): string[] {
  const days = new Set<string>();
  const last = addDaysIso(today, -2);
  for (let d = addDaysIso(today, -(BASE_DAYS - 1)); d <= last; d = addDaysIso(d, 1)) days.add(d);
  if (season) {
    const w = seasonState(season, today).current;
    const end = w.end < last ? w.end : last;
    for (let d = w.start; d <= end; d = addDaysIso(d, 1)) days.add(d);
  }
  return [...days].sort();
}

/** Newest-first days -> contiguous slices of at most SLICE_DAYS. */
export function slicesOf(daysDesc: string[]): Array<{ since: string; until: string }> {
  const out: Array<{ since: string; until: string }> = [];
  let cur: string[] = [];
  for (const d of daysDesc) {
    const prev = cur[cur.length - 1];
    if (cur.length && (cur.length >= SLICE_DAYS || addDaysIso(prev, -1) !== d)) {
      out.push({ since: prev, until: cur[0] });
      cur = [];
    }
    cur.push(d);
  }
  if (cur.length) out.push({ since: cur[cur.length - 1], until: cur[0] });
  return out;
}

/** day -> newest updated_at (ms) from the 0039 helper; null if unavailable. */
async function storedDays(
  admin: SupabaseClient,
  clientId: string,
  since: string
): Promise<Map<string, number> | null> {
  const { data, error } = await admin.rpc("ads_ad_daily_days", {
    p_client_id: clientId,
    p_since: since,
  });
  if (error) return null;
  const out = new Map<string, number>();
  for (const r of (data ?? []) as Array<{ day_date: string; newest: string | null }>) {
    out.set(String(r.day_date), r.newest ? Date.parse(r.newest) : 0);
  }
  return out;
}

interface SeenAd {
  adsetId: string | null;
  adsetName: string | null;
  campaignName: string | null;
}

async function upsertRows(
  admin: SupabaseClient,
  clientId: string,
  accountId: string,
  rows: MetaAdDailyInsight[],
  seen: Map<string, SeenAd>
): Promise<number> {
  const stamp = new Date().toISOString();
  // One row per (ad, day): a duplicate inside one upsert statement makes
  // Postgres reject the whole batch ("cannot affect row a second time").
  const byKey = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    byKey.set(`${r.ad_id}|${r.date}`, {
      client_id: clientId,
      provider: "meta_ads",
      account_id: accountId,
      campaign_id: r.campaign_id || null,
      campaign_name: r.campaign_name || null,
      adset_id: r.adset_id || null,
      adset_name: r.adset_name || null,
      ad_id: r.ad_id,
      ad_name: r.ad_name || null,
      date: r.date,
      spend_minor_units: Math.round(r.spend * 100),
      impressions: r.impressions,
      clicks: r.link_clicks,
      clicks_all: r.clicks_all,
      reach: r.reach != null ? Math.round(r.reach) : null,
      frequency: r.frequency,
      purchases: r.purchases,
      purchase_value_minor_units: Math.round(r.purchase_value * 100),
      video_3s_views: r.video_3s_views != null ? Math.round(r.video_3s_views) : null,
      updated_at: stamp,
    });
    seen.set(r.ad_id, {
      adsetId: r.adset_id || null,
      adsetName: r.adset_name || null,
      campaignName: r.campaign_name || null,
    });
  }
  const list = [...byKey.values()];
  for (let i = 0; i < list.length; i += UPSERT_CHUNK) {
    const { error } = await admin
      .from("ads_ad_daily")
      .upsert(list.slice(i, i + UPSERT_CHUNK), { onConflict: "client_id,provider,ad_id,date" });
    if (error) throw new Error(error.message);
  }
  return list.length;
}

const sameInstant = (a: string | null, b: string | null): boolean => {
  if (a == null || b == null) return a === b;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isFinite(ta) && Number.isFinite(tb) ? ta === tb : a === b;
};

/** Meta sends "2025-10-01T12:00:00+0200"; store a plain ISO instant. */
const isoOrNull = (v: string | null): string | null => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : v;
};

/**
 * Ad set, campaign name, status and creation time onto EXISTING creatives
 * rows only. Inserting metadata-only rows would put zero-spend ads into the
 * Kreacje tab, which lists creatives by spend; ads that delivered in the
 * last 30 days get their row from refresh-creatives-meta and their metadata
 * on the next run here. Only changed rows are written.
 */
async function updateCreativeMeta(
  admin: SupabaseClient,
  clientId: string,
  seen: Map<string, SeenAd>,
  listed: Map<string, MetaAdMeta>
): Promise<number> {
  const existing = await fetchAll<Record<string, unknown>>((from, to) =>
    admin
      .from("creatives")
      .select("ad_id, adset_id, adset_name, campaign_name, effective_status, created_time")
      .eq("client_id", clientId)
      .eq("provider", "meta_ads")
      .order("ad_id", { ascending: true })
      .range(from, to)
  );
  const updates: Array<Record<string, unknown>> = [];
  for (const row of existing) {
    const adId = String(row.ad_id);
    const s = seen.get(adId);
    const m = listed.get(adId);
    if (!s && !m) continue;
    const cur = {
      adset_id: (row.adset_id as string | null) ?? null,
      adset_name: (row.adset_name as string | null) ?? null,
      campaign_name: (row.campaign_name as string | null) ?? null,
      effective_status: (row.effective_status as string | null) ?? null,
      created_time: (row.created_time as string | null) ?? null,
    };
    const next = {
      adset_id: s?.adsetId ?? m?.adset_id ?? cur.adset_id,
      adset_name: s?.adsetName ?? cur.adset_name,
      campaign_name: s?.campaignName ?? cur.campaign_name,
      effective_status: m?.effective_status ?? cur.effective_status,
      created_time: isoOrNull(m?.created_time ?? null) ?? cur.created_time,
    };
    const changed =
      next.adset_id !== cur.adset_id ||
      next.adset_name !== cur.adset_name ||
      next.campaign_name !== cur.campaign_name ||
      next.effective_status !== cur.effective_status ||
      !sameInstant(next.created_time, cur.created_time);
    if (changed) updates.push({ client_id: clientId, provider: "meta_ads", ad_id: adId, ...next });
  }
  for (let i = 0; i < updates.length; i += UPSERT_CHUNK) {
    // Upsert names only these columns: on the existing row it updates them
    // and leaves spend, thumbnails and diagnostics untouched.
    const { error } = await admin
      .from("creatives")
      .upsert(updates.slice(i, i + UPSERT_CHUNK), { onConflict: "client_id,provider,ad_id" });
    if (error) throw new Error(error.message);
  }
  return updates.length;
}

export async function syncAdDailyForClient(
  admin: SupabaseClient,
  client: AbClient,
  opts: { shouldStop: () => boolean; now?: Date }
): Promise<AdDailySyncResult> {
  const result: AdDailySyncResult = {
    accounts: 0,
    written: 0,
    days: [],
    pending: 0,
    creativesUpdated: 0,
    errors: [],
    warnings: [],
  };
  const now = opts.now ?? new Date();
  const today = formatInTimeZone(now, WARSAW_TZ, "yyyy-MM-dd");
  const yesterday = addDaysIso(today, -1);

  const { data: integration, error: intErr } = await admin
    .from("integrations")
    .select("credentials_encrypted, account_ids")
    .eq("client_id", client.id)
    .eq("provider", "meta_ads")
    .maybeSingle();
  if (intErr) throw new Error(intErr.message);
  // Only accounts explicitly selected for this client, like every Meta sync.
  const storedAccounts = integration?.account_ids;
  const accounts = (
    Array.isArray(storedAccounts) ? (storedAccounts as Array<{ id: string; selected?: boolean }>) : []
  )
    .filter((a) => a.selected === true)
    .map((a) => a.id);
  result.accounts = accounts.length;
  if (!integration || accounts.length === 0) return result;
  const { access_token: token } = JSON.parse(decrypt(integration.credentials_encrypted as string)) as {
    access_token: string;
  };

  // ---- plan: which older days are missing or due for the daily re-pull
  const target = targetDays(today, client.season);
  const stored = await storedDays(admin, client.id, target[0]);
  const refresh: string[] = [];
  let missing: string[] = [];
  if (stored) {
    const refreshFrom = addDaysIso(today, -REFRESH_FROM);
    const refreshTo = addDaysIso(today, -REFRESH_TO);
    for (const d of target) {
      const newest = stored.get(d);
      if (newest == null) missing.push(d);
      else if (d >= refreshFrom && d <= refreshTo && now.getTime() - newest > REFRESH_AFTER_MS) {
        refresh.push(d);
      }
    }
  } else {
    // Without the bookkeeping we can't tell holes from stored days: keep the
    // fresh days flowing and leave history for a run that can.
    result.warnings.push("ads_ad_daily_days() unavailable - only today and yesterday pulled");
  }

  // A day with no rows may simply have had no delivery (before the shop
  // started advertising, a paused week). Ask Meta once per account which days
  // delivered, or those days get re-requested on every run forever. Past
  // the budget no history runs anyway, so don't spend the Meta call.
  if (missing.length && !opts.shouldStop()) {
    try {
      const active = new Set<string>();
      for (const accountId of accounts) {
        const days = await getActiveDays(token, accountId, missing[0], missing[missing.length - 1]);
        days.forEach((d) => active.add(d));
      }
      missing = missing.filter((d) => active.has(d));
    } catch (err) {
      result.warnings.push(`active-day probe failed, backfilling every missing day: ${describeError(err)}`);
    }
  }

  const older = [...new Set([...refresh, ...missing])].sort().reverse();
  const slices = [{ since: yesterday, until: today }, ...slicesOf(older)];

  // ---- fetch + upsert, slice by slice (progress persists if cut short)
  const failed = new Set<string>();
  const seen = new Map<string, SeenAd>();
  let listed: Map<string, MetaAdMeta> | null = null;
  let olderDaysPulled = 0;

  for (const [i, slice] of slices.entries()) {
    // The fresh slice always runs; history only within the time budget.
    if (i > 0 && opts.shouldStop()) break;
    for (const accountId of accounts) {
      if (failed.has(accountId)) continue;
      try {
        const rows = await getAdDailyInsights(token, accountId, slice.since, slice.until);
        result.written += await upsertRows(admin, client.id, accountId, rows, seen);
      } catch (err) {
        // One broken account must not stop the others; it sits out this run.
        failed.add(accountId);
        result.errors.push(`Meta ${accountId}: ${describeError(err)}`);
      }
    }
    for (let d = slice.until; d >= slice.since; d = addDaysIso(d, -1)) {
      result.days.push(d);
      if (i > 0) olderDaysPulled += 1;
    }

    // Right after the fresh days: statuses decide whether the view still
    // tells the owner to cut an ad, so they refresh every run, before any
    // backfill can use up the budget.
    if (i === 0 && !opts.shouldStop()) {
      try {
        listed = new Map();
        for (const accountId of accounts) {
          if (failed.has(accountId)) continue;
          const { ads, complete } = await getAdsMeta(token, accountId);
          for (const ad of ads) listed.set(ad.id, ad);
          if (!complete) result.warnings.push(`Meta ${accountId}: ad list capped, older ads keep their status`);
        }
      } catch (err) {
        result.warnings.push(`ad metadata: ${describeError(err)}`);
      }
    }
  }
  result.pending = Math.max(0, older.length - olderDaysPulled);

  if (seen.size || listed?.size) {
    try {
      result.creativesUpdated = await updateCreativeMeta(admin, client.id, seen, listed ?? new Map());
    } catch (err) {
      // Columns missing (0039 half-applied) or a write blip: metadata only.
      result.warnings.push(`creatives metadata: ${describeError(err)}`);
    }
  }
  return result;
}
