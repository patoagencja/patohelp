import { formatInTimeZone } from "date-fns-tz";

import {
  addDaysIso,
  diffDaysIso,
  seasonMoments,
  seasonState,
  type SeasonConfig,
  type SeasonWindow,
} from "@/lib/season/config";
import { computeSeasonView, type SeasonRow, type SeasonView } from "@/lib/season/load";
import { marketOf } from "@/lib/season/markets";
import type { SeasonShopRow } from "@/lib/season/shop";

// Synthetic seasonal client for the public demo: an online seller of
// personalised video greetings from Santa for children, sold in 7 markets
// (Poland by far the biggest). The product is digital and delivered
// instantly, so it sells right up to Christmas Eve - no shipping cut-off.
//
// We generate raw ads_daily-shaped rows and feed them to the same
// computeSeasonView() production uses, so every derived number (forecast,
// best day, markets, same-point comparisons) is consistent by construction.
// Every row is a pure function of its date and campaign (hashed seed): the
// same day always shows the same sales whatever "today" is, except today
// itself, which is only partly synced - as in the live sync.

export const DEMO_SEASON_CONFIG: SeasonConfig = { start: "10-01", end: "12-24" };

/** The season the absolute numbers below describe; others grow from it. */
const BASE_YEAR = 2025;
/** Ad-attributed sales value of the base season, grosze (11 mln zł). */
const BASE_SEASON_VALUE = 11_000_000_00;
/** Spend follows demand, but flatter - hence the weak October ROAS. */
const SPEND_FLATTEN = 0.7;
/** Yearly price increase (AOV) and click inflation (CPC). */
const PRICE_GROWTH = 1.03;
const CPC_GROWTH = 1.04;
/** Fraction of today already "synced" - today is always a partial day. */
const TODAY_PARTIAL = 0.42;

interface DemoMarket {
  /** Share of the base season's ad-attributed value. */
  share: number;
  roas: number;
  /** Grosze. */
  aov: number;
  /** Grosze. */
  cpc: number;
  /** Year-on-year growth of ad-attributed value and of spend. */
  valueGrowth: number;
  spendGrowth: number;
  /** How hard Black Week moves the market (1 = Poland). */
  blackWeek: number;
  /** Size of the eve-of-St-Nicholas peak on 5 Dec (1 = Polish Mikołajki). */
  nicholas: number;
}

// Mikołajki (PL) and Nikolaustag (DE) on 6 Dec are big gift days, so a
// greeting "from Santa" sells hard the day before; France only celebrates it
// in the east, the rest wait for Christmas. Black Friday matters more where
// it's a shopping ritual (US, UK) - still moderate, it's not a discount buy.
type MarketCode = "PL" | "DE" | "IT" | "UK" | "FR" | "BR" | "US";

const MARKETS: Record<MarketCode, DemoMarket> = {
  PL: { share: 0.57, roas: 10, aov: 64_00, cpc: 1_28, valueGrowth: 1.09, spendGrowth: 1.02, blackWeek: 1, nicholas: 1 },
  DE: { share: 0.15, roas: 9, aov: 95_00, cpc: 1_85, valueGrowth: 1.22, spendGrowth: 1.12, blackWeek: 0.9, nicholas: 1.35 },
  IT: { share: 0.08, roas: 8, aov: 85_00, cpc: 1_55, valueGrowth: 1.18, spendGrowth: 1.08, blackWeek: 0.9, nicholas: 0.08 },
  UK: { share: 0.07, roas: 7.5, aov: 90_00, cpc: 2_00, valueGrowth: 1.1, spendGrowth: 1.0, blackWeek: 1.3, nicholas: 0.04 },
  FR: { share: 0.05, roas: 7, aov: 85_00, cpc: 1_65, valueGrowth: 1.15, spendGrowth: 1.05, blackWeek: 1, nicholas: 0.2 },
  BR: { share: 0.04, roas: 6, aov: 45_00, cpc: 58, valueGrowth: 0.92, spendGrowth: 0.95, blackWeek: 1.2, nicholas: 0 },
  US: { share: 0.04, roas: 6.5, aov: 100_00, cpc: 2_35, valueGrowth: 1.2, spendGrowth: 1.1, blackWeek: 1.5, nicholas: 0.04 },
};

interface DemoCampaign {
  name: string;
  market: MarketCode;
  /** Share of the market's value. */
  share: number;
  /** Multipliers on the market's ROAS, CPC and AOV. */
  roas: number;
  cpc: number;
  aov: number;
  /**
   * Exponent on the market's daily curve: brand search rides the peaks
   * harder, prospecting sells more evenly through the season.
   */
  curve: number;
  /** "MM-DD" the campaign starts each season (default: season start). */
  from?: string;
}

