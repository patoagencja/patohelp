// The shop's own sales inside the season maths (pure, no I/O). Ad platforms
// each claim the orders they touched - Meta and Google count the same order
// twice - so for a shop that sends its sales (shop_sales_daily) the season
// page leads with the shop's numbers and judges ads by MER: all shop revenue
// over all ad spend.

import { addDaysIso, diffDaysIso, seasonLength, type SeasonState } from "./config";

/** One shop_sales_daily row as the season maths reads it (revenue in grosze). */
export interface SeasonShopRow {
  date: string;
  market: string;
  product: string;
  orders: number;
  revenue: number;
}

export interface ShopTotals {
  orders: number;
  revenue: number;
}

export interface SeasonShopProduct {
  product: string;
  cur: ShopTotals;
  prev: ShopTotals;
}

export interface SeasonShop {
  /** Through the same `asOf` as the ad numbers. */
  totals: ShopTotals;
  today: ShopTotals | null;
  prevSamePoint: ShopTotals;
  prevFull: ShopTotals;
  hasPrev: boolean;
  /** Newest date the shop reported anything for (staleness check). */
  lastDate: string | null;
  /** Per season day (index = SeasonDay.i); null = not reported / not yet. */
  days: Array<number | null>;
  prevDays: Array<number | null>;
  orderDays: Array<number | null>;
  /** Per market code ('' = the shop didn't say). */
  markets: Record<string, { cur: ShopTotals; prev: ShopTotals }>;
  /** Products by this season's revenue; empty when the shop sends none. */
  products: SeasonShopProduct[];
  forecast: number | null;
  bestDay: { date: string; revenue: number } | null;
}

const empty = (): ShopTotals => ({ orders: 0, revenue: 0 });
const add = (t: ShopTotals, r: SeasonShopRow) => {
  t.orders += r.orders;
  t.revenue += r.revenue;
};

export function computeSeasonShop(
  state: SeasonState,
  today: string,
  /** Last day of the comparison (SeasonView.asOf). */
  asOf: string,
  /** Last previous-season index compared (-1 = none, day 1). */
  compareIdx: number,
  curRows: SeasonShopRow[],
  prevRows: SeasonShopRow[]
): SeasonShop | null {
  if (!curRows.length && !prevRows.length) return null;
  const cur = state.current;
  const prev = state.previous;
  const running = state.phase === "in";
  const len = seasonLength(cur);
  const prevLen = seasonLength(prev);
  const asOfIdx = diffDaysIso(cur.start, asOf);

  const totals = empty();
  const todayTotals = running ? empty() : null;
  const prevSamePoint = empty();
  const prevFull = empty();
  const days: Array<number | null> = Array.from({ length: len }, () => null);
  const orderDays: Array<number | null> = Array.from({ length: len }, () => null);
  const prevDays: Array<number | null> = Array.from({ length: len }, () => null);
  const markets: SeasonShop["markets"] = {};
  const market = (code: string) => (markets[code] ??= { cur: empty(), prev: empty() });
  const products = new Map<string, SeasonShopProduct>();
  const product = (name: string) => {
    let p = products.get(name);
    if (!p) products.set(name, (p = { product: name, cur: empty(), prev: empty() }));
    return p;
  };
  let lastDate: string | null = null;

  for (const r of curRows) {
    const i = diffDaysIso(cur.start, r.date);
    if (i < 0 || i >= len || r.date > today) continue;
    days[i] = (days[i] ?? 0) + r.revenue;
    orderDays[i] = (orderDays[i] ?? 0) + r.orders;
    if (!lastDate || r.date > lastDate) lastDate = r.date;
    if (r.date === today && todayTotals) add(todayTotals, r);
    if (i > asOfIdx) continue;
    add(totals, r);
    add(market(r.market).cur, r);
    if (r.product) add(product(r.product).cur, r);
  }
  for (const r of prevRows) {
    const i = diffDaysIso(prev.start, r.date);
    if (i < 0 || i >= prevLen) continue;
    add(prevFull, r);
    if (i < len) prevDays[i] = (prevDays[i] ?? 0) + r.revenue;
    if (i <= compareIdx) {
      add(prevSamePoint, r);
      add(market(r.market).prev, r);
      if (r.product) add(product(r.product).prev, r);
    }
  }

  // Same shape-based forecast as the ad numbers (lib/season/load.ts).
  let forecast: number | null = null;
  if (running && prevFull.revenue > 0 && prevSamePoint.revenue > 0 && totals.revenue > 0) {
    const share = prevSamePoint.revenue / prevFull.revenue;
    if (share >= 0.05) forecast = Math.round(totals.revenue / share);
  }

  let best = -1;
  for (let i = 0; i <= Math.min(asOfIdx, len - 1); i++) {
    if ((days[i] ?? 0) > (best < 0 ? 0 : days[best] ?? 0)) best = i;
  }

  return {
    totals,
    today: todayTotals,
    prevSamePoint,
    prevFull,
    hasPrev: prevRows.length > 0,
    lastDate,
    days,
    prevDays,
    orderDays,
    markets,
    products: [...products.values()].sort(
      (a, b) => b.cur.revenue - a.cur.revenue || b.prev.revenue - a.prev.revenue
    ),
    forecast,
    bestDay: best < 0 ? null : { date: addDaysIso(cur.start, best), revenue: days[best] ?? 0 },
  };
}
