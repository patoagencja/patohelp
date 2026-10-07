import { unstable_cache } from "next/cache";
import { formatInTimeZone } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";

import { clientDataTag } from "@/lib/dashboard/sync-cache";
import { getClientSeason } from "@/lib/season/load";
import { marketOf } from "@/lib/season/markets";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllByDateChunks } from "@/lib/supabase/fetch-all";
import { perfNote } from "@/lib/supabase/perf";

import {
  addDaysIso,
  computeAbView,
  emptyAbView,
  FATIGUE_LOOKBACK_DAYS,
  type AbAdMeta,
  type AbRow,
} from "./stats";
import type { AbView, AbWindowKey } from "./types";
import { resolveAbWindow, salesMomentsFor, type AbWindow } from "./window";

export { resolveAbWindow, salesMomentsFor, type AbWindow } from "./window";

export interface AbData {
  rows: AbRow[];
  meta: Record<string, AbAdMeta>;
}

const n = (v: unknown): number => Number(v ?? 0) || 0;
const nOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

/**
 * Newest ads_ad_daily write for the client (ISO), null = migration 0039
 * missing or nothing synced yet. Every sync rewrites the newest day's rows,
 * so the newest date holds it - read through the (client_id, date) index,
 * no sort over the whole history. Service role: call only for a client the
 * viewer was verified to see, or from a cron.
 */
export async function readAbStamp(admin: SupabaseClient, clientId: string): Promise<string | null> {
  const head = await admin
    .from("ads_ad_daily")
    .select("updated_at")
    .eq("client_id", clientId)
    .eq("provider", "meta_ads")
    .order("date", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1);
  if (head.error || !head.data?.length) return null;
  return (head.data[0].updated_at as string | null) ?? null;
}

/**
 * ads_ad_daily rows for the period (plus the fatigue look-back before today
 * when a live period is shorter) and creatives metadata for the ads that
 * spent in it. Check readAbStamp first: this throws when the table is
 * missing. Service-role reads: call only for a client the viewer was
 * verified to see, or from a cron.
 */
export async function readAbData(
  admin: SupabaseClient,
  clientId: string,
  win: AbWindow,
  today: string
): Promise<AbData> {
  // Fatigue compares the last 3 finished days with the 7 before them, so a
  // live period shorter than that still reads them; the preview and a
  // finished season's period are read as they are (fatigue speaks about now).
  const live = win.start < today && win.end >= addDaysIso(today, -1);
  const lookback = addDaysIso(today, -FATIGUE_LOOKBACK_DAYS);
  const from = live && lookback < win.start ? lookback : win.start;

  const raw = await fetchAllByDateChunks<Record<string, unknown>>(from, win.end, 7, (s, e) => (lo, hi) =>
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
  );

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

  // Only the ads the view shows: a shop with years of creatives would
  // otherwise pull thousands of rows for a few dozen thumbnails.
  const shown = new Set<string>();
  for (const r of rows) if (r.spend > 0 && r.date >= win.start) shown.add(r.adId);
  return { rows, meta: await readCreativeMeta(admin, clientId, Array.from(shown)) };
}

/** Ids per `.in()` call: ~20-digit Meta ids keep the URL well under limits. */
const META_BATCH = 150;

/** Thumbnail, status and creation time per ad (status columns from 0039). */
async function readCreativeMeta(
  admin: SupabaseClient,
  clientId: string,
  adIds: string[]
): Promise<Record<string, AbAdMeta>> {
  const batches: string[][] = [];
  for (let i = 0; i < adIds.length; i += META_BATCH) batches.push(adIds.slice(i, i + META_BATCH));

  const read = async (columns: string): Promise<Array<Record<string, unknown>>> => {
    const parts = await Promise.all(
      batches.map(async (ids) => {
        const { data, error } = await admin
          .from("creatives")
          .select(columns)
          .eq("client_id", clientId)
          .eq("provider", "meta_ads")
          .in("ad_id", ids);
        if (error) throw new Error(error.message);
        return (data ?? []) as unknown as Array<Record<string, unknown>>;
      })
    );
    return parts.flat();
  };

  let rows: Array<Record<string, unknown>>;
  try {
    rows = await read("ad_id, thumbnail_url, effective_status, created_time");
  } catch {
    // Thumbnails are a nicety: without the status columns (or creatives at
    // all) the view still works.
    rows = await read("ad_id, thumbnail_url").catch(() => []);
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

// Bump when the cached AbView shape or the verdict rules change.
const CACHE_VERSION = "ab-v2";
const CACHE_TTL_SECONDS = 15 * 60;

/**
 * The creative test view ("Testy kreacji") for one period. Call only with a
 * client id the viewer was verified to see (getClientBySlug): reads with the
 * service role. `available: false` when migration 0039 is missing or
 * nothing is synced.
 *
 * Cached per newest ad-level write (readAbStamp), not the dashboard's
 * generic sync stamp: Google or GA4 syncs every few minutes must not throw
 * the view away, and an ad-level sync must always refresh it.
 */
export async function loadAbView(
  clientId: string,
  windowKey: AbWindowKey,
  today: string = todayWarsaw()
): Promise<AbView> {
  const admin = createAdminClient();
  // Outside the cache: the season goes through the viewer's session (RLS),
  // which unstable_cache can't, and the stamp IS the key.
  const [season, stamp] = await Promise.all([
    getClientSeason(clientId),
    readAbStamp(admin, clientId).catch(() => null),
  ]);
  const win = resolveAbWindow(windowKey, today, season);
  if (!stamp) return emptyAbView(win.key, win.start, win.end, today);

  const load = async (): Promise<AbView> => {
    const data = await readAbData(admin, clientId, win, today);
    return computeAbView({
      windowKey: win.key,
      start: win.start,
      end: win.end,
      today,
      rows: data.rows,
      meta: data.meta,
      updatedAt: stamp,
      marketOf,
      moments: salesMomentsFor(season, today),
    });
  };

  let computed = false;
  const cached = unstable_cache(
    async () => {
      computed = true;
      return load();
    },
    [
      CACHE_VERSION,
      clientId,
      stamp,
      win.key,
      win.start,
      win.end,
      today,
      // The season (agency-edited) decides the sales moments.
      season ? `${season.start}/${season.end}` : "-",
    ],
    { revalidate: CACHE_TTL_SECONDS, tags: [clientDataTag(clientId)] }
  );
  try {
    const out = await cached();
    perfNote(`ab-view ${computed ? "MISS" : "hit"}`);
    return out;
  } catch (err) {
    // Outside a Next request (scripts) there is no incremental cache.
    if (!computed && /incrementalCache missing/i.test(String((err as Error)?.message))) return load();
    throw err;
  }
}
