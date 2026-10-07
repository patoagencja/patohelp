import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchAll, fetchAllByDateChunks } from "@/lib/supabase/fetch-all";

// Account-level daily ad totals (all campaigns summed per day and platform).
//
// Most of the dashboard only needs per-day sums - the budget card (month to
// date), the daily score (8 weeks), YoY (last year's window), goals, records
// (25 months), shop spend - yet each of them read every campaign row and
// summed in JS. For an OLX-size account that is ~400 rows a day: 22 000 rows
// for the score alone, ~300 000 for a cold records scan. The ads_daily_totals
// view (migration 0036) groups in Postgres and returns at most one row per
// day and platform (~100x fewer rows, one or two pages).
//
// Until 0036 has run the view doesn't exist: we fall back to the raw rows,
// summed here exactly as the callers used to, so numbers never depend on
// whether the migration ran. The miss is remembered for a while so an
// un-migrated database doesn't pay a failed request on every read.

export interface AdsDayTotal {
  date: string; // yyyy-MM-dd
  provider: string;
  spend: number; // grosze
  clicks: number;
  impressions: number;
  conversions: number;
}

const VIEW = "ads_daily_totals";
const COLUMNS = "date, provider, spend_minor_units, clicks, impressions, conversions";
const RETRY_VIEW_AFTER_MS = 10 * 60_000;
let viewMissingUntil = 0;

function viewUsable(): boolean {
  return Date.now() >= viewMissingUntil;
}

function markViewMissing(err: unknown) {
  const msg = String((err as Error)?.message ?? err);
  // Only a missing relation is remembered; anything else (timeout, network)
  // just falls back this once.
  if (/ads_daily_totals|does not exist|schema cache|relation/i.test(msg)) {
    viewMissingUntil = Date.now() + RETRY_VIEW_AFTER_MS;
  }
}

const num = (v: unknown) => Number(v ?? 0) || 0;

function toTotal(r: Record<string, unknown>): AdsDayTotal {
  return {
    date: String(r.date).slice(0, 10),
    provider: String(r.provider),
    spend: num(r.spend_minor_units),
    clicks: num(r.clicks),
    impressions: num(r.impressions),
    conversions: num(r.conversions),
  };
}

/**
 * Per-day, per-platform ad totals for one client in [start, end]. A day with
 * no ads_daily rows is absent (a sync gap stays distinguishable from a real
 * zero), exactly as when the callers summed raw rows. `db` decides the
 * access path: the cookie client reads through RLS (the view is
 * security_invoker), the service-role client only after the caller has
 * verified access to `clientId`.
 */
export async function getAdsDayTotals(
  db: SupabaseClient,
  clientId: string,
  start: string,
  end: string
): Promise<AdsDayTotal[]> {
  if (start > end) return [];
  if (viewUsable()) {
    try {
      const rows = await fetchAll<Record<string, unknown>>((from, to) =>
        db
          .from(VIEW)
          .select(COLUMNS)
          .eq("client_id", clientId)
          .gte("date", start)
          .lte("date", end)
          // (date, provider) is the view's key per client: a total order.
          .order("date", { ascending: true })
          .order("provider", { ascending: true })
          .range(from, to)
      );
      return rows.map(toTotal);
    } catch (err) {
      markViewMissing(err);
    }
  }

  const raw = await fetchAllByDateChunks<Record<string, unknown>>(start, end, 31, (s, e) =>
    (from, to) =>
      db
        .from("ads_daily")
        .select(COLUMNS)
        .eq("client_id", clientId)
        .gte("date", s)
        .lte("date", e)
        .order("date", { ascending: true })
        .order("provider", { ascending: true })
        .order("campaign_id", { ascending: true })
        .range(from, to)
  );
  const byKey = new Map<string, AdsDayTotal>();
  const out: AdsDayTotal[] = [];
  for (const r of raw) {
    const t = toTotal(r);
    const key = `${t.date}|${t.provider}`;
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, t);
      out.push(t);
      continue;
    }
    cur.spend += t.spend;
    cur.clicks += t.clicks;
    cur.impressions += t.impressions;
    cur.conversions += t.conversions;
  }
  return out;
}

/** Sum of a client's ad spend (grosze) in [start, end]. */
export async function getAdsSpendTotal(
  db: SupabaseClient,
  clientId: string,
  start: string,
  end: string
): Promise<number> {
  const rows = await getAdsDayTotals(db, clientId, start, end);
  return rows.reduce((sum, r) => sum + r.spend, 0);
}

/**
 * Ad spend per client on one day, across every client `db` can see (the
 * agency picker: service-role client, agency user verified by the caller).
 */
export async function getSpendByClientOnDate(
  db: SupabaseClient,
  date: string
): Promise<Map<string, number>> {
  type Row = { client_id: string; spend_minor_units: number | string | null };
  let rows: Row[] | null = null;
  if (viewUsable()) {
    try {
      rows = await fetchAll<Row>((from, to) =>
        db
          .from(VIEW)
          .select("client_id, spend_minor_units")
          .eq("date", date)
          .order("client_id", { ascending: true })
          .order("provider", { ascending: true })
          .range(from, to)
      );
    } catch (err) {
      markViewMissing(err);
    }
  }
  if (!rows) {
    rows = await fetchAll<Row>((from, to) =>
      db
        .from("ads_daily")
        .select("client_id, spend_minor_units")
        .eq("date", date)
        // A total order: client_id alone let 1000-row pages repeat or skip
        // rows of the same client, skewing its sum.
        .order("client_id", { ascending: true })
        .order("provider", { ascending: true })
        .order("campaign_id", { ascending: true })
        .range(from, to)
    );
  }
  const out = new Map<string, number>();
  for (const r of rows) {
    out.set(r.client_id, (out.get(r.client_id) ?? 0) + num(r.spend_minor_units));
  }
  return out;
}
