import { campaignNames } from "@/lib/demo/brand";
import {
  addDaysIso,
  type CampaignType,
  type DemoProfile,
  type ProfileAds,
  type ProfileDay,
} from "@/lib/demo/profile/anonymize";
import type { ChannelKey } from "@/lib/ecom/channel";

// The one place the demo's numbers come from. Every /demo-full page (and
// /demo) reads its days, campaigns and shares from a DemoSource, so no two
// pages can show different numbers for the same day.
//
// Two kinds:
// - "profile": a real e-commerce client's anonymized recent weeks (lib/demo/
//   profile), shifted by whole weeks so its last full day lands on yesterday
//   (weekday patterns stay put). Days between the profile's end and today
//   carry the same weekday forward with the recent trend. Outside the
//   profile's windows there is no data - like a client whose history starts
//   there.
// - "synthetic": the fictional shop's own year (Black Friday peak, December
//   gifts, a TV season in June), a pure function of the date, used when no
//   profile is stored or it can't be read (local builds without a database).
//
// Either way today is a partial day (TODAY_PARTIAL of it synced), as in the
// live data, and the provider totals of a day are exactly the sums of its
// campaigns.

/** Fraction of today already "synced" - today is always a partial day. */
export const TODAY_PARTIAL = 0.42;
/** An older snapshot is not shown: the season's calendar would drift too far from its numbers. */
export const PROFILE_MAX_AGE_DAYS = 35;

export type DemoProvider = "meta_ads" | "google_ads";

export type DemoAds = ProfileAds;

export interface DemoDay {
  date: string;
  meta: DemoAds;
  google: DemoAds;
  spend: number; // grosze
  clicks: number;
  impressions: number;
  /** Purchases the ad platforms attribute to the ads. */
  conversions: number;
  sessions: number;
  orders: number;
  revenue: number; // grosze
  /** False when the shop's sales aren't known that day - not a zero. */
  hasSales: boolean;
  /** False when GA4 had nothing that day. */
  hasSite: boolean;
  /** 0..1 */
  engagementRate: number | null;
  newUsers: number;
  returningUsers: number;
}

export interface DemoCampaign {
  id: string;
  provider: DemoProvider;
  type: CampaignType;
  market: string | null;
  namePl: string;
  nameEn: string;
}

export interface DemoShares {
  channels: Array<{ channel: ChannelKey; sessionsShare: number; revenueShare: number; ordersShare: number }>;
  devices: Array<{ device: "desktop" | "mobile" | "tablet"; share: number }>;
  countries: Array<{ country: string; revenueShare: number; ordersShare: number }>;
  products: Array<{ revenueShare: number; quantityShare: number }>;
  /** Product revenue / shop revenue. */
  productsCoverage: number;
  pages: Array<{ viewsPerSession: number; engagementRate: number }>;
}

export interface DemoSource extends DemoShares {
  kind: "profile" | "synthetic";
  /** Warsaw yyyy-MM-dd. */
  today: string;
  campaigns: DemoCampaign[];
  /** A day as the sync would have it: undefined in the future or without data, today partial. */
  day(date: string): DemoDay | undefined;
  /** The whole day (today not cut short), for the month's plans. */
  fullDay(date: string): DemoDay | undefined;
  /** One campaign's day as synced (today partial); undefined without campaign data. */
  campaignDay(id: string, date: string): DemoAds | undefined;
  /** First day with campaign-level data. */
  campaignStart: string;
  /** First day with any data. */
  dataStart: string;
}

// ---- helpers ---------------------------------------------------------------------

const DAY_MS = 86_400_000;
const toTime = (s: string) => new Date(`${s}T00:00:00Z`).getTime();
export const diffDaysIso = (from: string, to: string) => Math.round((toTime(to) - toTime(from)) / DAY_MS);

