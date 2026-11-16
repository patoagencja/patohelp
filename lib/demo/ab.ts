import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

import { addDaysIso, buildAbSeries, computeAbView, FATIGUE_LOOKBACK_DAYS, type AbAdMeta, type AbRow } from "@/lib/ab/stats";
import type { AbSeries, AbSeriesRequest, AbView, AbWindowKey } from "@/lib/ab/types";
import { resolveAbWindow, salesMomentsFor } from "@/lib/ab/window";
import type { DemoCampaign, DemoSource } from "@/lib/demo/source";
import { diffDaysIso } from "@/lib/season/config";
import { marketOf } from "@/lib/season/markets";

// Synthetic creative tests for the public demo: the same shop as every other
// /demo-full page - Mediaspec, the electronics and home-appliance shop
// (lib/demo/brand.ts) - seen ad by ad on Meta. Six ad sets, each a running
// A/B test of 3-6 ads, inside the shop's own Meta campaigns: an ad set's
// daily budget is a share of its campaign's spend that day in the demo
// source, and its purchases a share of the campaign's purchases - so these
// pages can't spend more on Meta, or sell more from it, than Reklamy says.
//
// We only generate raw ads_ad_daily-shaped rows and run them through the
// production analysis (computeAbView, the same periods and sales moments as
// lib/ab/load.ts for a client without a season) - so the demo can never
// promise a rule production doesn't apply, and every verdict matches the
// purchases next to it. Every ad has a "true" click-through and purchase
// rate relative to its set; the days come from those plus seeded noise. The
// scenario shows every state: clear winners and losers, a tired remarketing
// ad, ads in line with their set, brand-new ads too early to judge and a
// paused ad.

const TZ = "Europe/Warsaw";
/** Share of a pinned day's spend already synced at the 12:40 stamp. */
const PINNED_PARTIAL = 0.48;

// ---------------------------------------------------------------------------
// Seeded randomness

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------------------------------------------------------------------------
// The scenario

interface DemoAdDef {
  name: string;
  /** Went live this many days before "today" (0 = this morning). */
  since: number;
  /** Paused this many days ago: no spend from that day on. */
  pausedAgo?: number;
  /** Delivery weight inside the ad set (normalised over live ads). */
  weight?: number;
  /** New ads in learning get a small fixed share of the set's budget instead. */
  fixed?: number;
  /** Click-through and purchases per click, relative to the set's average. */
  ctr: number;
  cvr: number;
  /** 3-second plays per impression - set for videos only. */
  hook?: number;
  /** Wear-out: rates fall by `drop` over the last `days` days, frequency climbs. */
  fade?: { days: number; drop: number };
  /** Frequency multiplier against the ad set's typical one. */
  freq?: number;
}

type Role = "p1" | "p2" | "r" | "c" | "m";

interface DemoSetDef {
  name: string;
  /** Which of the shop's Meta campaigns the set runs in. */
  role: Role;
  /** Share of the campaign's spend and purchases. */
  share: number;
  /** Average order against the shop's. */
  aov: number;
  /** Typical 1-day frequency. */
  freq: number;
  ads: DemoAdDef[];
}

