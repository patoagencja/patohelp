// The public demo's "profile": one real e-commerce client's recent numbers,
// stripped to numbers only, so /demo-full can look like a live shop in
// season without anyone being able to tell which shop it is.
//
// Rules this file enforces (the repo and its CI logs are public):
// - Only numbers, dates and a few fixed enums leave the source client. No
//   campaign / ad / product names or ids, no page paths, no search terms, no
//   free text, no account ids, no domains. Category-like values are mapped
//   to the whitelists below and anything else is dropped or folded.
// - Every money and count value is multiplied by a factor before it is
//   stored, so the demo never shows the client's exact revenue, orders or
//   traffic. The factors are NOT constants (the repo is public: anyone could
//   divide them back out). Each snapshot draws them at random (drawFactors)
//   from the source's own totals, so that the demo's average order, cost per
//   click and conversion rate land in the bands an electronics shop shows
//   (the demo brand, lib/demo/brand.ts), whatever the source's real ones
//   are. Revenue, ad spend, orders and traffic each get their own factor, so
//   not even the demo's ROAS is the source's exact one. The factors and the
//   real totals live only inside buildDemoProfile: never stored, logged or
//   returned.
// - Shares (devices, channels, countries, products, pages) are stored as
//   ratios, products and pages by rank only.
//
// Pure and import-free at runtime (type imports only): the unit tests run
// this file directly under Node's type stripping. The classifiers that turn
// raw strings into enums (market from a campaign name, channel from a GA4
// source / medium) and the random source (node:crypto on the server) are
// passed in, and the classifiers' answers are checked against the
// whitelists here anyway.

import type { ChannelKey } from "../../ecom/channel";

export const DEMO_PROFILE_VERSION = 1;

/**
 * The bands the demo's own KPIs are drawn in (an AGD / RTV shop): average
 * order 700-1200 zł, cost per click 1.2-3 zł, conversion rate 0.7-3%, and
 * the revenue factor itself. Draws stay a little inside the edges so the
 * per-day rounding can't push a KPI out.
 */
export const DEMO_BANDS = {
  aov: [700_00, 1200_00],
  cpc: [1_20, 3_00],
  cr: [0.007, 0.03],
  money: [0.55, 0.85],
  /** Ad spend's own factor, relative to revenue's. */
  spend: [0.85, 1.15],
} as const;
const DRAW_MARGIN = 0.03;
const DRAW_TRIES = 12;

/** Nine weeks: a 30-day range and the 30 days before it, whatever weekday shift the demo applies. */
export const PROFILE_DAYS = 63;
/** 52 weeks, weekday-aligned - the same shift as year-over-year everywhere else. */
export const YOY_SHIFT_DAYS = 364;
/** Last year's window runs this many days past the same weeks: month pacing, Black Friday and the rest of the season. */
export const LAST_YEAR_AHEAD_DAYS = 49;
/** The window shares (channels, countries, products, pages) are measured over. */
export const SHARE_WINDOW_DAYS = 30;
export const MAX_CAMPAIGNS_PER_PROVIDER = 8;
export const MAX_PRODUCTS = 10;
export const MAX_PAGES = 5;

// ---- whitelists ------------------------------------------------------------

export const PROFILE_PROVIDERS = ["meta_ads", "google_ads"] as const;
export type ProfileProvider = (typeof PROFILE_PROVIDERS)[number];

export const CAMPAIGN_TYPES = [
  "PMAX",
  "SEARCH",
  "SHOPPING",
  "VIDEO",
  "DISPLAY",
  "DEMAND_GEN",
  "PROSPECTING",
  "RETARGETING",
  "CATALOG",
  "OTHER",
] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];

export const PROFILE_CHANNELS = [
  "meta",
  "google_ads",
  "tiktok",
  "organic_search",
  "social_organic",
  "direct",
  "email",
  "other",
] as const satisfies readonly ChannelKey[];

export const PROFILE_DEVICES = ["desktop", "mobile", "tablet"] as const;
export type ProfileDevice = (typeof PROFILE_DEVICES)[number];

/** Market codes, as lib/season/markets.ts knows them (UK for Great Britain). */
export const PROFILE_COUNTRIES = [
  "PL", "DE", "IT", "UK", "FR", "ES", "US", "BR", "CZ", "SK", "AT", "CH", "NL", "BE", "PT",
  "RO", "HU", "SE", "NO", "DK", "FI", "IE", "LT", "LV", "EE", "UA", "CA", "AU", "MX",
] as const;

export const REVENUE_SOURCES = ["ga4", "shop", "none"] as const;
export type RevenueSource = (typeof REVENUE_SOURCES)[number];
export const COUNTRY_BASES = ["shop", "ads", "none"] as const;