/** Deterministic PRNG seeded from a string (FNV-1a + LCG). */
export function demoRng(key: string): () => number {
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

/** Split `total` by `weights` with largest remainders, so the parts add up exactly. */
export function splitExact(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, w) => a + Math.max(0, w), 0);
  if (sum <= 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * Math.max(0, w)) / sum);
  const parts = raw.map(Math.floor);
  let left = total - parts.reduce((a, v) => a + v, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0 && k < order.length; k++, left--) parts[order[k][1]] += 1;
  return parts;
}

const zeroAds = (): DemoAds => ({ spend: 0, clicks: 0, impressions: 0, conversions: 0 });
const addAds = (a: DemoAds, b: DemoAds): DemoAds => ({
  spend: a.spend + b.spend,
  clicks: a.clicks + b.clicks,
  impressions: a.impressions + b.impressions,
  conversions: a.conversions + b.conversions,
});
const mapAds = (a: DemoAds, f: (v: number) => number): DemoAds => ({
  spend: f(a.spend),
  clicks: f(a.clicks),
  impressions: f(a.impressions),
  conversions: f(a.conversions),
});
const part = (v: number) => Math.round(v * TODAY_PARTIAL);

/** Black Friday = the day after US Thanksgiving (4th Thursday of November). */
export function blackFridayOf(year: number): string {
  const dow = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  const firstThursday = 1 + ((4 - dow + 7) % 7);
  return new Date(Date.UTC(year, 10, firstThursday + 22)).toISOString().slice(0, 10);
}

interface Built {
  day: DemoDay;
  /** Campaign id -> its full day; empty where only provider totals exist. */
  camps: Map<string, DemoAds>;
}

function dayOf(date: string, meta: DemoAds, google: DemoAds, site: Omit<DemoDay, "date" | "meta" | "google" | "spend" | "clicks" | "impressions" | "conversions">): DemoDay {
  const t = addAds(meta, google);
  return { date, meta, google, spend: t.spend, clicks: t.clicks, impressions: t.impressions, conversions: t.conversions, ...site };
}

/** Wraps a full-day builder with the sync's view: nothing after today, today partial. */
function sourceFrom(
  base: Omit<DemoSource, "day" | "fullDay" | "campaignDay">,
  build: (date: string) => Built | undefined
): DemoSource {
  const full = new Map<string, Built | undefined>();
  const get = (date: string) => {
    if (!full.has(date)) full.set(date, build(date));
    return full.get(date);
  };
  const providerOf = new Map(base.campaigns.map((c) => [c.id, c.provider]));
  let todayCache: Built | undefined | null = null;
  const todayPartial = (): Built | undefined => {
    if (todayCache !== null) return todayCache;
    const b = get(base.today);
    if (!b) return (todayCache = undefined);
    const camps = new Map(Array.from(b.camps, ([id, a]) => [id, mapAds(a, part)] as const));
    const sumOf = (provider: DemoProvider, fallback: DemoAds) => {
      if (camps.size === 0) return mapAds(fallback, part);
      let t = zeroAds();
      camps.forEach((a, id) => {
        if (providerOf.get(id) === provider) t = addAds(t, a);
      });
      return t;
    };
    const d = b.day;
    todayCache = {
      camps,
      day: dayOf(d.date, sumOf("meta_ads", d.meta), sumOf("google_ads", d.google), {
        sessions: part(d.sessions),
        orders: part(d.orders),
        revenue: part(d.revenue),
        hasSales: d.hasSales,
        hasSite: d.hasSite,
        engagementRate: d.engagementRate,
        newUsers: part(d.newUsers),
        returningUsers: part(d.returningUsers),
      }),
    };
    return todayCache;
  };
  const synced = (date: string) => (date > base.today ? undefined : date === base.today ? todayPartial() : get(date));
  return {
    ...base,
    day: (date) => synced(date)?.day,
    fullDay: (date) => get(date)?.day,
    campaignDay: (id, date) => synced(date)?.camps.get(id),
  };
}

