import { cache } from "react";
import { formatInTimeZone } from "date-fns-tz";

import { syncCached } from "@/lib/dashboard/sync-cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllByDateChunks } from "@/lib/supabase/fetch-all";
import { createClient } from "@/lib/supabase/server";
import { getShopSales } from "@/lib/shop/sales";

import {
  addDaysIso,
  diffDaysIso,
  parseSeason,
  seasonLength,
  seasonMoments,
  seasonState,
  type SeasonConfig,
  type SeasonMoment,
  type SeasonState,
  type SeasonWindow,
} from "./config";
import { marketOf } from "./markets";
import { computeSeasonShop, type SeasonShop, type SeasonShopRow } from "./shop";

/**
 * The client's season window, as the viewer may see it (RLS). null = not a
 * seasonal client, or migration 0037 not applied yet.
 */
export const getClientSeason = cache(async (clientId: string): Promise<SeasonConfig | null> => {
  const { data, error } = await createClient()
    .from("clients")
    .select("season")
    .eq("id", clientId)
    .maybeSingle();
  if (error || !data) return null;
  return parseSeason((data as { season?: unknown }).season);
});

export interface SeasonTotals {
  spend: number;
  /** Sales value the ad platforms attribute to ads (minor units). */
  value: number;
  purchases: number;
  clicks: number;
}

export interface SeasonDay {
  /** Day of the season, 0-based. */
  i: number;
  /** This season's date for that day. */
  date: string;
  /** null = the day hasn't happened yet. */
  value: number | null;
  spend: number | null;
  clicks: number | null;
  prevDate: string;
  /** null = no data for the previous season on that day. */
  prevValue: number | null;
  prevSpend: number | null;
  prevClicks: number | null;
}

export interface SeasonMarket {
  code: string;
  cur: SeasonTotals;
  /** The previous season up to the same day (in season) or in full. */
  prev: SeasonTotals;
}

export interface SeasonView {
  state: SeasonState;
  today: string;
  /**
   * Comparisons run through this day: yesterday while the season runs (a
   * half-synced today would read as a slump), the last day otherwise.
   */
  asOf: string;
  /** Season so far through `asOf` (in) / the whole finished season. */
  totals: SeasonTotals;
  /** Today so far (in season only). */
  todayTotals: SeasonTotals | null;
  /** Previous season through the same day of its season. */
  prevSamePoint: SeasonTotals;
  /** Previous season in full. */
  prevFull: SeasonTotals;
  /** Whether the previous season has ad data at all. */
  hasPrev: boolean;
  /** Whether either season reports purchase values. */
  hasValue: boolean;
  /** Projected season total if it keeps last season's shape (in only). */
  forecast: { value: number; spend: number } | null;
  days: SeasonDay[];
  markets: SeasonMarket[];
  /** Share of spend whose campaign names carry no market (0..1). */
  unmappedShare: number;
  moments: Array<SeasonMoment & { i: number }>;
  bestDay: { date: string; value: number } | null;
  prevBestDay: { date: string; value: number } | null;
  /** The shop's own sales when it sends them (shop_sales_daily), else null. */
  shop: SeasonShop | null;
}

/** One ads_daily row as the season maths reads it. */
export interface SeasonRow {
  date: string;
  campaign_name: string | null;
  spend_minor_units: number | null;
  clicks: number | null;
  purchases: unknown;
  purchase_value: unknown;
}

const empty = (): SeasonTotals => ({ spend: 0, value: 0, purchases: 0, clicks: 0 });

function add(t: SeasonTotals, r: SeasonRow) {
  t.spend += Number(r.spend_minor_units ?? 0);
  t.clicks += Number(r.clicks ?? 0);
  t.purchases += Number(r.purchases ?? 0) || 0;
  // purchase_value is stored in major units (raw_data); totals are grosze.
  t.value += Math.round((Number(r.purchase_value ?? 0) || 0) * 100);
}