// ---- the stored shape --------------------------------------------------------

export interface ProfileAds {
  spend: number; // grosze, scaled
  clicks: number;
  impressions: number;
  conversions: number;
}

export interface ProfileDay {
  date: string;
  meta: ProfileAds;
  google: ProfileAds;
  /** GA4 sessions; null = nothing synced that day. */
  sessions: number | null;
  /** Orders and revenue (grosze) from `revenueSource`; null = no data that day. */
  orders: number | null;
  revenue: number | null;
  /** 0..1, GA4's engagement rate. */
  engagementRate: number | null;
  newUsers: number | null;
  returningUsers: number | null;
}

export interface ProfileCampaign {
  provider: ProfileProvider;
  type: CampaignType;
  /** Market code from the whitelist, or null when the name carried none. */
  market: string | null;
  /** One value per profile day (same order as `days`). */
  spend: number[];
  clicks: number[];
  impressions: number[];
  conversions: number[];
}

export interface DemoProfile {
  version: typeof DEMO_PROFILE_VERSION;
  /** The last full day in the profile (yyyy-MM-dd), before any demo shift. */
  snapshotDate: string;
  /** When the snapshot was taken (ISO, UTC). */
  createdAt: string;
  revenueSource: RevenueSource;
  /** PROFILE_DAYS consecutive days ending on snapshotDate. */
  days: ProfileDay[];
  /** The same weeks a year earlier plus LAST_YEAR_AHEAD_DAYS; no campaigns. Empty when there is no history. */
  lastYear: ProfileDay[];
  /** The provider totals in `days` are exactly the sums of these. */
  campaigns: ProfileCampaign[];
  /** GA4 last-click shares by channel over the share window. */
  channels: Array<{ channel: ChannelKey; sessionsShare: number; revenueShare: number; ordersShare: number }>;
  devices: Array<{ device: ProfileDevice; share: number }>;
  countriesBasis: (typeof COUNTRY_BASES)[number];
  countries: Array<{ country: string; revenueShare: number; ordersShare: number }>;
  /** Best sellers by rank: shares of the item revenue / quantity. */
  products: Array<{ revenueShare: number; quantityShare: number }>;
  /** Item revenue / shop revenue over the share window (GA4 items can miss some). */
  productsCoverage: number | null;
  /** Most viewed pages by rank: views per session over the share window, engagement 0..1. */
  pages: Array<{ viewsPerSession: number; engagementRate: number }>;
}

// ---- raw input (never stored) -------------------------------------------------

export interface RawAdsRow {
  provider: string;
  campaignId: string;
  campaignName: string | null;
  date: string;
  spend: number; // grosze
  clicks: number;
  impressions: number;
  conversions: number | null;
}

export interface RawAdsDayTotal {
  provider: string;
  date: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number | null;
}

export interface RawGa4Day {
  date: string;
  sessions: number;
  usersNew: number | null;
  usersReturning: number | null;
  engagementRate: number | null; // 0..1
  revenue: number | null; // grosze
  transactions: number | null;
}

export interface RawSource {
  /** Last full day (yesterday in Warsaw when the admin clicks). */
  snapshotDate: string;
  createdAt: string;
  /** Campaign rows over the profile window. */
  ads: RawAdsRow[];
  /** Per-day, per-provider totals over last year's window. */
  adsLastYear: RawAdsDayTotal[];
  /** GA4 daily totals (no dimension) over both windows. */
  ga4Days: RawGa4Day[];
  /** The latest GA4 snapshots (each covers the 30 days before its sync). */
  ga4Sources: Array<{ sourceMedium: string; sessions: number; revenue: number | null; transactions: number | null }>;
  ga4Devices: Array<{ device: string; sessions: number }>;
  ga4Pages: Array<{ path: string; views: number; engagementRate: number | null }>;
  /** GA4 item rows over the share window. */
  items: Array<{ itemId: string; itemName: string; quantity: number; revenue: number }>;
  /** shop_sales_daily rows over both windows. */
  shopSales: Array<{ date: string; market: string; product: string; orders: number; revenue: number }>;
}

export interface AnonymizeDeps {
  /** Market code from a campaign name (lib/season/markets.ts). */
  marketOf: (campaignName: string) => string | null;
  /** Channel from a GA4 "source / medium" (lib/ecom/channel.ts). */
  channelOf: (sourceMedium: string) => string;
  /** Uniform in [0, 1). The server passes node:crypto; nothing seeded or guessable. */
  random: () => number;
}

// ---- helpers -------------------------------------------------------------------

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

