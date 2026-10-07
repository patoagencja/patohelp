"use server";

import { getClientBySlug } from "@/lib/dashboard/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";

import { parseSeriesRequest } from "./series";
import { buildAbSeries } from "./stats";
import type { AbSeries } from "./types";

const num = (v: unknown): number => Number(v ?? 0) || 0;

/**
 * Day-by-day numbers of up to 4 ads for the compare chart, read when the
 * panel opens instead of shipping every ad's series with the page. The page
 * binds the slug (`loadAbSeries.bind(null, slug)`); both arguments arrive
 * from the browser, so both are checked: the slug through RLS
 * (getClientBySlug), the request with zod. Shops only - like the page.
 */
export async function loadAbSeries(slug: unknown, raw: unknown): Promise<AbSeries[]> {
  if (typeof slug !== "string" || slug.length === 0 || slug.length > 64) return [];
  const req = parseSeriesRequest(raw);
  if (!req) return [];
  const client = await getClientBySlug(slug);
  if (!client || client.clientType !== "ecommerce") return [];

  // Service role after the RLS check above, filtered to that client id.
  const admin = createAdminClient();
  const rows = await fetchAll<Record<string, unknown>>((from, to) =>
    admin
      .from("ads_ad_daily")
      .select("date, ad_id, spend_minor_units, impressions, clicks, purchases, purchase_value_minor_units")
      .eq("client_id", client.id)
      .eq("provider", "meta_ads")
      .in("ad_id", req.adIds)
      .gte("date", req.start)
      .lte("date", req.end)
      .order("date", { ascending: true })
      .order("ad_id", { ascending: true })
      .range(from, to)
  );
  return buildAbSeries(
    req.adIds,
    req.start,
    req.end,
    rows.map((r) => ({
      date: String(r.date),
      adId: String(r.ad_id),
      spend: num(r.spend_minor_units),
      impressions: num(r.impressions),
      clicks: num(r.clicks),
      purchases: num(r.purchases),
      value: num(r.purchase_value_minor_units),
    }))
  );
}