// Names follow the agency's real conventions per market - the market code is
// read from them by lib/season/markets.ts, exactly as for a live client.
const CAMPAIGNS: DemoCampaign[] = [
  { name: "PL - Search - Brand", market: "PL", share: 0.3, roas: 2, cpc: 0.55, aov: 1.02, curve: 1.1 },
  { name: "PL - PMax - Mikołaj", market: "PL", share: 0.34, roas: 0.95, cpc: 0.9, aov: 1, curve: 1 },
  { name: "PL - Meta - Prospecting", market: "PL", share: 0.22, roas: 0.6, cpc: 0.8, aov: 0.95, curve: 0.85 },
  { name: "PL - Meta - Remarketing", market: "PL", share: 0.14, roas: 1.3, cpc: 1.1, aov: 1.04, curve: 1.05, from: "10-15" },
  { name: "DE | Search | Brand", market: "DE", share: 0.28, roas: 1.9, cpc: 0.6, aov: 1.02, curve: 1.1 },
  { name: "DE | PMax | Video Nikolaus", market: "DE", share: 0.47, roas: 0.95, cpc: 1, aov: 1, curve: 1 },
  { name: "DE | Meta | Prospecting", market: "DE", share: 0.25, roas: 0.65, cpc: 0.75, aov: 0.96, curve: 0.85 },
  { name: "IT - Search Generic", market: "IT", share: 0.55, roas: 1.1, cpc: 1, aov: 1, curve: 1 },
  { name: "IT - PMax Babbo Natale", market: "IT", share: 0.45, roas: 0.9, cpc: 0.9, aov: 1, curve: 1 },
  { name: "UK - PMax", market: "UK", share: 0.6, roas: 0.9, cpc: 1, aov: 1, curve: 1 },
  { name: "UK - Search - Santa Video", market: "UK", share: 0.4, roas: 1.15, cpc: 1.1, aov: 1, curve: 1.05 },
  { name: "FR - Search", market: "FR", share: 0.6, roas: 1.1, cpc: 1, aov: 1, curve: 1.05 },
  { name: "FR - PMax Père Noël", market: "FR", share: 0.4, roas: 0.88, cpc: 0.9, aov: 1, curve: 1 },
  { name: "BR - Meta Prospecting 🇧🇷", market: "BR", share: 0.65, roas: 0.95, cpc: 0.8, aov: 0.97, curve: 0.9 },
  { name: "BR - Search Papai Noel", market: "BR", share: 0.35, roas: 1.1, cpc: 1.4, aov: 1.05, curve: 1 },
  { name: "US - Search (COM)", market: "US", share: 0.6, roas: 1.15, cpc: 1, aov: 1, curve: 1.05, from: "10-20" },
  { name: "US - Meta - Santa Video", market: "US", share: 0.4, roas: 0.82, cpc: 0.6, aov: 0.97, curve: 0.9 },
];

// ---- the demand curve -------------------------------------------------------

type Anchors = Array<[md: string, value: number]>;

// Christmas demand every market shares, on calendar days with straight lines
// between: a quiet October, a November build-up, a flat-ish first half of
// December, then the last-minute rush with 23 Dec the biggest day and Christmas
// Eve still strong until the evening.
const CHRISTMAS: Anchors = [
  ["10-01", 0.2],
  ["10-15", 0.28],
  ["10-31", 0.45],
  ["11-10", 0.62],
  ["11-20", 0.9],
  ["11-30", 1.4],
  ["12-04", 1.7],
  ["12-08", 1.85],
  ["12-17", 2.2],
  ["12-20", 2.9],
  ["12-21", 4],
  ["12-22", 5.8],
  ["12-23", 8],
  ["12-24", 6],
];

// The St Nicholas wave on top, scaled per market: builds from late November,
// peaks on the eve (5 Dec), a little left on the morning of the 6th.
const NICHOLAS: Anchors = [
  ["11-22", 0],
  ["11-28", 0.35],
  ["12-01", 0.6],
  ["12-02", 0.9],
  ["12-03", 1.3],
  ["12-04", 2.2],
  ["12-05", 6],
  ["12-06", 1.2],
  ["12-07", 0],
];

/** Days from Black Friday -> demand multiplier (before the market's scale). */
const BLACK_WEEK: Record<number, number> = { [-1]: 1.12, 0: 1.45, 1: 1.22, 2: 1.15, 3: 1.28, 4: 1.08 };
const BLACK_WEEK_LEAD_IN = 1.05;