const SETS: DemoSetDef[] = [
  {
    name: "Telewizory | Mężczyźni 25-54",
    role: "p1",
    share: 0.5,
    aov: 1.25,
    freq: 1.25,
    ads: [
      { name: "Black Friday na telewizory - wideo 15 s", since: 84, weight: 0.3, ctr: 0.016, cvr: 0.05, hook: 0.33 },
      { name: "Rozpakowanie telewizora - film klienta", since: 61, weight: 0.3, ctr: 0.019, cvr: 0.064, hook: 0.41 },
      { name: "Raty 0% na AGD - karuzela", since: 84, weight: 0.16, ctr: 0.015, cvr: 0.048 },
      { name: "Darmowa dostawa i wniesienie - grafika", since: 84, weight: 0.2, ctr: 0.012, cvr: 0.026 },
      { name: "Mecz na 65 calach - rolka 9 s", since: 2, fixed: 0.04, ctr: 0.017, cvr: 0.05, hook: 0.38 },
    ],
  },
  {
    name: "Kuchnia | Lubią gotować 30-60",
    role: "p2",
    share: 0.35,
    aov: 0.7,
    freq: 1.3,
    ads: [
      { name: "Ekspres do kawy - zbliżenie wideo 10 s", since: 70, weight: 0.45, ctr: 0.016, cvr: 0.03, hook: 0.24 },
      { name: "Kawa jak z kawiarni - karuzela", since: 70, weight: 0.3, ctr: 0.015, cvr: 0.064 },
      { name: "Ekspres na blacie - grafika", since: 45, weight: 0.25, ctr: 0.015, cvr: 0.06 },
    ],
  },
  {
    name: "Remarketing | Odwiedzili sklep 14 dni",
    role: "r",
    share: 0.7,
    aov: 1.05,
    freq: 1.9,
    ads: [
      {
        name: "Twój koszyk czeka - karuzela",
        since: 120,
        weight: 0.5,
        ctr: 0.024,
        cvr: 0.12,
        fade: { days: 5, drop: 0.45 },
        freq: 1.35,
      },
      { name: "Opinie klientów - grafika", since: 120, weight: 0.3, ctr: 0.02, cvr: 0.1 },
      { name: "Ostatnie dni dostawy przed Świętami - wideo 6 s", since: 9, weight: 0.2, ctr: 0.022, cvr: 0.1, hook: 0.3 },
    ],
  },
  {
    name: "Katalog | Szeroka grupa",
    role: "c",
    share: 0.6,
    aov: 0.95,
    freq: 1.2,
    ads: [
      { name: "Bestsellery - katalog dynamiczny", since: 40, weight: 0.3, ctr: 0.017, cvr: 0.05 },
      { name: "Telewizory - katalog z ceną promocyjną", since: 40, weight: 0.27, ctr: 0.018, cvr: 0.052 },
      { name: "Małe AGD - katalog", since: 40, weight: 0.22, ctr: 0.015, cvr: 0.05 },
      { name: "Słuchawki i audio - katalog", since: 40, weight: 0.19, ctr: 0.0125, cvr: 0.05 },
      { name: "Raty 0% - katalog z ratą", since: 0, fixed: 0.03, ctr: 0.018, cvr: 0.05, hook: 0.35 },
      { name: "Smartfony - katalog", since: 1, fixed: 0.02, ctr: 0.017, cvr: 0.05 },
    ],
  },
  {
    name: "Prezenty | Szeroka grupa",
    role: "p1",
    share: 0.3,
    aov: 0.8,
    freq: 1.15,
    ads: [
      { name: "Prezent pod choinkę: słuchawki - grafika", since: 50, weight: 0.45, ctr: 0.017, cvr: 0.048 },
      { name: "Soundbar w salonie - wideo 10 s", since: 50, weight: 0.35, ctr: 0.016, cvr: 0.047, hook: 0.31 },
      { name: "Darmowa dostawa i wniesienie - grafika", since: 50, pausedAgo: 2, weight: 0.2, ctr: 0.011, cvr: 0.035 },
    ],
  },
  {
    name: "Black Friday | Rynek zagraniczny",
    role: "m",
    share: 0.8,
    aov: 1.1,
    freq: 1.2,
    ads: [
      { name: "Black Friday na telewizory - wideo 15 s", since: 30, weight: 0.55, ctr: 0.018, cvr: 0.068, hook: 0.36 },
      { name: "Raty 0% na AGD - grafika", since: 30, weight: 0.45, ctr: 0.014, cvr: 0.036 },
      { name: "Darmowa dostawa - grafika", since: 1, fixed: 0.03, ctr: 0.014, cvr: 0.06 },
    ],
  },
];

/** The shop's Meta campaign each role stands for (falling back along the list). */
function campaignsByRole(src: DemoSource): Record<Role, DemoCampaign | undefined> {
  const meta = src.campaigns.filter((c) => c.provider === "meta_ads");
  const prospecting = meta.filter((c) => c.type === "PROSPECTING" && c.market !== null && c.market === "PL");
  const anyProspecting = meta.filter((c) => c.type === "PROSPECTING");
  const p1 = prospecting[0] ?? anyProspecting[0] ?? meta[0];
  const p2 = prospecting[1] ?? anyProspecting.find((c) => c !== p1) ?? p1;
  const r = meta.find((c) => c.type === "RETARGETING") ?? meta.find((c) => c.type === "CATALOG") ?? p1;
  const c = meta.find((x) => x.type === "CATALOG") ?? r;
  const m = meta.find((x) => x.market !== null && x.market !== "PL");
  return { p1, p2, r, c, m };
}