const toTime = (s: string) => new Date(`${s}T00:00:00Z`).getTime();
export const addDaysIso = (s: string, n: number) => new Date(toTime(s) + n * DAY_MS).toISOString().slice(0, 10);
const diffDays = (from: string, to: string) => Math.round((toTime(to) - toTime(from)) / DAY_MS);

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const ratio = (v: number) => Math.round(v * 10_000) / 10_000;
const share = (part: number, whole: number) => (whole > 0 ? ratio(part / whole) : 0);

function inList<T extends string>(list: readonly T[], v: string | null | undefined): v is T {
  return v != null && (list as readonly string[]).includes(v);
}

const COUNTRY_ALIASES: Record<string, string> = { GB: "UK", USA: "US", COM: "US", ENG: "UK" };

/** Whitelisted market code or null. */
export function normalizeCountry(code: string | null | undefined): string | null {
  if (!code) return null;
  const c = code.trim().toUpperCase();
  const hit = COUNTRY_ALIASES[c] ?? c;
  return inList(PROFILE_COUNTRIES, hit) ? hit : null;
}

/**
 * The campaign's type from its name, by the agency's naming habits. Only the
 * enum is kept; the name never leaves this function.
 */
export function campaignTypeOf(provider: ProfileProvider, name: string): CampaignType {
  const n = name.toLowerCase();
  if (provider === "google_ads") {
    if (/p\s*-?max|performance\s*max/.test(n)) return "PMAX";
    if (/shopping|\bpla\b|produktow/.test(n)) return "SHOPPING";
    if (/demand\s*gen|discovery|\bdg\b/.test(n)) return "DEMAND_GEN";
    if (/video|youtube|\byt\b/.test(n)) return "VIDEO";
    if (/display|\bgdn\b|banner|remarketing|rmk/.test(n)) return "DISPLAY";
    if (/search|\bsrch\b|wyszuk|\bsem\b|brand|marka|\bdsa\b/.test(n)) return "SEARCH";
    return "OTHER";
  }
  if (/catalog|katalog|\bdpa\b|\bdaba\b|dynamic|dynamiczn/.test(n)) return "CATALOG";
  if (/remarketing|retarget|\brmk\b|\brtg\b|koszyk|cart|\bwarm\b|ciep[lł]|odwiedz|visitors|engaged/.test(n)) return "RETARGETING";
  if (/prospect|\bpro\b|cold|zimn|broad|szerok|lookalike|\blal\b|\btof\b|advantage|\basc\b|interest|zainteres|nowi|new/.test(n)) {
    return "PROSPECTING";
  }
  return "OTHER";
}

function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

// ---- the factors ----------------------------------------------------------------------

interface Factors {
  /** Revenue (money the shop took). */
  money: number;
  /** Ad spend: money's own draw, so the demo's ROAS isn't the source's exact one. */
  spend: number;
  /** Orders and the purchases the platforms attribute. */
  orders: number;
  /** Sessions, users, clicks, impressions. */
  traffic: number;
}

interface SourceTotals {
  spend: number;
  clicks: number;
  revenue: number;
  orders: number;
  sessions: number;
}

/**
 * Random factors for one snapshot. Targets are drawn uniformly inside the
 * bands - an average order, a cost per click, the revenue factor and the ad
 * spend's offset - and the order and traffic factors follow from the
 * source's own totals so the demo lands exactly on those targets:
 *   orders  = money x AOV_source / AOV_target
 *   traffic = spend x CPC_source / CPC_target
 * The conversion rate falls out of the rest; when it misses its band the
 * cost per click is drawn inside the part of its band that fixes it, and when
 * no draw can (a few tries), the closest one is kept and the conversion rate
 * clamped by moving the traffic factor (the cost per click then gives way).
 */