/** Names per campaign: rank within the same platform, type and market. */
function nameCampaigns<T extends { provider: DemoProvider; type: CampaignType; market: string | null }>(
  list: T[]
): Array<T & { namePl: string; nameEn: string }> {
  const seen = new Map<string, number>();
  return list.map((c) => {
    const key = `${c.provider}|${c.type}|${c.market ?? ""}`;
    const rank = seen.get(key) ?? 0;
    seen.set(key, rank + 1);
    const [namePl, nameEn] = campaignNames(c.provider, c.type, c.market, rank);
    return { ...c, namePl, nameEn };
  });
}

// ---- synthetic: the fictional shop's own year --------------------------------------

// Demand by calendar day for an electronics and home-appliance shop,
// straight lines between anchors: January clearance, a TV season in June
// (big tournaments), back to school, then the year's run - a November
// ramp into Black Friday, December gifts until the last deliveries before
// Christmas (~19 Dec), dead days, after-Christmas sales.
const ANCHORS: Array<[string, number]> = [
  ["01-01", 0.9], ["01-12", 1.0], ["01-31", 0.78], ["02-28", 0.74], ["04-15", 0.8], ["05-20", 0.88],
  ["06-12", 1.12], ["07-10", 0.95], ["08-05", 0.82], ["08-28", 0.96], ["09-20", 0.88], ["10-01", 0.95],
  ["10-20", 1.08], ["11-01", 1.25], ["11-15", 1.55], ["11-26", 1.85], ["12-01", 1.7], ["12-08", 1.85],
  ["12-15", 1.8], ["12-19", 1.45], ["12-22", 0.9], ["12-24", 0.35], ["12-26", 0.4], ["12-28", 0.9],
  ["12-31", 0.7],
];
// Big-ticket buys get researched over the weekend and ordered early in the
// week; Saturday is the quiet day.
const WEEKDAY = [1.02, 1.08, 1.05, 1.02, 1.0, 0.95, 0.88]; // Sun..Sat
const GROWTH_ANCHOR = "2026-10-01";
const YEARLY_GROWTH = 1.12;

function anchorDemand(date: string): number {
  const md = date.slice(5);
  const y = date.slice(0, 4);
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const [a, av] = ANCHORS[i];
    const [b, bv] = ANCHORS[i + 1];
    if (md >= a && md <= b) {
      const t = diffDaysIso(`${y}-${a}`, date) / Math.max(1, diffDaysIso(`${y}-${a}`, `${y}-${b}`));
      return av + (bv - av) * t;
    }
  }
  return ANCHORS[ANCHORS.length - 1][1];
}

function bfBoost(date: string): number {
  const fromBf = diffDaysIso(blackFridayOf(Number(date.slice(0, 4))), date);
  const boost: Record<number, number> = { [-1]: 1.3, 0: 2.1, 1: 1.45, 2: 1.25, 3: 1.6 };
  return boost[fromBf] ?? 1;
}

interface SynthCampaign {
  id: string;
  provider: DemoProvider;
  type: CampaignType;
  market: string | null;
  weight: number;
  /** Relative cost per click, click-through rate and purchases per click. */
  cpc: number;
  ctr: number;
  conv: number;
  /** "MM-DD" window the campaign runs in each year (inclusive); all year without. */
  from?: string;
  to?: string;
  /** A budget push for part of the season. */
  boost?: { from: string; to: string; x: number };
}

