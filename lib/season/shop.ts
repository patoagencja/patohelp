// The shop's own sales inside the season maths (pure, no I/O). Ad platforms
// each claim the orders they touched - Meta and Google count the same order
// twice - so for a shop that sends its sales (shop_sales_daily) the season
// page leads with the shop's numbers and judges ads by MER: all shop revenue
// over all ad spend.

import { addDaysIso, diffDaysIso, seasonLength, type SeasonState } from "./config";
import { projectSeason, type SeasonForecast } from "./forecast";

/** One shop_sales_daily row as the season maths reads it (revenue in grosze). */
export interface SeasonShopRow {
  date: string;
  market: string;
  product: string;
  orders: number;
  revenue: number;
  /** Placed but not yet paid (pay-later), when the shop sends it. */
  pendingOrders?: number;
  pendingRevenue?: number;
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
  /**
   * Last day the shop's numbers are compared through: the ad numbers'
   * `asOf`, or earlier when the shop's feed lags - comparing a missing day
   * with a full one last year would read as a slump.
   */
  asOf: string;
  totals: ShopTotals;
  /** Placed-but-unpaid orders over the season so far (pay-later). */
  pending: ShopTotals;
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
  forecast: SeasonForecast | null;
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
  let lastDate: string | null = null;
  for (const r of curRows) {
    if (r.date >= cur.start && r.date <= today && (!lastDate || r.date > lastDate)) lastDate = r.date;
  }
  const shopAsOf = running && lastDate && lastDate < asOf ? lastDate : asOf;
  const asOfIdx = diffDaysIso(cur.start, shopAsOf);
  // The ad comparison index, pulled back with a lagging feed.
  const cmpIdx = Math.min(compareIdx, asOfIdx);

  const totals = empty();
  const todayTotals = running ? empty() : null;
  const prevSamePoint = empty();
  const prevFull = empty();
  const days: Array<number | null> = Array.from({ length: len }, () => null);
  const orderDays: Array<number | null> = Array.from({ length: len }, () => null);
  const prevDays: Array<number | null> = Array.from({ length: len }, () => null);
  const markets: SeasonShop["markets"] = {};
  const market = (code: string) => (markets[code] ??= { cur: empty(), prev: empty() });
  const pending = empty();
  const products = new Map<string, SeasonShopProduct>();
  const product = (name: string) => {
    let p = products.get(name);
    if (!p) products.set(name, (p = { product: name, cur: empty(), prev: empty() }));
    return p;
  };

  for (const r of curRows) {
    const i = diffDaysIso(cur.start, r.date);
    if (i < 0 || i >= len || r.date > today) continue;
    days[i] = (days[i] ?? 0) + r.revenue;
    orderDays[i] = (orderDays[i] ?? 0) + r.orders;
    if (r.date === today && todayTotals) add(todayTotals, r);
    pending.orders += r.pendingOrders ?? 0;
    pending.revenue += r.pendingRevenue ?? 0;
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
    if (i <= cmpIdx) {
      add(prevSamePoint, r);
      add(market(r.market).prev, r);
      if (r.product) add(product(r.product).prev, r);
    }
  }

  const recentFrom = Math.max(0, cmpIdx - 13);
  const sum = (list: Array<number | null>, from: number, to: number) => {
    let total = 0;
    for (let i = from; i <= Math.min(to, list.length - 1); i++) total += list[i] ?? 0;
    return total;
  };
  const forecast =
    running && cmpIdx >= 0
      ? projectSeason({
          soFar: totals.revenue,
          prevSoFar: prevSamePoint.revenue,
          prevFull: prevFull.revenue,
          recent: sum(days, recentFrom, cmpIdx),
          prevRecent: sum(prevDays, recentFrom, cmpIdx),
        })
      : null;

  let best = -1;
  for (let i = 0; i <= Math.min(asOfIdx, len - 1); i++) {
    if ((days[i] ?? 0) > (best < 0 ? 0 : days[best] ?? 0)) best = i;
  }

  return {
    asOf: shopAsOf,
    totals,
    pending,
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
