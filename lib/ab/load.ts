import { formatInTimeZone } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";

import { syncCached } from "@/lib/dashboard/sync-cache";
import { seasonState, type SeasonConfig } from "@/lib/season/config";
import { getClientSeason } from "@/lib/season/load";
import { marketOf } from "@/lib/season/markets";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll, fetchAllByDateChunks } from "@/lib/supabase/fetch-all";

import {
  addDaysIso,
  computeAbView,
  emptyAbView,
  FATIGUE_LOOKBACK_DAYS,
  fixedWindow,
  type AbAdMeta,
  type AbRow,
} from "./stats";
import type { AbView, AbWindowKey } from "./types";

export interface AbWindow {
  /** The window actually used ("season" falls back to "30d" for non-seasonal clients). */
  key: AbWindowKey;
  start: string;
  end: string;
}

/**
 * Window days, Warsaw calendar. Fixed windows end today (included).
 * "season" = the running season so far, or the last finished season in full
 * when outside it; without a season config it is the 30-day window.
 */
export function resolveAbWindow(
  key: AbWindowKey,
  today: string,
  season: SeasonConfig | null
): AbWindow {
  if (key === "season") {
    if (!season) return { key: "30d", ...fixedWindow("30d", today) };
    const state = seasonState(season, today);
    const cur = state.current;
    return { key, start: cur.start, end: state.phase === "in" ? today : cur.end };
  }
  return { key, ...fixedWindow(key, today) };
}

export interface AbData {
  rows: AbRow[];
  meta: Record<string, AbAdMeta>;
  updatedAt: string | null;
}

const n = (v: unknown): number => Number(v ?? 0) || 0;
const nOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

/**
 * ads_ad_daily rows for the window (plus the fatigue look-back before today
 * when the window is shorter) and creatives metadata. null = migration 0039
 * missing or nothing synced for this client yet. Service-role reads: call
 * only for a client the viewer was verified to see, or from a cron.
 */
export async function readAbData(
  admin: SupabaseClient,
  clientId: string,
  win: AbWindow,
  today: string
): Promise<AbData | null> {
  // Newest stamp: today's rows are rewritten every sync, so the newest date
  // holds it - read through the (client_id, date) index, no full sort.
  const head = await admin
    .from("ads_ad_daily")
    .select("updated_at")
    .eq("client_id", clientId)
    .eq("provider", "meta_ads")
    .order("date", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1);
  if (head.error || !head.data?.length) return null;
  const updatedAt = (head.data[0].updated_at as string | null) ?? null;

  // Fatigue compares the last 3 finished days with the 7 before them, so a
  // live window shorter than that still reads them; a finished season's
  // window is only read as is (fatigue speaks about now).
  const lookback = addDaysIso(today, -FATIGUE_LOOKBACK_DAYS);
  const from = win.end >= today && lookback < win.start ? lookback : win.start;

  const [raw, meta] = await Promise.all([
    fetchAllByDateChunks<Record<string, unknown>>(from, win.end, 7, (s, e) => (lo, hi) =>
      admin
        .from("ads_ad_daily")
        .select(
          "date, ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name, spend_minor_units, impressions, clicks, reach, frequency, purchases, purchase_value_minor_units, video_3s_views"
        )
        .eq("client_id", clientId)
        .eq("provider", "meta_ads")
        .gte("date", s)
        .lte("date", e)
        .order("date", { ascending: true })
        .order("ad_id", { ascending: true })
        .range(lo, hi)
    ),
    readCreativeMeta(admin, clientId),
  ]);

  const rows: AbRow[] = raw.map((r) => ({
    date: String(r.date),
    adId: String(r.ad_id),
    adName: (r.ad_name as string | null) ?? null,
    adsetId: (r.adset_id as string | null) ?? null,
    adsetName: (r.adset_name as string | null) ?? null,
    campaignId: (r.campaign_id as string | null) ?? null,
    campaignName: (r.campaign_name as string | null) ?? null,
    spend: n(r.spend_minor_units),
    impressions: n(r.impressions),
    clicks: n(r.clicks),
    reach: nOrNull(r.reach),
    frequency: nOrNull(r.frequency),
    purchases: n(r.purchases),
    value: n(r.purchase_value_minor_units),
    video3s: nOrNull(r.video_3s_views),
  }));
  return { rows, meta, updatedAt };
}

/** Thumbnail, status and creation time per ad (status columns from 0039). */
async function readCreativeMeta(
  admin: SupabaseClient,
  clientId: string
): Promise<Record<string, AbAdMeta>> {
  let rows: Array<Record<string, unknown>>;
  try {
    rows = await fetchAll<Record<string, unknown>>((from, to) =>
      admin
        .from("creatives")
        .select("ad_id, thumbnail_url, effective_status, created_time")
        .eq("client_id", clientId)
        .eq("provider", "meta_ads")
        .order("ad_id", { ascending: true })
        .range(from, to)
    );
  } catch {
    // Thumbnails are a nicety: without the status columns (or creatives at
    // all) the view still works.
    rows = await fetchAll<Record<string, unknown>>((from, to) =>
      admin
        .from("creatives")
        .select("ad_id, thumbnail_url")
        .eq("client_id", clientId)
        .eq("provider", "meta_ads")
        .order("ad_id", { ascending: true })
        .range(from, to)
    ).catch(() => []);
  }
  const out: Record<string, AbAdMeta> = {};
  for (const r of rows) {
    out[String(r.ad_id)] = {
      thumbnailUrl: (r.thumbnail_url as string | null) || null,
      status: (r.effective_status as string | null) ?? null,
      createdTime: (r.created_time as string | null) ?? null,
    };
  }
  return out;
}

const todayWarsaw = () => formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");

/**
 * The creative test view ("Testy kreacji") for one window. Call only with a
 * client id the viewer was verified to see (getClientBySlug): reads with the
 * service role, cached per sync stamp like the rest of the dashboard.
 * `available: false` when migration 0039 is missing or nothing is synced.
 */
export async function loadAbView(
  clientId: string,
  windowKey: AbWindowKey,
  today: string = todayWarsaw()
): Promise<AbView> {
  // Read outside the cache: getClientSeason goes through the viewer's
  // session (RLS), which unstable_cache can't. The resolved dates are in
  // the key instead.
  const season = windowKey === "season" ? await getClientSeason(clientId) : null;
  const win = resolveAbWindow(windowKey, today, season);
  return syncCached("ab-view", clientId, [win.key, win.start, win.end, today], async () => {
    const data = await readAbData(createAdminClient(), clientId, win, today);
    if (!data) return emptyAbView(win.key, win.start, win.end);
    return computeAbView({
      windowKey: win.key,
      start: win.start,
      end: win.end,
      today,
      rows: data.rows,
      meta: data.meta,
      updatedAt: data.updatedAt,
      marketOf,
    });
  });
}