function drawFactors(t: SourceTotals, random: () => number): Factors {
  const inside = ([lo, hi]: readonly [number, number]) => {
    const m = (hi - lo) * DRAW_MARGIN;
    return [lo + m, hi - m] as const;
  };
  const uniform = ([lo, hi]: readonly [number, number]) => lo + random() * (hi - lo);
  const [crLo, crHi] = inside(DEMO_BANDS.cr);
  const [cpcLo, cpcHi] = inside(DEMO_BANDS.cpc);
  const aovReal = t.orders > 0 && t.revenue > 0 ? t.revenue / t.orders : null;
  const cpcReal = t.clicks > 0 && t.spend > 0 ? t.spend / t.clicks : null;
  const crReal = t.sessions > 0 && t.orders > 0 ? t.orders / t.sessions : null;

  let closest: { money: number; spend: number; orders: number; miss: number; target: number } | null = null;
  for (let i = 0; i < DRAW_TRIES; i++) {
    const money = uniform(DEMO_BANDS.money);
    const spend = money * uniform(DEMO_BANDS.spend);
    const orders = aovReal ? (money * aovReal) / uniform(inside(DEMO_BANDS.aov)) : money;
    if (!cpcReal) return { money, spend, orders, traffic: money };
    const trafficFor = (cpc: number) => (spend * cpcReal) / cpc;
    if (!crReal) return { money, spend, orders, traffic: trafficFor(uniform([cpcLo, cpcHi])) };
    // CR_demo = crReal x orders / traffic = k x CPC_target.
    const k = (crReal * orders) / (spend * cpcReal);
    const lo = Math.max(cpcLo, crLo / k);
    const hi = Math.min(cpcHi, crHi / k);
    if (lo <= hi) return { money, spend, orders, traffic: trafficFor(uniform([lo, hi])) };
    const edge = k * cpcHi < crLo ? k * cpcHi : k * cpcLo;
    const target = edge < crLo ? crLo : crHi;
    const miss = Math.abs(edge - target);
    if (!closest || miss < closest.miss) closest = { money, spend, orders, miss, target };
  }
  // No draw fits: the closest one, with its conversion rate clamped into the
  // band through the traffic factor. The average order stays in its band;
  // the cost per click gives way (a dear click is still believable for RTV).
  const c = closest!;
  return { money: c.money, spend: c.spend, orders: c.orders, traffic: ((crReal ?? 0) * c.orders) / c.target };
}

/** The demo's own KPIs over a profile's last 30 days - what the settings card shows. */
export function profileKpis(p: DemoProfile): { aov: number | null; cpc: number | null; cr: number | null; roas: number | null } {
  const days = p.days.slice(-SHARE_WINDOW_DAYS);
  let spend = 0;
  let clicks = 0;
  let revenue = 0;
  let orders = 0;
  let sessions = 0;
  for (const d of days) {
    spend += d.meta.spend + d.google.spend;
    clicks += d.meta.clicks + d.google.clicks;
    revenue += d.revenue ?? 0;
    orders += d.orders ?? 0;
    sessions += d.sessions ?? 0;
  }
  return {
    aov: orders > 0 ? revenue / orders : null,
    cpc: clicks > 0 ? spend / clicks : null,
    cr: sessions > 0 ? orders / sessions : null,
    roas: spend > 0 ? revenue / spend : null,
  };
}

// ---- the builder -------------------------------------------------------------------

interface CampaignAcc {
  provider: ProfileProvider;
  name: string;
  spend: number[];
  clicks: number[];
  impressions: number[];
  conversions: number[];
  total: number;
  impr: number;
}

/**
 * The anonymized profile of one shop. `raw` holds the client's own rows
 * (names, paths and all) only in memory; what comes back holds numbers,
 * dates and whitelisted enums only - checked again before it is returned.
 */
