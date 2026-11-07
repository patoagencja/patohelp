import type { SupabaseClient } from "@supabase/supabase-js";

import { syncCached } from "@/lib/dashboard/sync-cache";
import { budgetForView } from "@/lib/season/budget-view";
import type { SeasonBudget } from "@/lib/season/budget";
import { seasonState } from "@/lib/season/config";
import { getClientSeason, getClientSeasonBudget, loadSeasonView, shopPushStamp } from "@/lib/season/load";
import { getShopSales } from "@/lib/shop/sales";
import { createAdminClient } from "@/lib/supabase/admin";

import { topBy, type ShopDay } from "./brief";

// Reads behind "Dziś" that no other page already caches. Everything else
// the view shows comes from the loaders the other tabs use (dashboard data,
// current alerts, creative tests, goals, the season view), so opening Dziś
// after Przegląd or Testy kreacji costs almost nothing.
//
// Service-role reads, cached per sync stamp (lib/dashboard/sync-cache):
// call ONLY with a client id resolved through RLS (getClientBySlug). The
// shop's own pushes don't move the sync stamp, so their last-push time joins
// the key (as on the Sezon page).

/**
 * The shop's own daily sales over [start, end]; null when the shop sales
 * table doesn't exist yet. Small and JSON-safe: per-day totals only.
 */
export async function loadShopDays(clientId: string, start: string, end: string): Promise<ShopDay[] | null> {
  const stamp = await shopPushStamp(clientId);
  return syncCached("today-shop-days", clientId, [start, end, stamp], async () => {
    const sales = await getShopSales(clientId, start, end);
    if (!sales.available) return null;
    return sales.days.map((d) => ({ date: d.date, revenue: d.revenue, orders: d.orders }));
  });
}

export interface BestProduct {
  name: string;
  /** Grosze. */
  revenue: number;
  /** Orders (the shop's own data) or pieces sold (GA4). */
  count: number;
  unit: "orders" | "items";
  source: "shop" | "ga4";
}

export interface BestAd {
  adId: string;
  name: string;
  campaignName: string | null;
  /** Sales Meta attributes to the ad (grosze). */
  value: number;
  purchases: number;
  /** Link clicks. */
  clicks: number;
  thumbnailUrl: string | null;
  /** Reported 3-second plays: a video. */
  video: boolean;
}

export interface BestCampaign {
  name: string;
  provider: string;
  clicks: number;
}

export interface YesterdayBest {
  date: string;
  product: BestProduct | null;
  ad: BestAd | null;
  /** Engagement fallback when no ad-level data exists: the campaign with most clicks. */
  campaign: BestCampaign | null;
}

/**
 * "Najlepiej wczoraj": the best-selling product and the ad that brought the
 * most sales on `date` (shops), or the ad / campaign with the most clicks
 * (everyone else - no sales words). Missing tables just leave a slot empty.
 */
export async function loadYesterdayBest(clientId: string, date: string, isShop: boolean): Promise<YesterdayBest> {
  const stamp = isShop ? await shopPushStamp(clientId) : null;
  return syncCached("today-best", clientId, [date, isShop, stamp], async () => {
    const admin = createAdminClient();
    const [product, ad] = await Promise.all([
      isShop ? readTopProduct(admin, clientId, date) : Promise.resolve(null),
      readTopAd(admin, clientId, date, isShop),
    ]);
    const campaign = !isShop && !ad ? await readTopCampaign(admin, clientId, date) : null;
    return { date, product, ad, campaign };
  });
}

async function readTopProduct(admin: SupabaseClient, clientId: string, date: string): Promise<BestProduct | null> {
  // The shop's own per-product rows first ('' = a day sent as one total).
  const own = await getShopSales(clientId, date, date).catch(() => null);
  const top = topBy(own?.byProduct.filter((p) => p.product !== "") ?? [], (p) => p.revenue);
  if (top) return { name: top.product, revenue: top.revenue, count: top.orders, unit: "orders", source: "shop" };

  const { data, error } = await admin
    .from("ga4_items_daily")
    .select("item_name, quantity, revenue_minor_units")
    .eq("client_id", clientId)
    .eq("date", date)
    .order("revenue_minor_units", { ascending: false })
    .limit(1);
  // A missing table (migration 0018) is just "no product data".
  if (error || !data?.length) return null;
  const r = data[0] as { item_name: string | null; quantity: number | string; revenue_minor_units: number | string };
  const revenue = Number(r.revenue_minor_units) || 0;
  if (revenue <= 0) return null;
  return {
    name: r.item_name || "(bez nazwy)",
    revenue,
    count: Math.round(Number(r.quantity) || 0),
    unit: "items",
    source: "ga4",
  };
}

async function readTopAd(
  admin: SupabaseClient,
  clientId: string,
  date: string,
  isShop: boolean
): Promise<BestAd | null> {
  const by = isShop ? "purchase_value_minor_units" : "clicks";
  const { data, error } = await admin
    .from("ads_ad_daily")
    .select("ad_id, ad_name, campaign_name, clicks, purchases, purchase_value_minor_units, video_3s_views")
    .eq("client_id", clientId)
    .eq("provider", "meta_ads")
    .eq("date", date)
    .order(by, { ascending: false })
    .limit(1);
  // No table (migration 0039) or no ad-level sync for this client.
  if (error || !data?.length) return null;
  const r = data[0] as Record<string, unknown>;
  if (!(Number(r[by]) > 0)) return null;
  const adId = String(r.ad_id);
  // Thumbnails are a nicety: a failed read keeps the tile, without the image.
  const thumb = await admin
    .from("creatives")
    .select("thumbnail_url")
    .eq("client_id", clientId)
    .eq("provider", "meta_ads")
    .eq("ad_id", adId)
    .maybeSingle();
  return {
    adId,
    name: (r.ad_name as string | null) || adId,
    campaignName: (r.campaign_name as string | null) ?? null,
    value: Number(r.purchase_value_minor_units) || 0,
    purchases: Number(r.purchases) || 0,
    clicks: Number(r.clicks) || 0,
    thumbnailUrl: thumb.error ? null : ((thumb.data?.thumbnail_url as string | null | undefined) ?? null),
    video: Number(r.video_3s_views) > 0,
  };
}

async function readTopCampaign(admin: SupabaseClient, clientId: string, date: string): Promise<BestCampaign | null> {
  const { data, error } = await admin
    .from("ads_daily")
    .select("campaign_name, campaign_id, provider, clicks")
    .eq("client_id", clientId)
    .eq("date", date)
    .order("clicks", { ascending: false })
    .limit(1);
  if (error || !data?.length) return null;
  const r = data[0] as { campaign_name: string | null; campaign_id: string; provider: string; clicks: number | string };
  const clicks = Number(r.clicks) || 0;
  if (clicks <= 0) return null;
  return { name: r.campaign_name || r.campaign_id, provider: r.provider, clicks };
}

/**
 * The season budget while the season runs (its "Dziś według planu"); null
 * for a client without a season or a budget, and outside the season - so
 * the season view (two seasons of ad rows) is only read when it is used.
 */
export async function loadSeasonBudgetToday(clientId: string, today: string): Promise<SeasonBudget | null> {
  const [season, cfg] = await Promise.all([getClientSeason(clientId), getClientSeasonBudget(clientId)]);
  if (!season || !cfg || seasonState(season, today).phase !== "in") return null;
  const view = await loadSeasonView(clientId, season, today);
  return budgetForView(view, cfg);
}
