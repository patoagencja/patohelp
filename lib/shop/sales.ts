import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllByDateChunks } from "@/lib/supabase/fetch-all";

import { isMissingTableError } from "./parse";

// Read side of the shop's own sales (shop_sales_daily). Service-role reads:
// call these ONLY with a client id the viewer was already verified to see
// (requireAgencyClientAccess / getClientBySlug), never with one taken from
// the request.

export interface ShopSalesRow {
  date: string;
  /** Country code ('PL', 'DE', 'UK', ...) or '' when the shop didn't say. */
  market: string;
  /** Product name or '' for "all products". */
  product: string;
  orders: number;
  /** Gross PLN, minor units (grosze). */
  revenue: number;
  /** Placed but not yet paid (pay-later); 0 when the shop doesn't send it. */
  pendingOrders: number;
  pendingRevenue: number;
  source: "api" | "csv";
}

export interface ShopSalesTotals {
  orders: number;
  /** Gross PLN, minor units (grosze). */
  revenue: number;
}

export interface ShopSales {
  /** False until migration 0038 (ALL_RECENT_8.sql) has run. */
  available: boolean;
  /** Totals per date, ascending. Only dates that have rows - a missing date
   *  means "nothing reported", which is not the same as zero sales. */
  days: Array<{ date: string } & ShopSalesTotals>;
  /** Totals per market over the range, by revenue (highest first). */
  byMarket: Array<{ market: string } & ShopSalesTotals>;
  /** Totals per product over the range, by revenue (highest first). */
  byProduct: Array<{ product: string } & ShopSalesTotals>;
  /** Raw rows ordered by date, market, product. */
  rows: ShopSalesRow[];
}

const EMPTY: ShopSales = { available: false, days: [], byMarket: [], byProduct: [], rows: [] };

// A season of a 7-market, ~10-product shop is ~70 rows a day; month-sized
// chunks keep each paged read small enough for cheap offsets.
const CHUNK_DAYS = 31;

function sumBy(
  rows: readonly ShopSalesRow[],
  key: (r: ShopSalesRow) => string
): Map<string, ShopSalesTotals> {
  const out = new Map<string, ShopSalesTotals>();
  for (const r of rows) {
    const k = key(r);
    const t = out.get(k);
    if (t) {
      t.orders += r.orders;
      t.revenue += r.revenue;
    } else {
      out.set(k, { orders: r.orders, revenue: r.revenue });
    }
  }
  return out;
}

const byRevenueDesc = (a: ShopSalesTotals, b: ShopSalesTotals) =>
  b.revenue - a.revenue || b.orders - a.orders;

/**
 * Shop sales for [start, end] (inclusive "YYYY-MM-DD" dates), as JSON-safe
 * data (plain arrays and numbers, money in grosze). Never throws for a
 * missing table - returns available: false so a page can hide its card.
 */
export async function getShopSales(clientId: string, start: string, end: string): Promise<ShopSales> {
  const admin = createAdminClient();

  // Probe first: fetchAll turns errors into plain Errors and drops the code
  // that tells "migration not run" apart from a real failure.
  const probe = await admin.from("shop_sales_daily").select("date").eq("client_id", clientId).limit(1);
  if (probe.error) {
    if (isMissingTableError(probe.error)) return EMPTY;
    throw new Error(`shop_sales_daily read failed: ${probe.error.message}`);
  }
  if (!probe.data?.length) return { ...EMPTY, available: true };

  const raw = await fetchAllByDateChunks<{
    date: string;
    market: string;
    product: string;
    orders: number;
    revenue_minor_units: number | string;
    pending_orders?: number | null;
    pending_revenue_minor_units?: number | string | null;
    source: string;
  }>(start, end, CHUNK_DAYS, (chunkStart, chunkEnd) => (from, to) =>
    admin
      .from("shop_sales_daily")
      // "*": the pending (pay-later) columns came in a later revision of
      // 0038; a database migrated before that still reads fine.
      .select("*")
      .eq("client_id", clientId)
      .gte("date", chunkStart)
      .lte("date", chunkEnd)
      .order("date")
      .order("market")
      .order("product")
      .range(from, to)
  );

  const rows: ShopSalesRow[] = raw.map((r) => ({
    date: r.date,
    market: r.market ?? "",
    product: r.product ?? "",
    orders: Number(r.orders) || 0,
    revenue: Number(r.revenue_minor_units) || 0,
    pendingOrders: Number(r.pending_orders) || 0,
    pendingRevenue: Number(r.pending_revenue_minor_units) || 0,
    source: r.source === "csv" ? "csv" : "api",
  }));

  // Rows arrive date-ordered, so the per-day map keeps date order.
  const days = Array.from(sumBy(rows, (r) => r.date), ([date, t]) => ({ date, ...t }));
  const byMarket = Array.from(sumBy(rows, (r) => r.market), ([market, t]) => ({ market, ...t })).sort(
    byRevenueDesc
  );
  const byProduct = Array.from(sumBy(rows, (r) => r.product), ([product, t]) => ({ product, ...t })).sort(
    byRevenueDesc
  );

  return { available: true, days, byMarket, byProduct, rows };
}

export interface ShopSalesCoverage {
  /** False until migration 0038 (ALL_RECENT_8.sql) has run. */
  available: boolean;
  /** Earliest / latest date with any row; null when there is no data. */
  minDate: string | null;
  maxDate: string | null;
  /** Last successful API push (UTC ISO), null if the shop never pushed. */
  lastUsedAt: string | null;
  /** Rows written by that push. */
  lastRows: number | null;
}

/** What date range the shop's data covers and when the API last delivered. */
export async function getShopSalesCoverage(clientId: string): Promise<ShopSalesCoverage> {
  const admin = createAdminClient();
  const edge = (ascending: boolean) =>
    admin
      .from("shop_sales_daily")
      .select("date")
      .eq("client_id", clientId)
      .order("date", { ascending })
      .limit(1)
      .maybeSingle();

  const [first, last, key] = await Promise.all([
    edge(true),
    edge(false),
    admin
      .from("shop_ingest_keys")
      .select("last_used_at, last_rows")
      .eq("client_id", clientId)
      .maybeSingle(),
  ]);

  const error = first.error ?? last.error ?? key.error;
  if (error) {
    if (isMissingTableError(error)) {
      return { available: false, minDate: null, maxDate: null, lastUsedAt: null, lastRows: null };
    }
    throw new Error(`shop sales coverage read failed: ${error.message}`);
  }

  return {
    available: true,
    minDate: (first.data?.date as string | undefined) ?? null,
    maxDate: (last.data?.date as string | undefined) ?? null,
    lastUsedAt: (key.data?.last_used_at as string | null | undefined) ?? null,
    lastRows: (key.data?.last_rows as number | null | undefined) ?? null,
  };
}