// Names come from lib/demo/brand.ts by rank within platform, type and
// market, so this order decides them: PL PMAX = Telewizory, Duże AGD, Black
// Friday; PL Search = Marka, Telewizory 4K; Meta PL Prospecting = Promocje
// sezonu, Black Friday, Prezenty świąteczne...
const SYNTH_CAMPAIGNS: SynthCampaign[] = [
  { id: "d-g1", provider: "google_ads", type: "PMAX", market: "PL", weight: 0.26, cpc: 1, ctr: 0.8, conv: 1 },
  { id: "d-g2", provider: "google_ads", type: "PMAX", market: "PL", weight: 0.2, cpc: 1.1, ctr: 0.75, conv: 0.9 },
  { id: "d-g3", provider: "google_ads", type: "PMAX", market: "PL", weight: 0.24, cpc: 1.05, ctr: 0.8, conv: 1.05, from: "11-06", to: "12-02", boost: { from: "11-24", to: "12-01", x: 1.8 } },
  { id: "d-g4", provider: "google_ads", type: "SEARCH", market: "PL", weight: 0.09, cpc: 0.45, ctr: 4, conv: 1.9 },
  { id: "d-g5", provider: "google_ads", type: "SEARCH", market: "PL", weight: 0.07, cpc: 1.15, ctr: 2.2, conv: 1.1 },
  { id: "d-g6", provider: "google_ads", type: "SHOPPING", market: "PL", weight: 0.11, cpc: 0.9, ctr: 0.9, conv: 1 },
  { id: "d-g7", provider: "google_ads", type: "PMAX", market: "CZ", weight: 0.06, cpc: 0.85, ctr: 0.8, conv: 0.9 },
  { id: "d-g8", provider: "google_ads", type: "PMAX", market: "SK", weight: 0.04, cpc: 0.8, ctr: 0.85, conv: 0.9, from: "10-15", to: "12-20" },
  { id: "d-m1", provider: "meta_ads", type: "PROSPECTING", market: "PL", weight: 0.28, cpc: 1, ctr: 1, conv: 0.9 },
  { id: "d-m2", provider: "meta_ads", type: "PROSPECTING", market: "PL", weight: 0.32, cpc: 1.05, ctr: 1.05, conv: 0.95, from: "11-03", to: "12-02", boost: { from: "11-23", to: "12-01", x: 1.7 } },
  { id: "d-m3", provider: "meta_ads", type: "PROSPECTING", market: "PL", weight: 0.16, cpc: 1.1, ctr: 0.95, conv: 0.85, from: "11-20", to: "12-21" },
  { id: "d-m4", provider: "meta_ads", type: "RETARGETING", market: "PL", weight: 0.14, cpc: 1.4, ctr: 1.6, conv: 2.6 },
  { id: "d-m5", provider: "meta_ads", type: "CATALOG", market: "PL", weight: 0.16, cpc: 1.1, ctr: 1.25, conv: 1.7 },
  { id: "d-m6", provider: "meta_ads", type: "PROSPECTING", market: "CZ", weight: 0.08, cpc: 0.8, ctr: 1.05, conv: 0.8 },
];

export const SYNTHETIC_SHARES: DemoShares = {
  channels: [
    { channel: "google_ads", sessionsShare: 0.34, revenueShare: 0.37, ordersShare: 0.36 },
    { channel: "meta", sessionsShare: 0.2, revenueShare: 0.12, ordersShare: 0.13 },
    { channel: "organic_search", sessionsShare: 0.2, revenueShare: 0.22, ordersShare: 0.22 },
    { channel: "direct", sessionsShare: 0.13, revenueShare: 0.16, ordersShare: 0.16 },
    { channel: "email", sessionsShare: 0.04, revenueShare: 0.07, ordersShare: 0.07 },
    { channel: "social_organic", sessionsShare: 0.04, revenueShare: 0.02, ordersShare: 0.02 },
    { channel: "other", sessionsShare: 0.05, revenueShare: 0.04, ordersShare: 0.04 },
  ],
  devices: [
    { device: "mobile", share: 0.62 },
    { device: "desktop", share: 0.34 },
    { device: "tablet", share: 0.04 },
  ],
  countries: [
    { country: "PL", revenueShare: 0.82, ordersShare: 0.83 },
    { country: "CZ", revenueShare: 0.08, ordersShare: 0.08 },
    { country: "SK", revenueShare: 0.05, ordersShare: 0.05 },
    { country: "LT", revenueShare: 0.03, ordersShare: 0.025 },
    { country: "LV", revenueShare: 0.02, ordersShare: 0.015 },
  ],
  products: [0.17, 0.12, 0.1, 0.085, 0.08, 0.065, 0.055, 0.05, 0.045, 0.04].map((s) => ({ revenueShare: s, quantityShare: s })),
  productsCoverage: 0.95,
  pages: [
    { viewsPerSession: 0.5, engagementRate: 0.55 },
    { viewsPerSession: 0.34, engagementRate: 0.68 },
    { viewsPerSession: 0.27, engagementRate: 0.66 },
    { viewsPerSession: 0.16, engagementRate: 0.71 },
    { viewsPerSession: 0.09, engagementRate: 0.74 },
  ],
};

