import { formatInTimeZone } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";

import { AccountErrors } from "@/lib/integrations/ads-daily-history";
import { decrypt } from "@/lib/integrations/encryption";
import { describeError } from "@/lib/integrations/errors";
import { normalizeCurrency, type FxConverter } from "@/lib/integrations/fx";
import {
  describeThrottle,
  getActiveDays,
  getAdDailyInsights,
  getAdsMeta,
  MetaThrottledError,
  type MetaAdDailyInsight,
  type MetaAdMeta,
} from "@/lib/integrations/meta-ads";
import {
  cachedActiveDays,
  readSyncState,
  rememberActiveDays,
  writeSyncState,
  type ActiveDayCache,
} from "@/lib/integrations/sync-state";
import { addDaysIso, seasonState, type SeasonConfig } from "@/lib/season/config";
import { fetchAll } from "@/lib/supabase/fetch-all";

import type { AbClient } from "./eligibility";

/**
 * Meta ad x day rows with purchases into ads_ad_daily (migration 0039), for
 * the creative test view. Called by /api/cron/refresh-ads-meta-ads every ~30
 * minutes - an owner spending tens of thousands a day must see a losing ad
 * within hours, not on the 6-hourly creatives snapshot.
 *
 * Per run and client, per selected ad account - up to 3 accounts side by
 * side, as Meta's limits are per account:
 * 1. today + yesterday (the fresh slice);
 * 2. statuses: the ad listing until every known ad of the account was seen;
 * 3. D-7..D-2 again once a day (this account's newest row older than 20h):
 *    purchases keep landing on past days for the whole attribution window;
 * 4. days this account is missing back to max(35 days, the current / last
 *    season window), newest first, while the budget allows - the next run
 *    resumes. Tracked per account: one failed account no longer makes a
 *    day look done for the others.
 * Mode "fresh" (the dashboard's "Odśwież") does 1 and 2 only, so it answers
 * in seconds instead of starting a backfill.
 *
 * Money is stored in PLN grosze; an account billed in another currency is
 * converted at the NBP rate of each day (lib/integrations/fx), keeping its
 * own currency and amounts in raw_data. A day without a rate is skipped for
 * that account, never written unconverted.
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
/** Accounts synced side by side for one client. */
const ACCOUNT_CONCURRENCY = 3;
/** Ad listing pages read in fresh mode (statuses only need the newest ads). */
const FRESH_LIST_PAGES = 2;
/** sync_runs.provider of this job (free text column, no CHECK). */
export const AD_DAILY_SYNC_PROVIDER = "meta_ads_ads";
const STATE_KEY = "meta_ads_ads";

export interface AdDailySyncResult {
  /** Selected Meta accounts of the client. */
  accounts: number;
  written: number;
  /** Days requested this run (from at least one account), newest first. */
  days: string[];
  /** Account-days still to fetch (next run continues). */
  pending: number;
  creativesUpdated: number;
  /** Ads marked ARCHIVED (gone from a complete ad listing). */
  archived: number;
  /** Per-account failures, one entry per account (they decide sync_runs status). */
  errors: string[];
  /** Best-effort parts that failed (metadata, day bookkeeping). */
  warnings: string[];
}

/**
 * Shared by every client of one cron run. A slice may start only if it is
 * expected to end before its deadline: now + 1.5 x the slowest slice so far.
 * History slices stop earlier than fresh ones, so one client's backfill
 * can't leave the clients after it without today's numbers - and nothing
 * starts close enough to maxDuration to be killed mid-write.
 */
export interface AdSyncBudget {
  /** Epoch ms for history slices (and day probes). */
  historyDeadline: number;
  /** Epoch ms for fresh slices and status listings. */
  hardDeadline: number;
  /** Slowest slice of this run so far, ms. */
  slowestMs: number;
}

export function createAdSyncBudget(startedAt: number, historyMs: number, hardMs: number): AdSyncBudget {
  return { historyDeadline: startedAt + historyMs, hardDeadline: startedAt + hardMs, slowestMs: 0 };
}

export function budgetAllows(budget: AdSyncBudget, kind: "fresh" | "history", now = Date.now()): boolean {
  const deadline = kind === "fresh" ? budget.hardDeadline : budget.historyDeadline;
  return now + 1.5 * budget.slowestMs <= deadline;
}