export function buildDemoProfile(raw: RawSource, deps: AnonymizeDeps): DemoProfile {
  if (!ISO_DAY.test(raw.snapshotDate)) throw new Error("snapshotDate must be yyyy-MM-dd");
  const end = raw.snapshotDate;
  const start = addDaysIso(end, -(PROFILE_DAYS - 1));
  const dates = eachDay(start, end);
  const index = new Map(dates.map((d, i) => [d, i]));
  const lyStart = addDaysIso(start, -YOY_SHIFT_DAYS);
  const lyEnd = addDaysIso(end, -YOY_SHIFT_DAYS + LAST_YEAR_AHEAD_DAYS);
  const shareStart = addDaysIso(end, -(SHARE_WINDOW_DAYS - 1));

  // --- campaigns: per provider, the biggest kept, the rest folded into one --
  const accs = new Map<string, CampaignAcc>();
  for (const r of raw.ads) {
    if (!inList(PROFILE_PROVIDERS, r.provider)) continue;
    const i = index.get(r.date);
    if (i === undefined) continue;
    const key = `${r.provider}\u0000${r.campaignId}`;
    let acc = accs.get(key);
    if (!acc) {
      const zeros = () => new Array<number>(dates.length).fill(0);
      acc = {
        provider: r.provider,
        name: r.campaignName ?? "",
        spend: zeros(),
        clicks: zeros(),
        impressions: zeros(),
        conversions: zeros(),
        total: 0,
        impr: 0,
      };
      accs.set(key, acc);
    }
    if (r.campaignName) acc.name = r.campaignName;
    acc.spend[i] += num(r.spend);
    acc.clicks[i] += num(r.clicks);
    acc.impressions[i] += num(r.impressions);
    acc.conversions[i] += num(r.conversions);
    acc.total += num(r.spend);
    acc.impr += num(r.impressions);
  }

  // --- GA4 and the shop's own sales, per date ---------------------------------
  const ga4 = new Map<string, { sessions: number; usersNew: number; usersReturning: number; engW: number; engS: number; revenue: number; transactions: number }>();
  for (const r of raw.ga4Days) {
    if (!ISO_DAY.test(r.date)) continue;
    const cur = ga4.get(r.date) ?? { sessions: 0, usersNew: 0, usersReturning: 0, engW: 0, engS: 0, revenue: 0, transactions: 0 };
    const s = num(r.sessions);
    cur.sessions += s;
    cur.usersNew += num(r.usersNew);
    cur.usersReturning += num(r.usersReturning);
    if (r.engagementRate != null && Number.isFinite(r.engagementRate)) {
      cur.engW += s * Math.min(1, Math.max(0, r.engagementRate));
      cur.engS += s;
    }
    cur.revenue += num(r.revenue);
    cur.transactions += num(r.transactions);
    ga4.set(r.date, cur);
  }
  const shop = new Map<string, { orders: number; revenue: number }>();
  for (const r of raw.shopSales) {
    if (!ISO_DAY.test(r.date)) continue;
    const cur = shop.get(r.date) ?? { orders: 0, revenue: 0 };
    cur.orders += num(r.orders);
    cur.revenue += num(r.revenue);
    shop.set(r.date, cur);
  }
  const windowSum = (m: Map<string, { revenue: number }>) =>
    dates.reduce((s, d) => s + (m.get(d)?.revenue ?? 0), 0);
  // GA4 revenue is what the live Sprzedaż tab reads; the shop's own feed
  // stands in when the property tracks no purchases.
  const revenueSource: RevenueSource = windowSum(ga4) > 0 ? "ga4" : windowSum(shop) > 0 ? "shop" : "none";
  const salesOn = (date: string): { orders: number; revenue: number } | null => {
    if (revenueSource === "ga4") {
      const g = ga4.get(date);
      return g && (g.revenue > 0 || g.transactions > 0) ? { orders: g.transactions, revenue: g.revenue } : null;
    }
    return revenueSource === "shop" ? shop.get(date) ?? null : null;
  };

  // --- the factors: drawn for this snapshot from the source's own totals --
  // Over the last 30 days: the demo's default range and the settings card's
  // KPIs. Only here, only in memory: never stored, logged or returned.
  const totals = { spend: 0, clicks: 0, revenue: 0, orders: 0, sessions: 0 };
  const from = dates.length - SHARE_WINDOW_DAYS;
  for (const a of accs.values()) {
    totals.spend += a.spend.slice(from).reduce((x, y) => x + y, 0);
    totals.clicks += a.clicks.slice(from).reduce((x, y) => x + y, 0);
  }
  for (const d of dates.slice(from)) {
    totals.sessions += ga4.get(d)?.sessions ?? 0;
    const sales = salesOn(d);
    totals.revenue += sales?.revenue ?? 0;
    totals.orders += sales?.orders ?? 0;
  }
  const f = drawFactors(totals, deps.random);
  const moneyOf = (v: unknown) => Math.round(num(v) * f.money);
  const spendOf = (v: unknown) => Math.round(num(v) * f.spend);
  const ordersOf = (v: unknown) => Math.round(num(v) * f.orders);
  const trafficOf = (v: unknown) => Math.round(num(v) * f.traffic);

  const campaigns: ProfileCampaign[] = [];
  for (const provider of PROFILE_PROVIDERS) {
    const list = Array.from(accs.values())
      .filter((a) => a.provider === provider && (a.total > 0 || a.impr > 0))
      .sort((a, b) => b.total - a.total || b.impr - a.impr);
    const keep = list.slice(0, MAX_CAMPAIGNS_PER_PROVIDER);
    const rest = list.slice(MAX_CAMPAIGNS_PER_PROVIDER);
    for (const a of keep) {
      campaigns.push({
        provider,
        type: campaignTypeOf(provider, a.name),
        market: normalizeCountry(deps.marketOf(a.name)),
        spend: a.spend.map(spendOf),
        clicks: a.clicks.map(trafficOf),
        impressions: a.impressions.map(trafficOf),
        conversions: a.conversions.map(ordersOf),
      });
    }
    if (rest.length > 0) {
      // The long tail as one campaign: totals stay right, no extra structure leaks.
      const sum = (pick: (a: CampaignAcc) => number[]) =>
        dates.map((_, i) => rest.reduce((s, a) => s + pick(a)[i], 0));
      campaigns.push({
        provider,
        type: "OTHER",
        market: null,
        spend: sum((a) => a.spend).map(spendOf),
        clicks: sum((a) => a.clicks).map(trafficOf),
        impressions: sum((a) => a.impressions).map(trafficOf),
        conversions: sum((a) => a.conversions).map(ordersOf),
      });
    }
  }

  const providerDay = (provider: ProfileProvider, i: number): ProfileAds => {
    const own = campaigns.filter((c) => c.provider === provider);
    return {
      spend: own.reduce((s, c) => s + c.spend[i], 0),
      clicks: own.reduce((s, c) => s + c.clicks[i], 0),
      impressions: own.reduce((s, c) => s + c.impressions[i], 0),
      conversions: own.reduce((s, c) => s + c.conversions[i], 0),
    };
  };

  const siteDay = (date: string) => {
    const g = ga4.get(date);
    const sales = salesOn(date);
    return {
      sessions: g ? trafficOf(g.sessions) : null,
      orders: sales ? ordersOf(sales.orders) : null,
      revenue: sales ? moneyOf(sales.revenue) : null,
      engagementRate: g && g.engS > 0 ? ratio(g.engW / g.engS) : null,
      newUsers: g ? trafficOf(g.usersNew) : null,
      returningUsers: g ? trafficOf(g.usersReturning) : null,
    };
  };

  const days: ProfileDay[] = dates.map((date, i) => ({
    date,
    meta: providerDay("meta_ads", i),
    google: providerDay("google_ads", i),
    ...siteDay(date),
  }));

  // --- last year: provider totals only -------------------------------------------
  const lyAds = new Map<string, { meta: ProfileAds; google: ProfileAds }>();
  for (const r of raw.adsLastYear) {
    if (!inList(PROFILE_PROVIDERS, r.provider) || r.date < lyStart || r.date > lyEnd) continue;
    const cur = lyAds.get(r.date) ?? {
      meta: { spend: 0, clicks: 0, impressions: 0, conversions: 0 },
      google: { spend: 0, clicks: 0, impressions: 0, conversions: 0 },
    };
    const t = r.provider === "meta_ads" ? cur.meta : cur.google;
    t.spend += num(r.spend);
    t.clicks += num(r.clicks);
    t.impressions += num(r.impressions);
    t.conversions += num(r.conversions);
    lyAds.set(r.date, cur);
  }
  const scaleAds = (a: ProfileAds): ProfileAds => ({
    spend: spendOf(a.spend),
    clicks: trafficOf(a.clicks),
    impressions: trafficOf(a.impressions),
    conversions: ordersOf(a.conversions),
  });
  const zeroAds = (): ProfileAds => ({ spend: 0, clicks: 0, impressions: 0, conversions: 0 });
  const lyDates = eachDay(lyStart, lyEnd);
  const lyHasAny = lyDates.some((d) => lyAds.has(d) || ga4.has(d) || shop.has(d));
  const lastYear: ProfileDay[] = lyHasAny
    ? lyDates.map((date) => {
        const a = lyAds.get(date);
        return {
          date,
          meta: a ? scaleAds(a.meta) : zeroAds(),
          google: a ? scaleAds(a.google) : zeroAds(),
          ...siteDay(date),
        };
      })
    : [];

  // --- shares over the last 30 days ----------------------------------------------
  const chan = new Map<string, { sessions: number; revenue: number; orders: number }>();
  for (const r of raw.ga4Sources) {
    const c = deps.channelOf(String(r.sourceMedium ?? ""));
    const key = inList(PROFILE_CHANNELS, c) ? c : "other";
    const cur = chan.get(key) ?? { sessions: 0, revenue: 0, orders: 0 };
    cur.sessions += num(r.sessions);
    cur.revenue += num(r.revenue);
    cur.orders += num(r.transactions);
    chan.set(key, cur);
  }
  const chanTotals = Array.from(chan.values()).reduce(
    (t, v) => ({ sessions: t.sessions + v.sessions, revenue: t.revenue + v.revenue, orders: t.orders + v.orders }),
    { sessions: 0, revenue: 0, orders: 0 }
  );
  const channels = PROFILE_CHANNELS.flatMap((channel) => {
    const v = chan.get(channel);
    if (!v || (v.sessions <= 0 && v.revenue <= 0)) return [];
    return [
      {
        channel,
        sessionsShare: share(v.sessions, chanTotals.sessions),
        revenueShare: share(v.revenue, chanTotals.revenue),
        ordersShare: share(v.orders, chanTotals.orders),
      },
    ];
  });

  const dev = new Map<ProfileDevice, number>();
  for (const r of raw.ga4Devices) {
    const d = String(r.device ?? "").trim().toLowerCase();
    if (!inList(PROFILE_DEVICES, d)) continue;
    dev.set(d, (dev.get(d) ?? 0) + num(r.sessions));
  }
  const devTotal = Array.from(dev.values()).reduce((a, b) => a + b, 0);
  const devices = PROFILE_DEVICES.flatMap((device) =>
    (dev.get(device) ?? 0) > 0 ? [{ device, share: share(dev.get(device) ?? 0, devTotal) }] : []
  );

  // Countries: the shop's own sales by market; else where the ad money goes.
  const inShare = (d: string) => d >= shareStart && d <= end;
  const byMarket = new Map<string, { orders: number; revenue: number }>();
  let shopRev = 0;
  let shopOrders = 0;
  for (const r of raw.shopSales) {
    if (!inShare(r.date)) continue;
    shopRev += num(r.revenue);
    shopOrders += num(r.orders);
    const m = normalizeCountry(r.market);
    if (!m) continue;
    const cur = byMarket.get(m) ?? { orders: 0, revenue: 0 };
    cur.orders += num(r.orders);
    cur.revenue += num(r.revenue);
    byMarket.set(m, cur);
  }
  let countriesBasis: DemoProfile["countriesBasis"] = "none";
  let countries: DemoProfile["countries"] = [];
  if (byMarket.size > 0 && shopRev > 0) {
    countriesBasis = "shop";
    countries = Array.from(byMarket.entries()).map(([country, v]) => ({
      country,
      revenueShare: share(v.revenue, shopRev),
      ordersShare: share(v.orders, shopOrders),
    }));
  } else {
    const spendBy = new Map<string, number>();
    let all = 0;
    for (const c of campaigns) {
      const s = c.spend.slice(dates.length - SHARE_WINDOW_DAYS).reduce((a, b) => a + b, 0);
      all += s;
      if (c.market) spendBy.set(c.market, (spendBy.get(c.market) ?? 0) + s);
    }
    if (spendBy.size > 0 && all > 0) {
      countriesBasis = "ads";
      countries = Array.from(spendBy.entries()).map(([country, s]) => ({
        country,
        revenueShare: share(s, all),
        ordersShare: share(s, all),
      }));
    }
  }
  countries.sort((a, b) => b.revenueShare - a.revenueShare || a.country.localeCompare(b.country));

  // Products by rank: GA4 items; else the shop's own product rows.
  const prod = new Map<string, { revenue: number; quantity: number }>();
  for (const r of raw.items) {
    const key = `${r.itemId}\u0000${r.itemName}`;
    const cur = prod.get(key) ?? { revenue: 0, quantity: 0 };
    cur.revenue += num(r.revenue);
    cur.quantity += num(r.quantity);
    prod.set(key, cur);
  }
  if (prod.size === 0) {
    for (const r of raw.shopSales) {
      if (!inShare(r.date) || !r.product) continue;
      const cur = prod.get(r.product) ?? { revenue: 0, quantity: 0 };
      cur.revenue += num(r.revenue);
      cur.quantity += num(r.orders);
      prod.set(r.product, cur);
    }
  }
  const prodRows = Array.from(prod.values()).filter((p) => p.revenue > 0);
  const prodRevenue = prodRows.reduce((a, p) => a + p.revenue, 0);
  const prodQty = prodRows.reduce((a, p) => a + p.quantity, 0);
  const products = prodRows
    .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity)
    .slice(0, MAX_PRODUCTS)
    .map((p) => ({ revenueShare: share(p.revenue, prodRevenue), quantityShare: share(p.quantity, prodQty) }));
  const shareDates = dates.filter(inShare);
  const salesInShare = shareDates.reduce((s, d) => {
    if (revenueSource === "ga4") return s + (ga4.get(d)?.revenue ?? 0);
    if (revenueSource === "shop") return s + (shop.get(d)?.revenue ?? 0);
    return s;
  }, 0);
  const productsCoverage = prodRevenue > 0 && salesInShare > 0 ? ratio(Math.min(1.5, prodRevenue / salesInShare)) : null;

  // Pages by rank: views per session and engagement only.
  const sessionsInShare = shareDates.reduce((s, d) => s + (ga4.get(d)?.sessions ?? 0), 0);
  const pages = raw.ga4Pages
    .filter((p) => num(p.views) > 0)
    .sort((a, b) => num(b.views) - num(a.views))
    .slice(0, MAX_PAGES)
    .map((p) => ({
      viewsPerSession: sessionsInShare > 0 ? ratio(num(p.views) / sessionsInShare) : 0,
      engagementRate: ratio(Math.min(1, Math.max(0, Number(p.engagementRate) || 0))),
    }));

  const profile: DemoProfile = {
    version: DEMO_PROFILE_VERSION,
    snapshotDate: end,
    createdAt: ISO_TIME.test(raw.createdAt) ? raw.createdAt : new Date(0).toISOString(),
    revenueSource,
    days,
    lastYear,
    campaigns,
    channels,
    devices,
    countriesBasis,
    countries,
    products,
    productsCoverage,
    pages,
  };
  assertDemoProfileClean(profile);
  return profile;
}