const inWindow = (md: string, from?: string, to?: string) => (!from || md >= from) && (!to || md <= to);

export function syntheticSource(today: string): DemoSource {
  const campaigns = nameCampaigns(SYNTH_CAMPAIGNS);
  const build = (date: string): Built => {
    const r = demoRng(`demo-shop:${date}`);
    const weekday = WEEKDAY[new Date(`${date}T12:00:00Z`).getUTCDay()];
    const season = anchorDemand(date) * bfBoost(date);
    const demand = season * weekday;
    const growth = YEARLY_GROWTH ** (diffDaysIso(GROWTH_ANCHOR, date) / 365);
    const md = date.slice(5);
    const bf = bfBoost(date) > 1;

    const revenue = 46_000_00 * demand * growth * jitter(r, 0.08);
    // Gifts in December are smaller (headphones, coffee machines); June's
    // TV season and the clearance of big appliances lift the basket.
    const aovMix = md >= "12-01" && md <= "12-20" ? 0.94 : bf ? 0.92 : md >= "06-01" && md <= "06-30" ? 1.08 : 1;
    const aov = 880_00 * aovMix * jitter(r, 0.05);
    const orders = Math.max(1, Math.round(revenue / aov));
    const cr = 0.0095 * Math.pow(season, 0.12) * (bf ? 1.2 : 1) * jitter(r, 0.06);
    const sessions = Math.round(orders / cr);
    // Spend follows the season, flatter than sales and barely by weekday:
    // that's why ROAS climbs on Black Friday and in December.
    const spend = Math.round(6_300_00 * Math.pow(season, 0.85) * Math.sqrt(weekday) * growth * jitter(r, 0.06));
    const metaSpend = Math.round(spend * 0.36 * jitter(r, 0.04));
    const totals = {
      meta_ads: {
        spend: metaSpend,
        clicks: 0,
        impressions: 0,
        conversions: Math.round(orders * 0.3 * jitter(r, 0.08)),
        cpc: 1_45 * Math.pow(season, 0.1) * jitter(r, 0.05),
        ctr: 0.012 * jitter(r, 0.06),
      },
      google_ads: {
        spend: spend - metaSpend,
        clicks: 0,
        impressions: 0,
        conversions: Math.round(orders * 0.46 * jitter(r, 0.08)),
        cpc: 2_25 * Math.pow(season, 0.12) * jitter(r, 0.05),
        ctr: 0.026 * jitter(r, 0.06),
      },
    };
    const camps = new Map<string, DemoAds>();
    const sums: Record<DemoProvider, DemoAds> = { meta_ads: zeroAds(), google_ads: zeroAds() };
    for (const provider of ["meta_ads", "google_ads"] as const) {
      const t = totals[provider];
      t.clicks = Math.round(t.spend / t.cpc);
      t.impressions = Math.round(t.clicks / t.ctr);
      const live = SYNTH_CAMPAIGNS.filter((c) => c.provider === provider && inWindow(md, c.from, c.to));
      const w = live.map((c) => c.weight * (c.boost && inWindow(md, c.boost.from, c.boost.to) ? c.boost.x : 1));
      const spendW = live.map((c, i) => w[i] * jitter(demoRng(`demo-camp:${c.id}:${date}`), 0.1));
      const clickW = live.map((c, i) => spendW[i] / c.cpc);
      const spends = splitExact(t.spend, spendW);
      const clicks = splitExact(t.clicks, clickW);
      const impressions = splitExact(t.impressions, live.map((c, i) => clickW[i] / c.ctr));
      const conversions = splitExact(t.conversions, live.map((c, i) => clickW[i] * c.conv));
      live.forEach((c, i) => {
        const a = { spend: spends[i], clicks: clicks[i], impressions: impressions[i], conversions: conversions[i] };
        camps.set(c.id, a);
        sums[provider] = addAds(sums[provider], a);
      });
    }
    return {
      camps,
      day: dayOf(date, sums.meta_ads, sums.google_ads, {
        sessions,
        orders,
        revenue: Math.round(revenue),
        hasSales: true,
        hasSite: true,
        engagementRate: Math.round(0.62 * jitter(r, 0.04) * 1000) / 1000,
        newUsers: Math.round(sessions * 0.55),
        returningUsers: Math.round(sessions * 0.24),
      }),
    };
  };
  // Records look back 25 months; nothing in the model ends.
  const start = addDaysIso(today, -800);
  return sourceFrom(
    {
      kind: "synthetic",
      today,
      campaigns: campaigns.map(({ id, provider, type, market, namePl, nameEn }) => ({ id, provider, type, market, namePl, nameEn })),
      campaignStart: start,
      dataStart: start,
      ...SYNTHETIC_SHARES,
    },
    (date) => (date < start ? undefined : build(date))
  );
}