// Weekday-free: the days come from the campaigns themselves.
const todayWarsaw = () => formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");

// ---------------------------------------------------------------------------
// Generation

interface GenAd {
  def: DemoAdDef;
  set: DemoSetDef;
  campaign: DemoCampaign;
  /** The set's share of its campaign (scaled down when sets would overlap). */
  share: number;
  adId: string;
  adsetId: string;
}

function fadeOf(def: DemoAdDef, daysAgo: number): number {
  if (!def.fade || daysAgo >= def.fade.days) return 1;
  return 1 - (def.fade.drop * (def.fade.days - daysAgo)) / def.fade.days;
}

/** The ads of every set that has a campaign in this shop. */
function demoAds(src: DemoSource): GenAd[][] {
  const roles = campaignsByRole(src);
  const perCampaign = new Map<string, number>();
  for (const s of SETS) {
    const c = roles[s.role];
    if (c) perCampaign.set(c.id, (perCampaign.get(c.id) ?? 0) + s.share);
  }
  return SETS.flatMap((set, si) => {
    const campaign = roles[set.role];
    if (!campaign) return [];
    const scale = Math.min(1, 0.95 / (perCampaign.get(campaign.id) ?? 1));
    return [
      set.ads.map((def, ai) => ({
        def,
        set,
        campaign,
        share: set.share * scale,
        adId: `demo-ad-${si + 1}-${ai + 1}`,
        adsetId: `demo-adset-${si + 1}`,
      })),
    ];
  });
}

/** The shop's average order over the 30 days before `day`. */
function shopAov(src: DemoSource, day: string): number {
  let rev = 0;
  let orders = 0;
  for (let i = 1; i <= 30; i++) {
    const v = src.day(addDaysIso(day, -i));
    if (v?.hasSales) {
      rev += v.revenue;
      orders += v.orders;
    }
  }
  return orders > 0 ? rev / orders : 900_00;
}

/** ads_ad_daily-shaped rows for [from, to] (to <= day; `day` only partly synced). */
function generateRows(src: DemoSource, sets: GenAd[][], day: string, from: string, to: string, pinned: boolean): AbRow[] {
  const rows: AbRow[] = [];
  const aov = shopAov(src, day);
  for (let date = from; date <= to; date = addDaysIso(date, 1)) {
    const ago = diffDaysIso(date, day);
    for (const ads of sets) {
      const { set, campaign, share } = ads[0];
      const camp = src.campaignDay(campaign.id, date);
      if (!camp || camp.spend <= 0) continue;
      // A pinned past day shows its 12:40 sync; the real today is already partial in the source.
      const part = pinned && ago === 0 ? PINNED_PARTIAL : 1;
      const budget = camp.spend * share * part;
      const cpm = camp.impressions > 0 ? (camp.spend / camp.impressions) * 1000 : 30_00;
      const campCtr = camp.impressions > 0 ? camp.clicks / camp.impressions : 0.012;
      const purchasesTarget = camp.conversions * share * part;
      const live = (ad: GenAd) => ago <= ad.def.since && (ad.def.pausedAgo == null || ago > ad.def.pausedAgo);
      const liveAds = ads.filter(live);
      if (liveAds.length === 0) continue;
      const fixedSum = liveAds.reduce((s, a) => s + (a.def.fixed ?? 0), 0);
      const weightSum = liveAds.reduce((s, a) => s + (a.def.weight ?? 0), 0);
      const meanCtr = liveAds.reduce((s, a) => s + a.def.ctr, 0) / liveAds.length;

      const draft = liveAds.map((ad) => {
        const { def } = ad;
        const n = mulberry32(hash(`${ad.adId}|${date}`));
        const base = def.fixed != null ? budget * def.fixed : (budget * (1 - fixedSum) * (def.weight ?? 0)) / (weightSum || 1);
        const spend = Math.max(0, Math.round(base * (1 + 0.06 * gauss(n))));
        const impressions = Math.round((spend / cpm) * 1000);
        const f = fadeOf(def, ago);
        // Wear-out shows in clicks first, then in purchases per click.
        const clicks = Math.round(impressions * campCtr * (def.ctr / meanCtr) * (1 - (1 - f) * 0.5) * (1 + 0.04 * gauss(n)));
        const lambda = clicks * def.cvr * f;
        return { ad, n, spend, impressions, clicks, lambda, f };
      });
      // Purchases: the set's share of what the platform credits the campaign
      // with, spread over the ads by their purchase rates.
      const lambdaSum = draft.reduce((s, d) => s + d.lambda, 0) || 1;
      for (const d of draft) {
        const { ad, n, f } = d;
        const expected = (purchasesTarget * d.lambda) / lambdaSum;
        const purchases = Math.max(0, Math.round(expected + 0.35 * Math.sqrt(expected) * gauss(n)));
        const value = Math.round(purchases * aov * set.aov * (1 + 0.03 * gauss(n)));
        // A tired ad keeps reaching the same people: its daily frequency climbs.
        const jitter = 0.92 + (hash(ad.adId) % 17) / 100;
        const frequency = Math.round(set.freq * (ad.def.freq ?? jitter) * (1 + 0.9 * (1 - f)) * (1 + 0.03 * gauss(n)) * 100) / 100;
        rows.push({
          date,
          adId: ad.adId,
          adName: ad.def.name,
          adsetId: ad.adsetId,
          adsetName: set.name,
          campaignId: campaign.id,
          campaignName: campaign.namePl,
          spend: d.spend,
          impressions: d.impressions,
          clicks: d.clicks,
          reach: frequency > 0 ? Math.round(d.impressions / frequency) : null,
          frequency,
          purchases,
          value,
          video3s: ad.def.hook != null ? Math.round(d.impressions * ad.def.hook * (1 + 0.03 * gauss(n))) : null,
        });
      }
    }
  }
  return rows;
}