// Mild: parents browse on Sunday evenings, Friday and Saturday are quieter.
const WEEKDAY = [1.06, 1.03, 1, 1, 0.99, 0.95, 0.94]; // Sun..Sat

/** Linear interpolation over "MM-DD" anchors; `outside` = value beyond them
 *  (null = hold the nearest anchor). Seasons here never cross New Year. */
function interpolate(anchors: Anchors, date: string, outside: number | null): number {
  const year = date.slice(0, 4);
  const md = date.slice(5);
  if (md < anchors[0][0]) return outside ?? anchors[0][1];
  for (let k = 1; k < anchors.length; k++) {
    const [md1, v1] = anchors[k];
    if (md > md1) continue;
    const [md0, v0] = anchors[k - 1];
    const from = `${year}-${md0}`;
    return v0 + ((v1 - v0) * diffDaysIso(from, date)) / diffDaysIso(from, `${year}-${md1}`);
  }
  return outside ?? anchors[anchors.length - 1][1];
}

/** Relative demand for a market on a date (any scale - normalised per season). */
function demand(m: DemoMarket, date: string, blackFriday: string): number {
  const md = date.slice(5);
  const fromBf = diffDaysIso(blackFriday, date);
  const bw = BLACK_WEEK[fromBf] ?? (fromBf >= -7 && fromBf <= -2 ? BLACK_WEEK_LEAD_IN : 1);
  const christmas = interpolate(CHRISTMAS, date, null) * (1 + (bw - 1) * m.blackWeek);
  const nicholas = interpolate(NICHOLAS, date, 0) * m.nicholas;
  // On the big days the calendar drives sales, not the day of the week.
  const eventDay =
    BLACK_WEEK[fromBf] !== undefined || (md >= "12-04" && md <= "12-06") || md >= "12-21";
  const weekday = eventDay ? 1 : WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return (christmas + nicholas) * weekday;
}

// ---- rows -------------------------------------------------------------------