async function readWindow(clientId: string, start: string, end: string): Promise<SeasonRow[]> {
  if (start > end) return [];
  const admin = createAdminClient();
  return fetchAllByDateChunks<SeasonRow>(start, end, 14, (chunkStart, chunkEnd) => (from, to) =>
    admin
      .from("ads_daily")
      .select(
        "date, campaign_name, spend_minor_units, clicks, purchases:raw_data->purchases, purchase_value:raw_data->purchase_value"
      )
      .eq("client_id", clientId)
      .gte("date", chunkStart)
      .lte("date", chunkEnd)
      .order("date", { ascending: true })
      .order("provider", { ascending: true })
      .order("campaign_id", { ascending: true })
      .range(from, to)
  );
}

/**
 * The season page's numbers from raw ad rows - pure, no I/O. Exported so the
 * public demo runs its synthetic rows through exactly the maths a live client
 * gets, instead of hand-building a SeasonView that could drift from it.
 */
export function computeSeasonView(
  cfg: SeasonConfig,
  today: string,
  curRows: SeasonRow[],
  prevRows: SeasonRow[],
  shopRows?: { cur: SeasonShopRow[]; prev: SeasonShopRow[] }
): SeasonView {
  const state = seasonState(cfg, today);
  const cur = state.current;
  const prev = state.previous;
  const running = state.phase === "in";
  const yesterday = addDaysIso(today, -1);
  const asOf = running ? (yesterday < cur.start ? cur.start : yesterday) : cur.end;
  // Same day of the previous season as `asOf` is of this one.
  const asOfIdx = diffDaysIso(cur.start, asOf);
  // Day 1 has no finished day yet: `asOf` is today, half-synced, and a full
  // day of last season next to it reads as a -50% crash. No comparison then.
  const compareIdx = running && asOf === today ? -1 : asOfIdx;
  const prevLen = seasonLength(prev);

  const totals = empty();
  const todayTotals = running ? empty() : null;
  const prevSamePoint = empty();
  const prevFull = empty();

  const len = seasonLength(cur);
  const dayTotals = Array.from({ length: len }, empty);
  const prevDayTotals = Array.from({ length: prevLen }, empty);
  const markets = new Map<string, SeasonMarket>();
  const market = (code: string) => {
    let m = markets.get(code);
    if (!m) markets.set(code, (m = { code, cur: empty(), prev: empty() }));
    return m;
  };
  let mappedSpend = 0;
  let allSpend = 0;

  for (const r of curRows) {
    const i = diffDaysIso(cur.start, r.date);
    if (i < 0 || i >= len) continue;
    add(dayTotals[i], r);
    if (r.date === today && todayTotals) add(todayTotals, r);
    if (i > asOfIdx) continue;
    add(totals, r);
    const code = marketOf(r.campaign_name ?? "");
    const spend = Number(r.spend_minor_units ?? 0);
    allSpend += spend;
    if (code) {
      mappedSpend += spend;
      add(market(code).cur, r);
    }
  }
  for (const r of prevRows) {
    const i = diffDaysIso(prev.start, r.date);
    if (i < 0 || i >= prevLen) continue;
    add(prevDayTotals[i], r);
    add(prevFull, r);
    if (i <= compareIdx) {
      add(prevSamePoint, r);
      const code = marketOf(r.campaign_name ?? "");
      if (code) add(market(code).prev, r);
    }
  }

  const hasPrev = prevRows.length > 0;
  const hasValue = prevFull.value > 0 || totals.value > 0 || (todayTotals?.value ?? 0) > 0;

  // Forecast: the share of last season's sales that had come in by this day
  // scales this season's total. Too early (under ~5% of last season in) the
  // ratio swings wildly - no forecast rather than a silly one.
  let forecast: SeasonView["forecast"] = null;
  if (running && hasPrev && prevFull.value > 0 && prevSamePoint.value > 0) {
    const share = prevSamePoint.value / prevFull.value;
    const spendShare = prevFull.spend > 0 ? prevSamePoint.spend / prevFull.spend : 0;
    if (share >= 0.05 && totals.value > 0) {
      forecast = {
        value: Math.round(totals.value / share),
        spend: spendShare > 0 ? Math.round(totals.spend / spendShare) : 0,
      };
    }
  }

  const days: SeasonDay[] = dayTotals.map((t, i) => {
    const date = addDaysIso(cur.start, i);
    const happened = date <= today;
    const p = i < prevLen ? prevDayTotals[i] : null;
    return {
      i,
      date,
      value: happened ? t.value : null,
      spend: happened ? t.spend : null,
      clicks: happened ? t.clicks : null,
      prevDate: addDaysIso(prev.start, i),
      prevValue: hasPrev && p ? p.value : null,
      prevSpend: hasPrev && p ? p.spend : null,
      prevClicks: hasPrev && p ? p.clicks : null,
    };
  });

  const best = (list: SeasonTotals[], start: string, through: number) => {
    let at = -1;
    for (let i = 0; i <= Math.min(through, list.length - 1); i++) {
      if (list[i].value > (at < 0 ? 0 : list[at].value)) at = i;
    }
    return at < 0 ? null : { date: addDaysIso(start, at), value: list[at].value };
  };

  return {
    state,
    today,
    asOf,
    totals,
    todayTotals,
    prevSamePoint,
    prevFull,
    hasPrev,
    hasValue,
    forecast,
    days,
    markets: [...markets.values()].sort(
      (a, b) => b.cur.value - a.cur.value || b.cur.spend - a.cur.spend || b.prev.value - a.prev.value
    ),
    unmappedShare: allSpend > 0 ? 1 - mappedSpend / allSpend : 0,
    moments: seasonMoments(cur).map((m) => ({ ...m, i: diffDaysIso(cur.start, m.date) })),
    bestDay: best(dayTotals, cur.start, running ? asOfIdx : len - 1),
    prevBestDay: best(prevDayTotals, prev.start, prevLen - 1),
    shop: shopRows
      ? computeSeasonShop(state, today, asOf, compareIdx, shopRows.cur, shopRows.prev)
      : null,
  };
}