export interface AdDailySyncOptions {
  budget: AdSyncBudget;
  /** One per cron run (rates are cached per run). */
  fx: FxConverter;
  mode?: "full" | "fresh";
  now?: Date;
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

const PAGE = 1000;

/**
 * account -> day -> newest updated_at (ms), from the 0039 helper (paged:
 * 7 accounts x a season of days passes PostgREST's 1000-row cap). null if
 * unavailable.
 */
async function storedDays(
  admin: SupabaseClient,
  clientId: string,
  since: string
): Promise<Map<string, Map<string, number>> | null> {
  const out = new Map<string, Map<string, number>>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .rpc("ads_ad_daily_days", { p_client_id: clientId, p_since: since })
      .order("account_id", { ascending: true })
      .order("day_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return null;
    const rows = (data ?? []) as Array<{ account_id: string | null; day_date: string; newest: string | null }>;
    for (const r of rows) {
      const account = String(r.account_id ?? "");
      const days = out.get(account) ?? new Map<string, number>();
      days.set(String(r.day_date), r.newest ? Date.parse(r.newest) : 0);
      out.set(account, days);
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

/** account -> ads it delivered since `since` (0039 helper); null if unavailable. */
async function knownAds(
  admin: SupabaseClient,
  clientId: string,
  since: string
): Promise<Map<string, Set<string>> | null> {
  const out = new Map<string, Set<string>>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .rpc("ads_ad_daily_account_ads", { p_client_id: clientId, p_since: since })
      .order("account_id", { ascending: true })
      .order("ad_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return null;
    const rows = (data ?? []) as Array<{ account_id: string | null; ad_id: string }>;
    for (const r of rows) {
      const account = String(r.account_id ?? "");
      const ads = out.get(account) ?? new Set<string>();
      ads.add(String(r.ad_id));
      out.set(account, ads);
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

interface SeenAd {
  adsetId: string | null;
  adsetName: string | null;
  campaignName: string | null;
}

/** A row with the PLN rate of its day (1 for PLN accounts). */
interface PricedRow {
  row: MetaAdDailyInsight;
  rate: number;
  currency: string | null;
}

async function upsertRows(
  admin: SupabaseClient,
  clientId: string,
  accountId: string,
  rows: PricedRow[],
  seen: Map<string, SeenAd>
): Promise<number> {
  const stamp = new Date().toISOString();
  // One row per (ad, day): a duplicate inside one upsert statement makes
  // Postgres reject the whole batch ("cannot affect row a second time").
  const byKey = new Map<string, Record<string, unknown>>();
  for (const { row: r, rate, currency } of rows) {
    const foreign = currency !== "PLN";
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
      spend_minor_units: Math.round(r.spend * rate * 100),
      impressions: r.impressions,
      clicks: r.link_clicks,
      clicks_all: r.clicks_all,
      reach: r.reach != null ? Math.round(r.reach) : null,
      frequency: r.frequency,
      purchases: r.purchases,
      purchase_value_minor_units: Math.round(r.purchase_value * rate * 100),
      video_3s_views: r.video_3s_views != null ? Math.round(r.video_3s_views) : null,
      // Every row names the column (null for PLN), so a batch keeps one shape.
      raw_data: foreign
        ? {
            currency,
            fx_rate: rate,
            spend_original: r.spend,
            purchase_value_original: r.purchase_value,
          }
        : null,
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
 * on the next run here. `archived`: known ads a complete listing no longer
 * has - the listing leaves archived and deleted ads out, so their stored
 * status would otherwise stay ACTIVE and the view kept saying "Wyłącz" for
 * ads that no longer run. Only changed rows are written.
 */
async function updateCreativeMeta(
  admin: SupabaseClient,
  clientId: string,
  seen: Map<string, SeenAd>,
  listed: Map<string, MetaAdMeta>,
  archived: Set<string>
): Promise<{ updated: number; archived: number }> {
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
  let archivedCount = 0;
  for (const row of existing) {
    const adId = String(row.ad_id);
    const s = seen.get(adId);
    const m = listed.get(adId);
    const gone = !m && archived.has(adId);
    if (!s && !m && !gone) continue;
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
      effective_status: gone
        ? cur.effective_status === "DELETED"
          ? "DELETED"
          : "ARCHIVED"
        : m?.effective_status ?? cur.effective_status,
      created_time: isoOrNull(m?.created_time ?? null) ?? cur.created_time,
    };
    const changed =
      next.adset_id !== cur.adset_id ||
      next.adset_name !== cur.adset_name ||
      next.campaign_name !== cur.campaign_name ||
      next.effective_status !== cur.effective_status ||
      !sameInstant(next.created_time, cur.created_time);
    if (!changed) continue;
    if (gone && next.effective_status !== cur.effective_status) archivedCount += 1;
    updates.push({ client_id: clientId, provider: "meta_ads", ad_id: adId, ...next });
  }
  for (let i = 0; i < updates.length; i += UPSERT_CHUNK) {
    // Upsert names only these columns: on the existing row it updates them
    // and leaves spend, thumbnails and diagnostics untouched.
    const { error } = await admin
      .from("creatives")
      .upsert(updates.slice(i, i + UPSERT_CHUNK), { onConflict: "client_id,provider,ad_id" });
    if (error) throw new Error(error.message);
  }
  return { updated: updates.length, archived: archivedCount };
}

interface MetaSelectedAccount {
  id: string;
  /** Saved at connect time; the insights' own account_currency wins. */
  currency: string | null;
}

interface AdSyncState {
  /** Days each account delivered on, learned once a Warsaw day. */
  active?: ActiveDayCache;
}

export async function syncAdDailyForClient(
  admin: SupabaseClient,
  client: AbClient,
  opts: AdDailySyncOptions
): Promise<AdDailySyncResult> {
  const result: AdDailySyncResult = {
    accounts: 0,
    written: 0,
    days: [],
    pending: 0,
    creativesUpdated: 0,
    archived: 0,
    errors: [],
    warnings: [],
  };
  const { budget, fx } = opts;
  const fresh = opts.mode === "fresh";
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
  const accounts: MetaSelectedAccount[] = (
    Array.isArray(storedAccounts)
      ? (storedAccounts as Array<{ id: string; selected?: boolean; currency?: string }>)
      : []
  )
    .filter((a) => a.selected === true)
    .map((a) => ({ id: a.id, currency: normalizeCurrency(a.currency) }));
  result.accounts = accounts.length;
  if (!integration || accounts.length === 0) return result;
  const { access_token: token } = JSON.parse(decrypt(integration.credentials_encrypted as string)) as {
    access_token: string;
  };

  // ---- plan: per account, which older days are missing or due for the
  // daily re-pull (fresh mode: none)
  const target = targetDays(today, client.season);
  const stored = fresh ? null : await storedDays(admin, client.id, target[0]);
  if (!fresh && !stored) {
    // Without the bookkeeping we can't tell holes from stored days: keep the
    // fresh days flowing and leave history for a run that can.
    result.warnings.push("ads_ad_daily_days() unavailable - only today and yesterday pulled");
  }
  // Ads each account delivered recently: what the status listing must see,
  // and what a complete listing without them means archived.
  const known = await knownAds(admin, client.id, addDaysIso(today, -BASE_DAYS));
  if (!known) result.warnings.push("ads_ad_daily_account_ads() unavailable - statuses from the capped listing");

  const stateRead = fresh ? null : await readSyncState<AdSyncState>(admin, client.id, STATE_KEY);
  const state: AdSyncState = { ...(stateRead?.value ?? {}) };
  let stateChanged = false;

  const refreshFrom = addDaysIso(today, -REFRESH_FROM);
  const refreshTo = addDaysIso(today, -REFRESH_TO);
  const errors = new AccountErrors();
  // A per-user (17) or app-wide (4) limit covers every account of the token.
  let tokenThrottle: MetaThrottledError | null = null;
  const onThrottle = (accountId: string, err: MetaThrottledError) => {
    errors.add(`Meta ${accountId}`, describeThrottle(err));
    if (err.scope !== "account") tokenThrottle = err;
  };

  const seen = new Map<string, SeenAd>();
  const listed = new Map<string, MetaAdMeta>();
  const archived = new Set<string>();
  const pulled = new Set<string>();

  const syncAccount = async (account: MetaSelectedAccount): Promise<void> => {
    const accountId = account.id;
    const label = `Meta ${accountId}`;
    const accStored = stored?.get(accountId) ?? new Map<string, number>();
    let missing: string[] = [];
    const refresh: string[] = [];
    if (stored) {
      for (const d of target) {
        const newest = accStored.get(d);
        if (newest == null) missing.push(d);
        else if (d >= refreshFrom && d <= refreshTo && now.getTime() - newest > REFRESH_AFTER_MS) {
          refresh.push(d);
        }
      }
    }

    // Ads this account delivered in the slices of this run.
    const accountAds = new Set<string>();

    // Fetch one slice, convert it to PLN and write it. False = stop this account.
    const runSlice = async (slice: { since: string; until: string }, kind: "fresh" | "history") => {
      if (tokenThrottle) {
        errors.add(label, describeThrottle(tokenThrottle));
        return false;
      }
      if (!budgetAllows(budget, kind)) return false;
      const t0 = Date.now();
      let rows: MetaAdDailyInsight[];
      try {
        rows = await getAdDailyInsights(token, accountId, slice.since, slice.until);
      } catch (err) {
        // One broken or throttled account must not stop the others; it
        // sits out the rest of this run (retrying only extends a block).
        if (err instanceof MetaThrottledError) onThrottle(accountId, err);
        else errors.add(label, describeError(err));
        return false;
      }
      budget.slowestMs = Math.max(budget.slowestMs, Date.now() - t0);

      const priced: PricedRow[] = [];
      const skipped = new Set<string>();
      for (const row of rows) {
        const currency = normalizeCurrency(row.currency) ?? account.currency;
        const rate = await fx.rate(currency, row.date);
        if (rate == null) {
          // Never store foreign money as złoty: the day stays missing for
          // this account and is retried on a later run.
          if (!skipped.has(row.date)) {
            skipped.add(row.date);
            errors.add(label, currency ? `brak kursu NBP ${currency} dla ${row.date}` : "nieznana waluta konta");
          }
          continue;
        }
        priced.push({ row, rate, currency });
        accountAds.add(row.ad_id);
      }
      try {
        result.written += await upsertRows(admin, client.id, accountId, priced, seen);
      } catch (err) {
        errors.add(label, describeError(err));
        return false;
      }
      for (let d = slice.until; d >= slice.since; d = addDaysIso(d, -1)) {
        if (!skipped.has(d)) pulled.add(d);
      }
      return true;
    };

    // 1. fresh days
    const freshOk = await runSlice({ since: yesterday, until: today }, "fresh");

    // 2. statuses right after the fresh days: they decide whether the view
    // still tells the owner to cut an ad, so they refresh every run, before
    // any backfill can use up the budget.
    if (freshOk && !tokenThrottle && budgetAllows(budget, "fresh")) {
      // Known ads plus any that delivered for the first time just now.
      // Unknown (helper missing): no early stop, the capped listing as before.
      const wanted = known ? new Set([...(known.get(accountId) ?? []), ...accountAds]) : undefined;
      try {
        const { ads, complete } = await getAdsMeta(token, accountId, {
          wanted,
          maxPages: fresh ? FRESH_LIST_PAGES : undefined,
        });
        const ids = new Set(ads.map((a) => a.id));
        for (const ad of ads) listed.set(ad.id, ad);
        if (complete) {
          // The listing leaves archived / deleted ads out: a wanted ad it
          // ran to the end without is gone.
          for (const adId of wanted ?? []) if (!ids.has(adId)) archived.add(adId);
        } else if (wanted && [...wanted].some((id) => !ids.has(id))) {
          result.warnings.push(`${label}: ad list capped, older ads keep their status`);
        }
      } catch (err) {
        if (err instanceof MetaThrottledError) {
          onThrottle(accountId, err);
          return;
        }
        result.warnings.push(`${label} ad metadata: ${describeError(err)}`);
      }
    }
    if (fresh || !freshOk || !stored) return;

    // 3 + 4. history. A day with no rows may simply have had no delivery
    // (before the shop started advertising, a paused week): ask Meta which
    // days this account delivered - once a Warsaw day, the answer is kept -
    // or those days get re-requested on every run forever.
    if (missing.length && !tokenThrottle && budgetAllows(budget, "history")) {
      const from = missing[0];
      const to = missing[missing.length - 1];
      let active = cachedActiveDays(state.active, today, accountId, from, to);
      if (!active) {
        try {
          active = await getActiveDays(token, accountId, from, to);
          state.active = rememberActiveDays(state.active, today, accountId, from, to, active);
          stateChanged = true;
        } catch (err) {
          if (err instanceof MetaThrottledError) {
            onThrottle(accountId, err);
            result.pending += missing.length + refresh.length;
            return;
          }
          result.warnings.push(`${label}: active-day probe failed, backfilling every missing day: ${describeError(err)}`);
        }
      }
      if (active) missing = missing.filter((d) => active.has(d));
    }

    const older = [...new Set([...refresh, ...missing])].sort().reverse();
    let done = 0;
    for (const slice of slicesOf(older)) {
      if (!(await runSlice(slice, "history"))) break;
      done += eachDayCount(slice);
    }
    result.pending += Math.max(0, older.length - done);
  };

  // Accounts 3 at a time: Meta's limits are per ad account, so seven market
  // accounts no longer wait for each other in a row.
  const queue = [...accounts];
  await Promise.all(
    Array.from({ length: Math.min(ACCOUNT_CONCURRENCY, queue.length) }, async () => {
      while (queue.length) await syncAccount(queue.shift() as MetaSelectedAccount);
    })
  );

  result.days = [...pulled].sort().reverse();
  result.errors = errors.list();
  if (stateChanged) await writeSyncState(admin, client.id, STATE_KEY, state);

  if (seen.size || listed.size || archived.size) {
    try {
      const meta = await updateCreativeMeta(admin, client.id, seen, listed, archived);
      result.creativesUpdated = meta.updated;
      result.archived = meta.archived;
    } catch (err) {
      // Columns missing (0039 half-applied) or a write blip: metadata only.
      result.warnings.push(`creatives metadata: ${describeError(err)}`);
    }
  }
  return result;
}

function eachDayCount(slice: { since: string; until: string }): number {
  return (
    Math.round(
      (Date.parse(`${slice.until}T00:00:00Z`) - Date.parse(`${slice.since}T00:00:00Z`)) / 86_400_000
    ) + 1
  );
}