// ---- profile: a real shop's weeks, shifted -------------------------------------------

export function profileSource(p: DemoProfile, today: string): DemoSource {
  const yesterday = addDaysIso(today, -1);
  // Whole weeks only, so a Monday stays a Monday.
  const offset = Math.floor(diffDaysIso(p.snapshotDate, yesterday) / 7) * 7;
  const firstThis = addDaysIso(p.days[0].date, offset);
  const lastThis = addDaysIso(p.snapshotDate, offset);
  const firstLy = p.lastYear.length ? addDaysIso(p.lastYear[0].date, offset) : null;

  const campaigns = nameCampaigns(
    p.campaigns.map((c, i) => ({
      id: `d-${c.provider === "meta_ads" ? "m" : "g"}${i + 1}`,
      provider: c.provider,
      type: c.type,
      market: c.market,
      src: c,
    }))
  );

  // The trend the gap days carry forward: last 7 days vs the 7 before.
  const n = p.days.length;
  const sumDays = (from: number, to: number, pick: (d: ProfileDay) => number) =>
    p.days.slice(from, to).reduce((a, d) => a + pick(d), 0);
  const spendRatio =
    sumDays(n - 14, n - 7, (d) => d.meta.spend + d.google.spend) > 0
      ? sumDays(n - 7, n, (d) => d.meta.spend + d.google.spend) / sumDays(n - 14, n - 7, (d) => d.meta.spend + d.google.spend)
      : 1;
  const revRatio =
    sumDays(n - 14, n - 7, (d) => d.revenue ?? 0) > 0
      ? sumDays(n - 7, n, (d) => d.revenue ?? 0) / sumDays(n - 14, n - 7, (d) => d.revenue ?? 0)
      : spendRatio;
  const trend = Math.min(1.2, Math.max(0.85, Math.sqrt(spendRatio * revRatio)));
  const grow = (v: number) => Math.round(v * trend);

  const siteOf = (d: ProfileDay) => ({
    sessions: d.sessions ?? 0,
    orders: d.orders ?? 0,
    revenue: d.revenue ?? 0,
    hasSales: d.revenue !== null && d.orders !== null,
    hasSite: d.sessions !== null,
    engagementRate: d.engagementRate,
    newUsers: d.newUsers ?? 0,
    returningUsers: d.returningUsers ?? 0,
  });

  const build = (date: string): Built | undefined => {
    if (date >= firstThis) {
      if (date > lastThis) {
        // Between the snapshot's end and today: the same weekday a week
        // earlier, carried forward with the recent trend.
        if (date > today) return undefined;
        const prev = build(addDaysIso(date, -7));
        if (!prev) return undefined;
        const camps = new Map(Array.from(prev.camps, ([id, a]) => [id, mapAds(a, grow)] as const));
        const sum = (provider: DemoProvider) =>
          campaigns.filter((c) => c.provider === provider).reduce((t, c) => addAds(t, camps.get(c.id) ?? zeroAds()), zeroAds());
        const s = prev.day;
        return {
          camps,
          day: dayOf(date, sum("meta_ads"), sum("google_ads"), {
            sessions: grow(s.sessions),
            orders: grow(s.orders),
            revenue: grow(s.revenue),
            hasSales: s.hasSales,
            hasSite: s.hasSite,
            engagementRate: s.engagementRate,
            newUsers: grow(s.newUsers),
            returningUsers: grow(s.returningUsers),
          }),
        };
      }
      const i = diffDaysIso(firstThis, date);
      const camps = new Map<string, DemoAds>();
      for (const c of campaigns) {
        camps.set(c.id, {
          spend: c.src.spend[i],
          clicks: c.src.clicks[i],
          impressions: c.src.impressions[i],
          conversions: c.src.conversions[i],
        });
      }
      const d = p.days[i];
      return { camps, day: dayOf(date, { ...d.meta }, { ...d.google }, siteOf(d)) };
    }
    if (firstLy && date >= firstLy) {
      const d = p.lastYear[diffDaysIso(firstLy, date)];
      if (!d) return undefined;
      return { camps: new Map(), day: dayOf(date, { ...d.meta }, { ...d.google }, siteOf(d)) };
    }
    return undefined;
  };

  const products = p.products.length ? p.products : SYNTHETIC_SHARES.products;
  return sourceFrom(
    {
      kind: "profile",
      today,
      campaigns: campaigns.map(({ id, provider, type, market, namePl, nameEn }) => ({ id, provider, type, market, namePl, nameEn })),
      campaignStart: firstThis,
      dataStart: firstLy ?? firstThis,
      channels: p.channels.length ? p.channels : SYNTHETIC_SHARES.channels,
      devices: p.devices.length ? p.devices : SYNTHETIC_SHARES.devices,
      countries: p.countries.length ? p.countries : SYNTHETIC_SHARES.countries.filter((c) => c.country === "PL").map((c) => ({ ...c, revenueShare: 1, ordersShare: 1 })),
      products,
      productsCoverage: p.productsCoverage ?? SYNTHETIC_SHARES.productsCoverage,
      pages: p.pages.length ? p.pages : SYNTHETIC_SHARES.pages,
    },
    build
  );
}

/**
 * The profile when it is fresh enough to show, else the synthetic shop.
 * `anyAge`: the local dev file, which is meant to be shifted forever.
 */
export function demoSourceFor(profile: DemoProfile | null, today: string, anyAge = false): DemoSource {
  if (profile && (anyAge || diffDaysIso(profile.snapshotDate, today) <= PROFILE_MAX_AGE_DAYS)) {
    return profileSource(profile, today);
  }
  return syntheticSource(today);
}

// ---- sums -----------------------------------------------------------------------------

/** Sum over [start, end] of the synced days (today partial); days without data are skipped. */
export function sumDays(
  src: DemoSource,
  start: string,
  end: string,
  pick: (d: DemoDay) => number,
  only: (d: DemoDay) => boolean = () => true
): { total: number; daysWithData: number; days: number } {
  let total = 0;
  let daysWithData = 0;
  const days = Math.max(0, diffDaysIso(start, end) + 1);
  for (let i = 0; i < days; i++) {
    const d = src.day(addDaysIso(start, i));
    if (d && only(d)) {
      total += pick(d);
      daysWithData += 1;
    }
  }
  return { total, daysWithData, days };
}
