import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

import { addDaysIso, buildAbSeries, computeAbView, FATIGUE_LOOKBACK_DAYS, type AbAdMeta, type AbRow } from "@/lib/ab/stats";
import type { AbSeries, AbSeriesRequest, AbView, AbWindowKey } from "@/lib/ab/types";
import { resolveAbWindow, salesMomentsFor } from "@/lib/ab/window";
import { DEMO_MONTH_DEMAND } from "@/lib/demo/ecom";
import { diffDaysIso } from "@/lib/season/config";
import { marketOf } from "@/lib/season/markets";

// Synthetic creative tests for the public demo: the same shop as every other
// /demo-full page - lokalnepomidorki, an online vegetable shop delivering
// veg boxes, tomatoes and preserves across Poland - seen ad by ad on Meta.
// Six ad sets, each a running A/B test of 3-6 ads, ~850 zł a day in all:
// the Meta share of the budget the Sprzedaż demo (lib/demo/ecom.ts) spends.
// One country, so the names carry no market code and the market filter
// stays hidden, as for a live single-market shop.
//
// We only generate raw ads_ad_daily-shaped rows and run them through the
// production analysis (computeAbView, the same periods and sales moments as
// lib/ab/load.ts for a client without a season) - so the demo can never
// promise a rule production doesn't apply, and every verdict matches the
// purchases next to it. Every ad has a "true" click-through and purchase
// rate; the days come from those plus seeded noise. The scenario is built to
// show every state: clear winners and losers, a tired remarketing ad (judged
// only away from Black Friday / Mikołajki / Wigilia, like in production),
// ads in line with their set, brand-new ads too early to judge and a paused
// ad.
//
// Each day is a pure function of its date and the ad (hashed seed): the same
// day shows the same numbers whatever period is picked.

const TZ = "Europe/Warsaw";
/** Share of today's spend already synced at the pinned 12:40 stamp. */
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
  /** New ads in learning get a small fixed budget instead, zł a day. */
  fixed?: number;
  ctr: number;
  /** Purchases per link click. */
  cvr: number;
  /** 3-second plays per impression - set for videos only. */
  hook?: number;
  /** Wear-out: rates fall by `drop` over the last `days` days, frequency climbs. */
  fade?: { days: number; drop: number };
  /** Frequency multiplier against the ad set's typical one. */
  freq?: number;
}

interface DemoSetDef {
  name: string;
  campaign: string;
  /** Ad set spend on an average day of the year, zł a day. */
  daily: number;
  /** zł per 1000 impressions. */
  cpm: number;
  /** Average order, zł. */
  aov: number;
  /** Typical 1-day frequency. */
  freq: number;
  ads: DemoAdDef[];
}