// ---- the leak check ------------------------------------------------------------------

const ALLOWED_KEYS = new Set([
  "version", "snapshotDate", "createdAt", "revenueSource", "days", "lastYear", "campaigns",
  "channels", "devices", "countriesBasis", "countries", "products", "productsCoverage", "pages",
  "date", "meta", "google", "sessions", "orders", "revenue", "engagementRate", "newUsers", "returningUsers",
  "spend", "clicks", "impressions", "conversions",
  "provider", "type", "market",
  "channel", "sessionsShare", "revenueShare", "ordersShare",
  "device", "share", "country", "quantityShare", "viewsPerSession",
]);

const ALLOWED_VALUES = new Set<string>([
  ...PROFILE_PROVIDERS,
  ...CAMPAIGN_TYPES,
  ...PROFILE_CHANNELS,
  ...PROFILE_DEVICES,
  ...PROFILE_COUNTRIES,
  ...REVENUE_SOURCES,
  ...COUNTRY_BASES,
]);

/**
 * Every string in the profile (values AND keys) that is not a date, a
 * timestamp or a whitelisted enum, plus every number that is not finite.
 * Empty for a clean profile.
 */
export function findForeignValues(value: unknown, path = "$"): string[] {
  if (value === null || typeof value === "boolean") return [];
  if (typeof value === "number") return Number.isFinite(value) ? [] : [`${path}: non-finite number`];
  if (typeof value === "string") {
    if (ISO_DAY.test(value) || ISO_TIME.test(value) || ALLOWED_VALUES.has(value)) return [];
    return [`${path}: ${JSON.stringify(value)}`];
  }
  if (Array.isArray(value)) return value.flatMap((v, i) => findForeignValues(v, `${path}[${i}]`));
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [
      ...(ALLOWED_KEYS.has(k) ? [] : [`${path}: key ${JSON.stringify(k)}`]),
      ...findForeignValues(v, `${path}.${k}`),
    ]);
  }
  return [`${path}: ${typeof value}`];
}

