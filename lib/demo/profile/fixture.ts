// A made-up source shop for local work on the demo profile: raw rows as the
// snapshot action would read them from Supabase - full of campaign names,
// product names, SKUs, page paths and URLs - for a seasonal shop ramping up
// from early October in five markets. Nothing here is any real client's:
// names and numbers are invented, and the unit test feeds these rows to the
// anonymizer to prove none of the strings survive.
//
// Pure and import-free at runtime (the tests run it under type stripping).
// lib/demo/profile/dev-profile.json is buildDemoProfile(fakeRawSource()) -
// the profile `DEMO_PROFILE_FILE` points the demo at in local development
// (see lib/demo/profile/store.ts). To rebuild it, run under plain `node`:
//   buildDemoProfile(fakeRawSource("2026-11-15"), { marketOf, channelOf, random })
// with marketOf from lib/season/markets.ts, channelOf from lib/ecom/channel.ts
// and a node:crypto random, and write the JSON next to this file.

import type { RawSource } from "./anonymize";

const DAY_MS = 86_400_000;
const toTime = (s: string) => new Date(`${s}T00:00:00Z`).getTime();
const addDays = (s: string, n: number) => new Date(toTime(s) + n * DAY_MS).toISOString().slice(0, 10);

/** Deterministic noise around 1. */
function noise(key: string, spread: number): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const r = ((Math.imul(h >>> 0, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  return 1 - spread + r * spread * 2;
}

/** Black Friday = the day after the 4th Thursday of November. */
function blackFriday(year: number): string {
  const dow = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  const firstThursday = 1 + ((4 - dow + 7) % 7);
  return new Date(Date.UTC(year, 10, firstThursday + 22)).toISOString().slice(0, 10);
}

// Demand by calendar day, straight lines between anchors: flat until
// October, a ramp through November, the December peak around St Nicholas,
// the last parcels before Christmas, then quiet.
const ANCHORS: Array<[string, number]> = [
  ["01-01", 0.85], ["01-15", 0.8], ["08-31", 0.9], ["09-15", 1.0], ["10-01", 1.15], ["10-15", 1.45],
  ["11-01", 1.95], ["11-15", 2.6], ["11-26", 3.1], ["12-01", 3.5], ["12-06", 4.3], ["12-12", 4.1],
  ["12-17", 3.7], ["12-20", 1.7], ["12-23", 0.9], ["12-25", 0.35], ["12-27", 0.65], ["12-31", 0.8],
];

function demand(date: string): number {
  const md = date.slice(5);
  let v = ANCHORS[ANCHORS.length - 1][1];
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const [a, av] = ANCHORS[i];
    const [b, bv] = ANCHORS[i + 1];
    if (md >= a && md <= b) {
      const y = date.slice(0, 4);
      const t = (toTime(`${y}-${md}`) - toTime(`${y}-${a}`)) / Math.max(1, toTime(`${y}-${b}`) - toTime(`${y}-${a}`));
      v = av + (bv - av) * t;
      break;
    }
  }
  const bf = blackFriday(Number(date.slice(0, 4)));
  const fromBf = Math.round((toTime(date) - toTime(bf)) / DAY_MS);
  const bfBoost: Record<number, number> = { [-1]: 1.3, 0: 1.8, 1: 1.35, 2: 1.2, 3: 1.5 };
  const week = [1.04, 1.12, 1.08, 1.02, 0.97, 0.9, 0.86][new Date(`${date}T12:00:00Z`).getUTCDay()];
  return v * (bfBoost[fromBf] ?? 1) * week;
}

interface FakeCampaign {
  id: string;
  name: string;
  provider: "meta_ads" | "google_ads";
  weight: number;
  cpc: number; // grosze
  ctr: number;
  cvr: number; // platform-attributed purchases per click
  /** "MM-DD" the campaign runs from each year. */
  from?: string;
}

// Names written the way agencies write them, with fake brand words and URLs
// in them on purpose: the anonymizer must keep none of it.
const CAMPAIGNS: FakeCampaign[] = [
  { id: "1840021", name: "PL | PMax | Bestsellery | sklep-fikcyjny.example", provider: "google_ads", weight: 0.3, cpc: 1_45, ctr: 0.016, cvr: 0.032 },
  { id: "1840022", name: "PL - Search - Brand Fikcyjna Marka", provider: "google_ads", weight: 0.1, cpc: 62, ctr: 0.12, cvr: 0.08 },
  { id: "1840023", name: "DE | PMax | Weihnachtsdeko Fikcyjna", provider: "google_ads", weight: 0.14, cpc: 1_95, ctr: 0.014, cvr: 0.026, from: "10-08" },
  { id: "1840024", name: "CZ | PMax | Vánoce", provider: "google_ads", weight: 0.08, cpc: 1_10, ctr: 0.017, cvr: 0.03 },
  { id: "1840025", name: "SK | Shopping | feed https://feed.example/sk.xml", provider: "google_ads", weight: 0.05, cpc: 1_05, ctr: 0.015, cvr: 0.028 },
  { id: "1840026", name: "PL | Search | Fikcyjny Produkt Premium 24 szt.", provider: "google_ads", weight: 0.07, cpc: 1_30, ctr: 0.065, cvr: 0.04, from: "10-20" },
  { id: "1840027", name: "LT | PMax | Kalėdos", provider: "google_ads", weight: 0.03, cpc: 95, ctr: 0.016, cvr: 0.025, from: "10-28" },
  { id: "1840028", name: "PL | YT | brand video Jan Kowalski", provider: "google_ads", weight: 0.015, cpc: 40, ctr: 0.006, cvr: 0.004 },
  { id: "1840029", name: "PL | DSA | test / old", provider: "google_ads", weight: 0.01, cpc: 1_20, ctr: 0.04, cvr: 0.02 },
  { id: "1840030", name: "zz_archive_2024_promo_FIKCJA", provider: "google_ads", weight: 0.006, cpc: 1_30, ctr: 0.02, cvr: 0.02 },
  { id: "23850001", name: "PL | Prospecting | Broad | Święta 2026 | Fikcyjna Marka", provider: "meta_ads", weight: 0.3, cpc: 88, ctr: 0.013, cvr: 0.014 },
  { id: "23850002", name: "PL | Retargeting | Koszyk 14d", provider: "meta_ads", weight: 0.14, cpc: 1_25, ctr: 0.022, cvr: 0.045 },
  { id: "23850003", name: "PL | Catalog | DPA wszystkie produkty", provider: "meta_ads", weight: 0.16, cpc: 95, ctr: 0.017, cvr: 0.03 },
  { id: "23850004", name: "DE | Prospecting | LAL 3% Käufer", provider: "meta_ads", weight: 0.13, cpc: 1_30, ctr: 0.011, cvr: 0.012, from: "10-15" },
  { id: "23850005", name: "CZ | Prospecting | Zájmy domov", provider: "meta_ads", weight: 0.08, cpc: 70, ctr: 0.014, cvr: 0.013 },
  { id: "23850006", name: "SK | Advantage+ Shopping", provider: "meta_ads", weight: 0.06, cpc: 75, ctr: 0.015, cvr: 0.016 },
  { id: "23850007", name: "PL | Engagement | Konkurs @fikcyjna.marka", provider: "meta_ads", weight: 0.03, cpc: 35, ctr: 0.02, cvr: 0.002 },
  { id: "23850008", name: "PL | Prospecting | Kobiety 25-54 | Kolekcja Fikcja", provider: "meta_ads", weight: 0.07, cpc: 92, ctr: 0.012, cvr: 0.013, from: "10-05" },
  { id: "23850009", name: "Boost: post 12.11 https://instagram.example/p/xyz", provider: "meta_ads", weight: 0.008, cpc: 30, ctr: 0.02, cvr: 0 },
  { id: "23850010", name: "TEST kreacja AB v2", provider: "meta_ads", weight: 0.006, cpc: 90, ctr: 0.012, cvr: 0.01 },
];

const SOURCES: Array<[string, number, number]> = [
  // [source / medium, sessions share, revenue share]
  ["google / cpc", 0.31, 0.34],
  ["facebook / paid", 0.2, 0.15],
  ["instagram / paid", 0.07, 0.05],
  ["google / organic", 0.16, 0.18],
  ["(direct) / (none)", 0.11, 0.13],
  ["newsletter / email", 0.04, 0.08],
  ["l.facebook.com / referral", 0.04, 0.02],
  ["pinterest.example / referral", 0.03, 0.02],
  ["porownywarka.example / referral", 0.04, 0.03],
];

const PRODUCTS: Array<[string, string, number, number]> = [
  // [SKU, name, price grosze, revenue share]
  ["FK-1001", "Fikcyjna Marka – produkt A 300 g", 59_00, 0.14],
  ["FK-1002", "Zestaw B – 24 sztuki (sklep-fikcyjny.example)", 149_00, 0.12],
  ["FK-1003", "Produkt C LED 20 szt.", 79_00, 0.1],
  ["FK-1004", "Produkt D 150x200 – czerwony", 129_00, 0.09],
  ["FK-1005", "Zestaw E 12 szt. – złoty", 99_00, 0.07],
  ["FK-1006", "Produkt F Zimowy 100 ml", 69_00, 0.06],
  ["FK-1007", "Zestaw prezentowy G dla Niej", 189_00, 0.05],
  ["FK-1008", "Produkt H 3-pak", 49_00, 0.04],
  ["FK-1009", "Produkt I LED 60 cm", 119_00, 0.035],
  ["FK-1010", "Produkt J z imieniem", 45_00, 0.03],
  ["FK-1011", "Bon podarunkowy 200 zł", 200_00, 0.02],
];

const MARKETS: Array<[string, number]> = [
  ["PL", 0.68],
  ["DE", 0.13],
  ["CZ", 0.09],
  ["SK", 0.06],
  ["LT", 0.03],
  ["", 0.01],
];

/** The fake shop's raw rows for a snapshot taken after `snapshotDate`. */
export function fakeRawSource(snapshotDate = "2026-11-15"): RawSource {
  const start = addDays(snapshotDate, -62);
  const lyStart = addDays(start, -364);
  const lyEnd = addDays(snapshotDate, -364 + 49);
  const ads: RawSource["ads"] = [];
  const adsLastYear: RawSource["adsLastYear"] = [];
  const ga4Days: RawSource["ga4Days"] = [];
  const shopSales: RawSource["shopSales"] = [];

  const dayRows = (date: string, lastYear: boolean) => {
    const growth = lastYear ? 0.8 : 1;
    const d = demand(date) * growth;
    const spendTotal = 4_200_00 * Math.pow(d, 0.85);
    const md = date.slice(5);
    // Christmas-only campaigns run 1 Oct - 22 Dec; the rest all year.
    const live = CAMPAIGNS.filter((c) => !c.from || (md >= c.from && md <= "12-22"));
    const weightSum = live.reduce((s, c) => s + c.weight, 0);
    const totals = { meta_ads: { spend: 0, clicks: 0, impressions: 0, conversions: 0 }, google_ads: { spend: 0, clicks: 0, impressions: 0, conversions: 0 } };
    for (const c of live) {
      const spend = Math.round((spendTotal * c.weight * noise(`${c.id}:${date}:s`, 0.12)) / weightSum);
      const clicks = Math.round((spend / c.cpc) * noise(`${c.id}:${date}:c`, 0.06));
      const impressions = Math.round(clicks / (c.ctr * noise(`${c.id}:${date}:i`, 0.08)));
      const conversions = Math.round(clicks * c.cvr * Math.pow(d, 0.2) * noise(`${c.id}:${date}:v`, 0.15));
      if (lastYear) {
        const t = totals[c.provider];
        t.spend += spend;
        t.clicks += clicks;
        t.impressions += impressions;
        t.conversions += conversions;
      } else {
        ads.push({ provider: c.provider, campaignId: c.id, campaignName: c.name, date, spend, clicks, impressions, conversions });
      }
    }
    if (lastYear) {
      for (const provider of ["meta_ads", "google_ads"] as const) adsLastYear.push({ provider, date, ...totals[provider] });
    }
    const roas = 5.8 * Math.pow(d, 0.18);
    const revenue = Math.round(spendTotal * roas * noise(`rev:${date}`, 0.08));
    const aov = 172_00 * noise(`aov:${date}`, 0.05);
    const transactions = Math.max(1, Math.round(revenue / aov));
    const sessions = Math.round(transactions / (0.016 * Math.pow(d, 0.15) * noise(`cr:${date}`, 0.06)));
    ga4Days.push({
      date,
      sessions,
      usersNew: Math.round(sessions * 0.58),
      usersReturning: Math.round(sessions * 0.21),
      engagementRate: 0.61 * noise(`eng:${date}`, 0.04),
      revenue,
      transactions,
    });
    // The shop's own feed: per market, a little above GA4 (GA4 misses some orders).
    for (const [market, s] of MARKETS) {
      shopSales.push({
        date,
        market,
        product: "",
        orders: Math.round(transactions * 1.06 * s),
        revenue: Math.round(revenue * 1.04 * s),
      });
    }
  };
  for (let d = lyStart; d <= lyEnd; d = addDays(d, 1)) dayRows(d, true);
  for (let d = start; d <= snapshotDate; d = addDays(d, 1)) dayRows(d, false);

  const window = ga4Days.filter((g) => g.date > addDays(snapshotDate, -30) && g.date <= snapshotDate);
  const sessions30 = window.reduce((s, g) => s + g.sessions, 0);
  const revenue30 = window.reduce((s, g) => s + (g.revenue ?? 0), 0);
  const orders30 = window.reduce((s, g) => s + (g.transactions ?? 0), 0);

  return {
    snapshotDate,
    createdAt: `${addDays(snapshotDate, 1)}T07:42:11.000Z`,
    ads,
    adsLastYear,
    ga4Days,
    ga4Sources: SOURCES.map(([sourceMedium, s, r]) => ({
      sourceMedium,
      sessions: Math.round(sessions30 * s),
      revenue: Math.round(revenue30 * r),
      transactions: Math.round(orders30 * r * 0.97),
    })),
    ga4Devices: [
      { device: "mobile", sessions: Math.round(sessions30 * 0.69) },
      { device: "desktop", sessions: Math.round(sessions30 * 0.27) },
      { device: "tablet", sessions: Math.round(sessions30 * 0.035) },
      { device: "smart tv", sessions: Math.round(sessions30 * 0.005) },
    ],
    ga4Pages: [
      { path: "/", views: Math.round(sessions30 * 0.52), engagementRate: 0.55 },
      { path: "/kategoria/swieta-fikcyjna-marka", views: Math.round(sessions30 * 0.31), engagementRate: 0.66 },
      { path: "/produkt/zestaw-b-24?utm_source=fikcja", views: Math.round(sessions30 * 0.17), engagementRate: 0.72 },
      { path: "/kategoria/produkty-c", views: Math.round(sessions30 * 0.14), engagementRate: 0.63 },
      { path: "/koszyk", views: Math.round(sessions30 * 0.09), engagementRate: 0.81 },
      { path: "/blog/poradnik-fikcyjny", views: Math.round(sessions30 * 0.05), engagementRate: 0.58 },
    ],
    items: PRODUCTS.map(([itemId, itemName, price, s]) => {
      const revenue = Math.round(revenue30 * s);
      return { itemId, itemName, quantity: Math.max(1, Math.round(revenue / price)), revenue };
    }),
    shopSales,
  };
}