const SETS: DemoSetDef[] = [
  {
    name: "Skrzynki warzyw | Rodziny 28-45",
    campaign: "SPRZEDAŻ | Skrzynki warzyw",
    daily: 260,
    cpm: 22,
    aov: 139,
    freq: 1.25,
    ads: [
      { name: "Skrzynka tygodnia - wideo 15 s", since: 84, weight: 0.3, ctr: 0.016, cvr: 0.05, hook: 0.33 },
      { name: "Rozpakowanie skrzynki - film klientki", since: 61, weight: 0.3, ctr: 0.019, cvr: 0.064, hook: 0.41 },
      { name: "Co jest w skrzynce? - karuzela", since: 84, weight: 0.16, ctr: 0.015, cvr: 0.048 },
      { name: "Darmowa dostawa od 150 zł - grafika", since: 84, weight: 0.2, ctr: 0.012, cvr: 0.026 },
      { name: "Rolnik Janek poleca - rolka 9 s", since: 2, fixed: 25, ctr: 0.017, cvr: 0.05, hook: 0.38 },
    ],
  },
  {
    name: "Pomidory malinowe | Lubią gotować 30-60",
    campaign: "SPRZEDAŻ | Pomidory i przetwory",
    daily: 160,
    cpm: 18,
    aov: 96,
    freq: 1.3,
    ads: [
      { name: "Pomidory malinowe z bliska - wideo 10 s", since: 70, weight: 0.45, ctr: 0.016, cvr: 0.03, hook: 0.24 },
      { name: "Bruschetta w 5 minut - karuzela", since: 70, weight: 0.3, ctr: 0.015, cvr: 0.064 },
      { name: "Prosto z krzaka - grafika", since: 45, weight: 0.25, ctr: 0.015, cvr: 0.06 },
    ],
  },
  {
    name: "Remarketing | Odwiedzili sklep 14 dni",
    campaign: "REMARKETING | Sklep",
    daily: 120,
    cpm: 34,
    aov: 132,
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
      { name: "Ostatnie skrzynki na sobotę - wideo 6 s", since: 9, weight: 0.2, ctr: 0.022, cvr: 0.1, hook: 0.3 },
    ],
  },
  {
    name: "Przetwory | Domowe spiżarnie 35-65",
    campaign: "SPRZEDAŻ | Pomidory i przetwory",
    daily: 140,
    cpm: 16,
    aov: 118,
    freq: 1.2,
    ads: [
      { name: "Pomidory na przetwory 10 kg - grafika", since: 40, weight: 0.3, ctr: 0.017, cvr: 0.05 },
      { name: "Passata jak u babci - wideo 20 s", since: 40, weight: 0.27, ctr: 0.018, cvr: 0.052, hook: 0.37 },
      { name: "Kapusta do kiszenia - karuzela", since: 40, weight: 0.22, ctr: 0.015, cvr: 0.05 },
      { name: "Słoiki na zimę - grafika", since: 40, weight: 0.19, ctr: 0.0125, cvr: 0.05 },
      { name: "Ostatnie pomidory sezonu - wideo 10 s", since: 0, fixed: 20, ctr: 0.018, cvr: 0.05, hook: 0.35 },
      { name: "Kiszonki krok po kroku - film klientki", since: 1, fixed: 12, ctr: 0.017, cvr: 0.05, hook: 0.31 },
    ],
  },
  {
    name: "Skrzynki warzyw | Szeroka grupa",
    campaign: "SPRZEDAŻ | Skrzynki warzyw",
    daily: 110,
    cpm: 15,
    aov: 135,
    freq: 1.15,
    ads: [
      { name: "Rozpakowanie skrzynki - film klientki", since: 50, weight: 0.45, ctr: 0.017, cvr: 0.048, hook: 0.36 },
      { name: "Skrzynka tygodnia - wideo 15 s", since: 50, weight: 0.35, ctr: 0.016, cvr: 0.047, hook: 0.31 },
      { name: "Darmowa dostawa od 150 zł - grafika", since: 50, pausedAgo: 2, weight: 0.2, ctr: 0.011, cvr: 0.035 },
    ],
  },
  {
    name: "Dostawa jutro | Warszawa i okolice",
    campaign: "SPRZEDAŻ | Dostawa jutro",
    daily: 100,
    cpm: 24,
    aov: 145,
    freq: 1.2,
    ads: [
      { name: "Zamów do 20:00, jutro u Ciebie - grafika", since: 30, weight: 0.55, ctr: 0.018, cvr: 0.068 },
      { name: "Kurier z warzywami - wideo 12 s", since: 30, weight: 0.45, ctr: 0.014, cvr: 0.036, hook: 0.3 },
      { name: "Mapa dostaw - grafika", since: 1, fixed: 8, ctr: 0.014, cvr: 0.06 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Calendar

// Spend follows the shop's own year (lib/demo/ecom.ts): the tomato and
// preserves season (July - September) is the peak, then December's holiday
// cooking; January and February are the quiet months.
const MONTH = DEMO_MONTH_DEMAND;

/** How hard the shop pushes on a day (1 = an average day), month to month without steps. */
function intensity(iso: string): number {
  const d = new Date(`${iso}T12:00:00Z`);
  const m = d.getUTCMonth();
  const dim = new Date(Date.UTC(d.getUTCFullYear(), m + 1, 0)).getUTCDate();
  const t = (d.getUTCDate() - 1) / dim;
  // Halfway through a month it is that month's value; towards either end it
  // blends into the neighbour, so the chart has no cliff on the 1st.
  const next = t >= 0.5 ? MONTH[(m + 1) % 12] : MONTH[(m + 11) % 12];
  return MONTH[m] + (next - MONTH[m]) * Math.abs(t - 0.5);
}

// Orders for the week's delivery come in Sunday to Tuesday; Friday and
// Saturday are quiet.
const WEEKDAY = [1.12, 1.08, 1.03, 1.0, 0.97, 0.91, 0.89];

const todayWarsaw = () => formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");

// ---------------------------------------------------------------------------
// Generation

interface GenAd {
  def: DemoAdDef;
  set: DemoSetDef;
  adId: string;
  adsetId: string;
  campaignId: string;
  /** Days before today the ad went live. */
  since: number;
}

function fadeOf(def: DemoAdDef, daysAgo: number): number {
  if (!def.fade || daysAgo >= def.fade.days) return 1;
  return 1 - (def.fade.drop * (def.fade.days - daysAgo)) / def.fade.days;
}

/** The ads of every set as they stand on `today`. */
function demoAds(): GenAd[][] {
  return SETS.map((set, si) => {
    const adsetId = `demo-adset-${si + 1}`;
    const campaignId = `demo-camp-${hash(set.campaign) % 100_000}`;
    return set.ads.map((def, ai) => ({
      def,
      set,
      adId: `demo-ad-${si + 1}-${ai + 1}`,
      adsetId,
      campaignId,
      since: def.since,
    }));
  });
}

/** ads_ad_daily-shaped rows for [from, to] (to <= today; today only partly synced). */
function generateRows(sets: GenAd[][], today: string, from: string, to: string, partial: number): AbRow[] {
  const rows: AbRow[] = [];
  for (let date = from; date <= to; date = addDaysIso(date, 1)) {
    const ago = diffDaysIso(date, today);
    const dayShare = ago === 0 ? partial : 1;
    for (const ads of sets) {
      const set = ads[0].set;
      const live = (ad: GenAd) => ago <= ad.since && (ad.def.pausedAgo == null || ago > ad.def.pausedAgo);
      const r = mulberry32(hash(`${set.name}|${date}`));
      const budget =
        set.daily * 100 * intensity(date) * WEEKDAY[new Date(`${date}T12:00:00Z`).getUTCDay()] * (1 + 0.05 * gauss(r));
      const weightSum = ads.reduce((s, a) => s + (live(a) && a.def.weight ? a.def.weight : 0), 0);

      for (const ad of ads) {
        if (!live(ad)) continue;
        const { def } = ad;
        const n = mulberry32(hash(`${ad.adId}|${date}`));
        const base = def.fixed != null ? def.fixed * 100 : (budget * (def.weight ?? 0)) / (weightSum || 1);
        const spend = Math.max(0, Math.round(base * dayShare * (1 + 0.06 * gauss(n))));
        const impressions = Math.round((spend / (set.cpm * 100)) * 1000);
        const f = fadeOf(def, ago);
        // Wear-out shows in clicks first, then in purchases per click.
        const clicks = Math.round(impressions * def.ctr * (1 - (1 - f) * 0.5) * (1 + 0.04 * gauss(n)));
        const lambda = clicks * def.cvr * f;
        const purchases = Math.max(0, Math.round(lambda + 0.35 * Math.sqrt(lambda) * gauss(n)));
        const value = Math.round(purchases * set.aov * 100 * (1 + 0.03 * gauss(n)));
        // A tired ad keeps reaching the same people: its daily frequency climbs.
        const jitter = 0.92 + (hash(ad.adId) % 17) / 100;
        const frequency =
          Math.round(set.freq * (def.freq ?? jitter) * (1 + 0.9 * (1 - f)) * (1 + 0.03 * gauss(n)) * 100) / 100;
        rows.push({
          date,
          adId: ad.adId,
          adName: def.name,
          adsetId: ad.adsetId,
          adsetName: set.name,
          campaignId: ad.campaignId,
          campaignName: set.campaign,
          spend,
          impressions,
          clicks,
          reach: frequency > 0 ? Math.round(impressions / frequency) : null,
          frequency,
          purchases,
          value,
          video3s: def.hook != null ? Math.round(impressions * def.hook * (1 + 0.03 * gauss(n))) : null,
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
          `${addDaysIso(today, -g.since)}T08:${String(10 + (hash(g.adId) % 45)).padStart(2, "0")}:00`,
          TZ
        ).toISOString(),
      };
    }
  }
  return out;
}

/** The demo's "today": `pinned` or the real Warsaw day (the shop sells all year). */
function demoDay(pinned?: string): { day: string; live: boolean } {
  const real = todayWarsaw();
  const day = pinned || real;
  return { day, live: day === real };
}

// ---------------------------------------------------------------------------

/**
 * Demo creative-test view for a period. `today` (yyyy-MM-dd) pins the day;
 * by default it is today in Warsaw. The shop has no season config, so
 * "Cały sezon" isn't offered and the sales moments are the fixed ones.
 */
export function getDemoAbView(windowKey: AbWindowKey, today?: string): AbView {
  const { day, live } = demoDay(today);

  // Live: data "synced" a few minutes ago, today as far as it has gone.
  // Pinned days show the 12:40 sync.
  let updatedAt: string;
  let partial: number;
  if (live) {
    const stamp = new Date(Math.floor(Date.now() / 1_200_000) * 1_200_000);
    const [h, m] = formatInTimeZone(stamp, TZ, "H:m").split(":").map(Number);
    updatedAt = stamp.toISOString();
    partial = Math.max(0.03, Math.pow((h * 60 + m) / 1440, 1.15));
  } else {
    updatedAt = fromZonedTime(`${day}T12:40:00`, TZ).toISOString();
    partial = PINNED_PARTIAL;
  }

  // The same period and look-back as lib/ab/load.ts reads for a live client.
  const win = resolveAbWindow(windowKey, day, null);
  const liveWindow = win.start < day && win.end >= addDaysIso(day, -1);
  const lookback = addDaysIso(day, -FATIGUE_LOOKBACK_DAYS);
  const from = liveWindow && lookback < win.start ? lookback : win.start;
  const sets = demoAds();

  return computeAbView({
    windowKey: win.key,
    start: win.start,
    end: win.end,
    today: day,
    rows: generateRows(sets, day, from, win.end, partial),
    meta: demoMeta(sets, day),
    updatedAt,
    marketOf,
    moments: salesMomentsFor(null, day),
  });
}

/** The compare chart's series for the demo (lib/demo/ab-actions.ts), same days as the view. */
export function getDemoAbSeries(req: AbSeriesRequest, today?: string): AbSeries[] {
  const { day } = demoDay(today);
  const end = req.end > day ? day : req.end;
  if (req.start > end) return buildAbSeries(req.adIds, req.start, req.end, []);
  const ids = new Set(req.adIds);
  // Past days don't depend on how far today has synced.
  const rows = generateRows(demoAds(), day, req.start, end, PINNED_PARTIAL).filter((r) => ids.has(r.adId));
  return buildAbSeries(req.adIds, req.start, req.end, rows);
}