/** Deterministic PRNG seeded from a string (FNV-1a + LCG), as in lib/demo/ecom.ts. */
function rng(key: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let s = h >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const jitter = (r: () => number, spread: number) => 1 - spread + r() * spread * 2;

interface CampaignSeason {
  /** Active days of the season with the market's demand on each. */
  days: Array<{ date: string; demand: number }>;
  /** Sums of the value and spend weights - totals land on the targets. */
  valueNorm: number;
  spendNorm: number;
}

const seasonCache = new Map<string, CampaignSeason>();

function campaignSeason(c: DemoCampaign, w: SeasonWindow): CampaignSeason {
  const key = `${w.year}|${c.name}`;
  const cached = seasonCache.get(key);
  if (cached) return cached;
  const m = MARKETS[c.market];
  // Black Friday always falls inside an October-December season.
  const bf = seasonMoments(w).find((x) => x.key.startsWith("bf-"))!.date;
  const start = c.from ? `${w.year}-${c.from}` : w.start;
  const days: CampaignSeason["days"] = [];
  let valueNorm = 0;
  let spendNorm = 0;
  for (let d = start; d <= w.end; d = addDaysIso(d, 1)) {
    const dem = demand(m, d, bf);
    days.push({ date: d, demand: dem });
    valueNorm += dem ** c.curve;
    spendNorm += dem ** (c.curve * SPEND_FLATTEN);
  }
  const out = { days, valueNorm, spendNorm };
  seasonCache.set(key, out);
  return out;
}

/** The season's ads rows through `through`, today's only partly synced. */
function seasonRows(w: SeasonWindow, through: string, today: string): SeasonRow[] {
  const rows: SeasonRow[] = [];
  const years = w.year - BASE_YEAR;
  for (const c of CAMPAIGNS) {
    const m = MARKETS[c.market];
    const baseValue = BASE_SEASON_VALUE * m.share * c.share;
    const seasonValue = baseValue * m.valueGrowth ** years;
    const seasonSpend = ((baseValue / (m.roas * c.roas)) * m.spendGrowth ** years) * SPEND_SCALE;
    const s = campaignSeason(c, w);
    for (const { date, demand: dem } of s.days) {
      if (date > through) break;
      const r = rng(`demo-season:${c.name}:${date}`);
      // A shared day factor so all campaigns move together a little (weather,
      // news, a viral post) on top of each campaign's own noise.
      const dayFactor = jitter(rng(`demo-season-day:${date}`), 0.05);
      const part = date === today ? TODAY_PARTIAL : 1;
      const value =
        ((seasonValue * dem ** c.curve) / s.valueNorm) * dayFactor * jitter(r, 0.12) * part;
      const spend =
        ((seasonSpend * dem ** (c.curve * SPEND_FLATTEN)) / s.spendNorm) * jitter(r, 0.06) * part;
      // Last-minute buyers take the premium package (longer, more names).
      const rush = date.slice(5) >= "12-20" ? 1.05 : 1;
      const aov = m.aov * c.aov * PRICE_GROWTH ** years * rush * jitter(r, 0.05);
      // Clicks get dearer as the auction fills up towards the peaks.
      const cpc = m.cpc * c.cpc * CPC_GROWTH ** years * dem ** 0.12 * jitter(r, 0.07);
      const purchases = Math.round(value / aov);
      rows.push({
        date,
        campaign_name: c.name,
        spend_minor_units: Math.round(spend),
        clicks: Math.round(spend / cpc),
        purchases,
        // Major units, like raw_data.purchase_value from the platforms.
        purchase_value: Math.round(purchases * aov) / 100,
      });
    }
  }
  return rows;
}

// The shop panel's view of the same days: Meta and Google together claim
// more than the shop really sold (the same order counted by both), while the
// shop also sells to people who never clicked an ad - net, the shop books a
// bit less than the platforms' sum. Products split the way gift-video shops
// do: the film carries the season, letters and bundles follow.
// Scale of a big gift-video seller: ~3 mln zł of ads a season, platforms
// claiming ~3.7x and the shop really booking ~3.3x on that spend.
const SPEND_SCALE = 2.4;
const SHOP_VS_PLATFORMS = 0.9;
/**
 * Pay-later: part of a recent day's orders is still unpaid (up to 10 days).
 * Share unpaid by the day's age in days - 30% of today's, ~3% at 9 days.
 */
const UNPAID_BY_AGE = [0.3, 0.22, 0.16, 0.12, 0.09, 0.07, 0.05, 0.04, 0.03, 0.03];
const DEMO_PRODUCTS: Array<{ name: string; share: number; price: number }> = [
  { name: "Film od Mikołaja", share: 0.6, price: 4999 },
  { name: "List od Mikołaja", share: 0.28, price: 3999 },
  { name: "Pakiet film + list", share: 0.12, price: 7999 },
];

function shopRows(adRows: SeasonRow[], today: string): SeasonShopRow[] {
  const byDayMarket = new Map<string, number>();
  for (const r of adRows) {
    const market = marketOf(r.campaign_name ?? "") ?? "";
    const key = `${r.date}|${market}`;
    byDayMarket.set(key, (byDayMarket.get(key) ?? 0) + Math.round(Number(r.purchase_value ?? 0) * 100));
  }
  const out: SeasonShopRow[] = [];
  for (const [key, value] of byDayMarket) {
    const [date, market] = key.split("|");
    const r = rng(`demo-shop:${key}`);
    const revenue = value * SHOP_VS_PLATFORMS * jitter(r, 0.06);
    const age = diffDaysIso(date, today);
    const unpaid = age >= 0 && age < UNPAID_BY_AGE.length ? UNPAID_BY_AGE[age] : 0;
    for (const p of DEMO_PRODUCTS) {
      const part = revenue * p.share * jitter(r, 0.08);
      const paid = Math.round(part * (1 - unpaid));
      const pending = Math.round(part * unpaid);
      out.push({
        date,
        market,
        product: p.name,
        orders: Math.round(paid / p.price),
        revenue: paid,
        pendingOrders: Math.round(pending / p.price),
        pendingRevenue: pending,
      });
    }
  }
  return out;
}

const todayWarsaw = () => formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");

/**
 * The demo seasonal client's season page, as loadSeasonView() would return it
 * for a live client on `today` (yyyy-MM-dd, Warsaw). Works in every phase:
 * before the season (last season in full vs the one before), during it, after.
 */
export function getDemoSeasonView(today: string = todayWarsaw()): SeasonView {
  const state = seasonState(DEMO_SEASON_CONFIG, today);
  const curEnd = state.phase === "in" ? today : state.current.end;
  const cur = seasonRows(state.current, curEnd, today);
  const prev = seasonRows(state.previous, state.previous.end, today);
  return computeSeasonView(DEMO_SEASON_CONFIG, today, cur, prev, {
    cur: shopRows(cur, today),
    prev: shopRows(prev, today),
  });
}
