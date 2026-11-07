import type { SupabaseClient } from "@supabase/supabase-js";

import { addDaysIso, streakWindowStart, type DayTotals } from "@/lib/alerts/streaks";
import { parseSeason, seasonState } from "@/lib/season/config";
import { isMissingTableError } from "@/lib/shop/parse";
import { fetchAll, fetchAllByDateChunks } from "@/lib/supabase/fetch-all";

// The reads behind the streak alerts that the anomaly scan doesn't already
// have: who the client is (shop? seasonal?) and, for shops, purchases from
// ads plus the shop's orders and sales. Ad spend/clicks/impressions and GA4
// sessions per day come from detectAnomalies' own (shared) rows. The maths
// is in lib/alerts/streaks.ts (pure).

export interface StreakSources {
  /** client_type 'ecommerce': judged on sales metrics, may read sales words. */
  shop: boolean;
  /**
   * A seasonal client outside its season: quiet on purpose (the shop closed
   * its Christmas window), so a "drop" is the plan, not a problem.
   */
  offSeason: boolean;
  /** Shop-only fields per day: purchases (ads), orders, sales. */
  days: Record<string, DayTotals>;
}

async function readProfile(
  db: SupabaseClient,
  clientId: string,
  today: string
): Promise<{ shop: boolean; offSeason: boolean }> {
  // season arrives with 0037, client_type with 0016: step back to narrower
  // selects on an older database instead of failing.
  for (const columns of ["client_type, season", "client_type"]) {
    const { data, error } = await db.from("clients").select(columns).eq("id", clientId).maybeSingle();
    if (error) continue;
    const row = (data ?? {}) as { client_type?: string | null; season?: unknown };
    const season = parseSeason(row.season);
    return {
      shop: row.client_type === "ecommerce",
      offSeason: season !== null && seasonState(season, today).phase !== "in",
    };
  }
  return { shop: false, offSeason: false };
}

/**
 * Purchases from ads per day. A day counts only when EVERY row of it carries
 * the purchase count: rows synced before the client became a shop lack the
 * key, and summing the rest would make those days look like a slump.
 */
async function readAdPurchases(
  db: SupabaseClient,
  clientId: string,
  start: string,
  end: string
): Promise<Map<string, number>> {
  const rows = await fetchAllByDateChunks<{ date: string; purchases: unknown }>(start, end, 7, (s, e) => (from, to) =>
    db
      .from("ads_daily")
      .select("date, purchases:raw_data->purchases")
      .eq("client_id", clientId)
      .gte("date", s)
      .lte("date", e)
      .order("date", { ascending: true })
      .order("provider", { ascending: true })
      .order("campaign_id", { ascending: true })
      .range(from, to)
  );
  const days = new Map<string, { rows: number; known: number; sum: number }>();
  for (const r of rows) {
    const d = days.get(r.date) ?? { rows: 0, known: 0, sum: 0 };
    d.rows += 1;
    const n = Number(r.purchases);
    if (r.purchases !== null && r.purchases !== undefined && Number.isFinite(n)) {
      d.known += 1;
      d.sum += n;
    }
    days.set(r.date, d);
  }
  const out = new Map<string, number>();
  for (const [date, d] of days) if (d.rows > 0 && d.known === d.rows) out.set(date, d.sum);
  return out;
}

/**
 * Orders and sales per day: the shop's own numbers (shop_sales_daily) when
 * it sends them, else GA4 e-commerce. Never mixed - the two count orders
 * differently, so a switch mid-window would read as a jump. A date without
 * rows is "not reported", not zero.
 */
async function readShopSales(
  db: SupabaseClient,
  clientId: string,
  start: string,
  end: string
): Promise<Map<string, { orders: number; sales: number }>> {
  const out = new Map<string, { orders: number; sales: number }>();
  const add = (date: string, orders: unknown, sales: unknown) => {
    const d = out.get(date) ?? { orders: 0, sales: 0 };
    d.orders += Number(orders ?? 0) || 0;
    d.sales += Number(sales ?? 0) || 0;
    out.set(date, d);
  };

  // Probe first: fetchAll drops the error code that tells "migration 0038
  // not run" apart from a real failure.
  const probe = await db
    .from("shop_sales_daily")
    .select("date")
    .eq("client_id", clientId)
    .gte("date", start)
    .lte("date", end)
    .limit(1);
  if (!probe.error && probe.data?.length) {
    const rows = await fetchAllByDateChunks<{ date: string; orders: unknown; revenue_minor_units: unknown }>(
      start,
      end,
      31,
      (s, e) => (from, to) =>
        db
          .from("shop_sales_daily")
          .select("date, orders, revenue_minor_units")
          .eq("client_id", clientId)
          .gte("date", s)
          .lte("date", e)
          .order("date")
          .order("market")
          .order("product")
          .range(from, to)
    );
    for (const r of rows) add(r.date, r.orders, r.revenue_minor_units);
    return out;
  }
  if (probe.error && !isMissingTableError(probe.error)) {
    console.warn(`[alerts/streaks] shop sales read failed for ${clientId}`, probe.error.message);
  }

  // GA4 e-commerce. Revenue columns missing (pre-0016) -> no orders at all.
  try {
    const rows = await fetchAll<{ date: string; transactions: unknown; revenue_minor_units: unknown }>((from, to) =>
      db
        .from("ga4_daily")
        .select("date, transactions, revenue_minor_units")
        .eq("client_id", clientId)
        .is("source_medium", null)
        .is("device_category", null)
        .is("page_path", null)
        .gte("date", start)
        .lte("date", end)
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    );
    for (const r of rows) add(r.date, r.transactions, r.revenue_minor_units);
  } catch {
    // best effort: the metrics then simply have no data
  }
  return out;
}

/** Everything the streak detection needs beyond the anomaly scan's rows. */
export async function readStreakSources(
  db: SupabaseClient,
  clientId: string,
  today: string
): Promise<StreakSources> {
  const profile = await readProfile(db, clientId, today);
  const days: Record<string, DayTotals> = {};
  if (!profile.shop || profile.offSeason) return { ...profile, days };

  const start = streakWindowStart(today);
  const end = addDaysIso(today, -1);
  const [purchases, sales] = await Promise.all([
    readAdPurchases(db, clientId, start, end).catch(() => new Map<string, number>()),
    readShopSales(db, clientId, start, end),
  ]);
  for (const [date, n] of purchases) (days[date] ??= {}).purchases = n;
  for (const [date, s] of sales) {
    const d = (days[date] ??= {});
    d.orders = s.orders;
    d.sales = s.sales;
  }
  return { ...profile, days };
}