/** What the creatives table would hold: status and creation time. */
function demoMeta(sets: GenAd[][], today: string): Record<string, AbAdMeta> {
  const out: Record<string, AbAdMeta> = {};
  for (const ads of sets) {
    for (const g of ads) {
      out[g.adId] = {
        thumbnailUrl: null,
        status: g.def.pausedAgo != null ? "PAUSED" : "ACTIVE",
        createdTime: fromZonedTime(
          `${addDaysIso(today, -g.def.since)}T08:${String(10 + (hash(g.adId) % 45)).padStart(2, "0")}:00`,
          TZ
        ).toISOString(),
      };
    }
  }
  return out;
}

/** The demo's "today": `pinned` (a past day) or the real Warsaw day. */
function demoDay(pinned?: string): { day: string; live: boolean } {
  const real = todayWarsaw();
  const day = pinned && pinned < real ? pinned : real;
  return { day, live: day === real };
}

// ---------------------------------------------------------------------------

/**
 * Demo creative-test view for a period. `today` (yyyy-MM-dd) pins a past
 * day; by default it is today in Warsaw. The shop has no season config, so
 * "Cały sezon" isn't offered and the sales moments are the fixed ones.
 */
export function getDemoAbView(src: DemoSource, windowKey: AbWindowKey, today?: string): AbView {
  const { day, live } = demoDay(today);

  // Live: data "synced" a few minutes ago. Pinned days show the 12:40 sync.
  const updatedAt = live
    ? new Date(Math.floor(Date.now() / 1_200_000) * 1_200_000).toISOString()
    : fromZonedTime(`${day}T12:40:00`, TZ).toISOString();

  // The same period and look-back as lib/ab/load.ts reads for a live client.
  const win = resolveAbWindow(windowKey, day, null);
  const liveWindow = win.start < day && win.end >= addDaysIso(day, -1);
  const lookback = addDaysIso(day, -FATIGUE_LOOKBACK_DAYS);
  const from = liveWindow && lookback < win.start ? lookback : win.start;
  const sets = demoAds(src);

  return computeAbView({
    windowKey: win.key,
    start: win.start,
    end: win.end,
    today: day,
    rows: generateRows(src, sets, day, from, win.end, !live),
    meta: demoMeta(sets, day),
    updatedAt,
    marketOf,
    moments: salesMomentsFor(null, day),
  });
}

/** The compare chart's series for the demo (lib/demo/ab-actions.ts), same days as the view. */
export function getDemoAbSeries(src: DemoSource, req: AbSeriesRequest, today?: string): AbSeries[] {
  const { day, live } = demoDay(today);
  const end = req.end > day ? day : req.end;
  if (req.start > end) return buildAbSeries(req.adIds, req.start, req.end, []);
  const ids = new Set(req.adIds);
  const rows = generateRows(src, demoAds(src), day, req.start, end, !live).filter((r) => ids.has(r.adId));
  return buildAbSeries(req.adIds, req.start, req.end, rows);
}
