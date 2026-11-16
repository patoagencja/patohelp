import { randomInt } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getAdsDayTotals } from "@/lib/dashboard/ads-totals";
import {
  addDaysIso,
  buildDemoProfile,
  LAST_YEAR_AHEAD_DAYS,
  PROFILE_DAYS,
  SHARE_WINDOW_DAYS,
  YOY_SHIFT_DAYS,
  type DemoProfile,
  type RawSource,
} from "@/lib/demo/profile/anonymize";
import { channelOf } from "@/lib/ecom/channel";
import { marketOf } from "@/lib/season/markets";
import { fetchAll, fetchAllByDateChunks } from "@/lib/supabase/fetch-all";

// Reads one client's rows for the demo profile and hands them straight to
// the anonymizer. The raw rows (campaign names, products, paths...) live only
// inside this call; what comes out is the numeric profile. Service-role
// reads: call ONLY with a client id an agency admin was verified to see.

/** Uniform [0, 1) from node:crypto - the factors must not be guessable. */
const cryptoRandom = () => randomInt(0, 2 ** 40) / 2 ** 40;

type Row = Record<string, unknown>;

/** The rows of `table` in [start, end] (date-chunked); [] when the table is missing. */
async function readWindow(
  admin: SupabaseClient,
  table: string,
  columns: string,
  clientId: string,
  start: string,
  end: string,
  /** GA4 daily totals only (no source / device / page dimension). */
  totalsOnly = false
): Promise<Row[]> {
  try {
    return await fetchAllByDateChunks<Row>(start, end, 14, (s, e) => (from, to) => {
      let q = admin.from(table).select(columns as "*").eq("client_id", clientId).gte("date", s).lte("date", e);
      if (totalsOnly) q = q.is("source_medium", null).is("device_category", null).is("page_path", null);
      return q.order("date", { ascending: true }).order("id", { ascending: true }).range(from, to);
    });
  } catch {
    return [];
  }
}

/** The latest GA4 snapshot rows of one dimension (each covers the 30 days before its sync). */
async function latestSnapshot(admin: SupabaseClient, clientId: string, column: string, upTo: string): Promise<Row[]> {
  const { data: latest } = await admin
    .from("ga4_daily")
    .select("date")
    .eq("client_id", clientId)
    .not(column, "is", null)
    .lte("date", addDaysIso(upTo, 1))
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const date = latest?.date as string | undefined;
  if (!date) return [];
  try {
    return await fetchAll<Row>((from, to) =>
      admin
        .from("ga4_daily")
        .select(`${column}, sessions, page_views, engagement_rate, revenue_minor_units, transactions` as "*")
        .eq("client_id", clientId)
        .eq("date", date)
        .not(column, "is", null)
        .order("id", { ascending: true })
        .range(from, to)
    );
  } catch {
    return [];
  }
}

const n = (v: unknown) => Number(v ?? 0) || 0;
const orNull = (v: unknown) => (v == null ? null : Number(v));

/**
 * The anonymized profile of `clientId` for the weeks up to `snapshotDate`
 * (the last full day). Throws when the client has too little to show.
 */
export async function collectDemoProfile(admin: SupabaseClient, clientId: string, snapshotDate: string): Promise<DemoProfile> {
  const start = addDaysIso(snapshotDate, -(PROFILE_DAYS - 1));
  const lyStart = addDaysIso(start, -YOY_SHIFT_DAYS);
  const lyEnd = addDaysIso(snapshotDate, -YOY_SHIFT_DAYS + LAST_YEAR_AHEAD_DAYS);
  const shareStart = addDaysIso(snapshotDate, -(SHARE_WINDOW_DAYS - 1));
  const GA4 = "date, sessions, users_new, users_returning, engagement_rate, revenue_minor_units, transactions";
  const SHOP = "date, market, product, orders, revenue_minor_units";

  const [ads, adsLastYear, ga4Now, ga4Ly, sources, devices, pages, items, shopNow, shopLy] = await Promise.all([
    readWindow(admin, "ads_daily", "id, provider, campaign_id, campaign_name, date, spend_minor_units, clicks, impressions, conversions", clientId, start, snapshotDate),
    getAdsDayTotals(admin, clientId, lyStart, lyEnd).catch(() => []),
    readWindow(admin, "ga4_daily", `id, ${GA4}`, clientId, start, snapshotDate, true),
    readWindow(admin, "ga4_daily", `id, ${GA4}`, clientId, lyStart, lyEnd, true),
    latestSnapshot(admin, clientId, "source_medium", snapshotDate),
    latestSnapshot(admin, clientId, "device_category", snapshotDate),
    latestSnapshot(admin, clientId, "page_path", snapshotDate),
    readWindow(admin, "ga4_items_daily", "id, date, item_id, item_name, quantity, revenue_minor_units", clientId, shareStart, snapshotDate),
    // shop_sales_daily has no id column: its key (date, market, product) orders it.
    readShop(admin, clientId, start, snapshotDate, SHOP),
    readShop(admin, clientId, lyStart, lyEnd, SHOP),
  ]);

  if (ads.length === 0) throw new Error("no ads");

  const raw: RawSource = {
    snapshotDate,
    createdAt: new Date().toISOString(),
    ads: ads.map((r) => ({
      provider: String(r.provider ?? ""),
      campaignId: String(r.campaign_id ?? ""),
      campaignName: (r.campaign_name as string | null) ?? null,
      date: String(r.date),
      spend: n(r.spend_minor_units),
      clicks: n(r.clicks),
      impressions: n(r.impressions),
      conversions: orNull(r.conversions),
    })),
    adsLastYear: adsLastYear.map((r) => ({ ...r, conversions: r.conversions })),
    ga4Days: [...ga4Ly, ...ga4Now].map((r) => ({
      date: String(r.date),
      sessions: n(r.sessions),
      usersNew: orNull(r.users_new),
      usersReturning: orNull(r.users_returning),
      engagementRate: orNull(r.engagement_rate),
      revenue: orNull(r.revenue_minor_units),
      transactions: orNull(r.transactions),
    })),
    ga4Sources: sources.map((r) => ({
      sourceMedium: String(r.source_medium ?? ""),
      sessions: n(r.sessions),
      revenue: orNull(r.revenue_minor_units),
      transactions: orNull(r.transactions),
    })),
    ga4Devices: devices.map((r) => ({ device: String(r.device_category ?? ""), sessions: n(r.sessions) })),
    ga4Pages: pages.map((r) => ({ path: String(r.page_path ?? ""), views: n(r.page_views), engagementRate: orNull(r.engagement_rate) })),
    items: items.map((r) => ({
      itemId: String(r.item_id ?? ""),
      itemName: String(r.item_name ?? ""),
      quantity: n(r.quantity),
      revenue: n(r.revenue_minor_units),
    })),
    shopSales: [...shopLy, ...shopNow].map((r) => ({
      date: String(r.date),
      market: String(r.market ?? ""),
      product: String(r.product ?? ""),
      orders: n(r.orders),
      revenue: n(r.revenue_minor_units),
    })),
  };
  return buildDemoProfile(raw, { marketOf, channelOf, random: cryptoRandom });
}

async function readShop(admin: SupabaseClient, clientId: string, start: string, end: string, columns: string): Promise<Row[]> {
  try {
    return await fetchAllByDateChunks<Row>(start, end, 31, (s, e) => (from, to) =>
      admin
        .from("shop_sales_daily")
        .select(columns as "*")
        .eq("client_id", clientId)
        .gte("date", s)
        .lte("date", e)
        .order("date")
        .order("market")
        .order("product")
        .range(from, to)
    );
  } catch {
    return [];
  }
}