/** Last shop push or CSV upload marker; null before migration 0038 / no key. */
async function shopPushStamp(clientId: string): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .from("shop_ingest_keys")
    .select("last_used_at")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { last_used_at: string | null }).last_used_at;
}

const todayWarsaw = () => formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");

/**
 * The season page's numbers. Call only with a client id the viewer was
 * verified to see (getClientBySlug): reads with the service role, cached
 * per sync stamp like the rest of the dashboard.
 */
export async function loadSeasonView(
  clientId: string,
  cfg: SeasonConfig,
  today = todayWarsaw()
): Promise<SeasonView> {
  // Shop pushes don't move the ad sync stamp the cache is keyed on: their
  // own last-push time joins the key, so new shop numbers show at once.
  const shopStamp = await shopPushStamp(clientId);
  return syncCached("season-view", clientId, [cfg.start, cfg.end, today, shopStamp], async () => {
    const state = seasonState(cfg, today);
    const curEnd: SeasonWindow["end"] =
      state.phase === "in" ? today : state.current.end;
    const [curRows, prevRows, shopCur, shopPrev] = await Promise.all([
      readWindow(clientId, state.current.start, curEnd),
      readWindow(clientId, state.previous.start, state.previous.end),
      getShopSales(clientId, state.current.start, curEnd),
      getShopSales(clientId, state.previous.start, state.previous.end),
    ]);
    const shop =
      shopCur.available && (shopCur.rows.length || shopPrev.rows.length)
        ? { cur: shopCur.rows, prev: shopPrev.rows }
        : undefined;
    return computeSeasonView(cfg, today, curRows, prevRows, shop);
  });
}