export function assertDemoProfileClean(profile: unknown): void {
  const foreign = findForeignValues(profile);
  // Never echo the values themselves: they are what must not leak.
  if (foreign.length > 0) throw new Error(`demo profile holds ${foreign.length} non-whitelisted value(s)`);
}

const isAds = (v: unknown): v is ProfileAds =>
  !!v && typeof v === "object" && ["spend", "clicks", "impressions", "conversions"].every((k) => typeof (v as Record<string, unknown>)[k] === "number");

const isDay = (v: unknown): v is ProfileDay =>
  !!v &&
  typeof v === "object" &&
  typeof (v as ProfileDay).date === "string" &&
  ISO_DAY.test((v as ProfileDay).date) &&
  isAds((v as ProfileDay).meta) &&
  isAds((v as ProfileDay).google);

/**
 * A stored or file profile, checked: the right version, the shape the demo
 * reads, consecutive days and nothing outside the whitelist. Null otherwise -
 * the demo then falls back to its synthetic shop.
 */
export function parseDemoProfile(value: unknown): DemoProfile | null {
  if (!value || typeof value !== "object") return null;
  const p = value as DemoProfile;
  if (p.version !== DEMO_PROFILE_VERSION || typeof p.snapshotDate !== "string" || !ISO_DAY.test(p.snapshotDate)) return null;
  if (!Array.isArray(p.days) || p.days.length < 14 || !p.days.every(isDay)) return null;
  if (!Array.isArray(p.lastYear) || !p.lastYear.every(isDay)) return null;
  if (p.days[p.days.length - 1].date !== p.snapshotDate) return null;
  for (let i = 1; i < p.days.length; i++) if (diffDays(p.days[i - 1].date, p.days[i].date) !== 1) return null;
  for (let i = 1; i < p.lastYear.length; i++) if (diffDays(p.lastYear[i - 1].date, p.lastYear[i].date) !== 1) return null;
  if (!Array.isArray(p.campaigns)) return null;
  for (const c of p.campaigns) {
    if (!inList(PROFILE_PROVIDERS, c.provider) || !inList(CAMPAIGN_TYPES, c.type)) return null;
    for (const k of ["spend", "clicks", "impressions", "conversions"] as const) {
      if (!Array.isArray(c[k]) || c[k].length !== p.days.length) return null;
    }
  }
  for (const k of ["channels", "devices", "countries", "products", "pages"] as const) {
    if (!Array.isArray(p[k])) return null;
  }
  if (findForeignValues(p).length > 0) return null;
  return p;
}
