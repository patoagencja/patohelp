import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

import { addDaysIso, buildAbSeries, computeAbView, FATIGUE_LOOKBACK_DAYS, type AbAdMeta, type AbRow } from "@/lib/ab/stats";
import type { AbSeries, AbSeriesRequest, AbView, AbWindowKey } from "@/lib/ab/types";
import { resolveAbWindow, salesMomentsFor } from "@/lib/ab/window";
import { DEMO_SEASON_CONFIG } from "@/lib/demo/season";
import { diffDaysIso } from "@/lib/season/config";
import { marketOf } from "@/lib/season/markets";

// Synthetic creative tests for the public demo: the same Santa video shop
// as the season demo (lib/demo/season.ts), seen ad by ad on Meta. Eight ad
// sets across the markets, each a running A/B test of 2-6 ads.
//
// Like the season demo, we only generate raw ads_ad_daily-shaped rows and
// run them through the production analysis (computeAbView, the same periods
// and sales moments as lib/ab/load.ts) - so the demo can never promise a
// rule production doesn't apply, and a "97% szans" always matches the
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
  /** Ad set spend on the 5 December peak, zł a day. */
  peak: number;
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
    name: "PL | Film od Mikołaja | Rodzice 25-45",
    campaign: "PL | Sprzedaż | Film od Mikołaja",
    peak: 16_000,
    cpm: 19,
    aov: 79,
    freq: 1.25,
    ads: [
      { name: "Elf Fajtłapa 15s pion", since: 26, weight: 0.3, ctr: 0.019, cvr: 0.108, hook: 0.34 },
      { name: "Fabryka prezentów UGC", since: 19, weight: 0.3, ctr: 0.021, cvr: 0.125, hook: 0.41 },
      { name: "Sekret Mikołaja - karuzela", since: 26, weight: 0.18, ctr: 0.017, cvr: 0.104 },
      { name: "List od Mikołaja - statyczna", since: 26, weight: 0.17, ctr: 0.012, cvr: 0.084 },
      { name: "Reakcja dziecka 9s reels", since: 2, fixed: 90, ctr: 0.02, cvr: 0.11, hook: 0.38 },
    ],
  },
  {
    name: "PL | Film od Mikołaja | Dziadkowie 50+",
    campaign: "PL | Sprzedaż | Film od Mikołaja",
    peak: 7_500,
    cpm: 15,
    aov: 85,
    freq: 1.3,
    ads: [
      { name: "Elf Fajtłapa 15s pion", since: 24, weight: 0.45, ctr: 0.017, cvr: 0.046, hook: 0.22 },
      { name: "List od Mikołaja - statyczna", since: 24, weight: 0.3, ctr: 0.015, cvr: 0.112 },
      { name: "Wigilijny poranek 20s poziom", since: 17, weight: 0.25, ctr: 0.016, cvr: 0.108, hook: 0.29 },
    ],
  },
  {
    name: "PL | Remarketing | Odwiedzili stronę 14 dni",
    campaign: "PL | Remarketing",
    peak: 3_500,
    cpm: 34,
    aov: 82,
    freq: 1.9,
    ads: [
      {
        name: "Sekret Mikołaja - karuzela",
        since: 30,
        weight: 0.5,
        ctr: 0.024,
        cvr: 0.24,
        fade: { days: 5, drop: 0.45 },
        freq: 1.35,
      },
      { name: "Opinie rodziców - statyczna", since: 30, weight: 0.3, ctr: 0.02, cvr: 0.2 },
      { name: "Ostatnia chwila - film 6s", since: 9, weight: 0.2, ctr: 0.022, cvr: 0.205, hook: 0.3 },
    ],
  },
  {
    name: "DE | Film od Mikołaja | Rodzice 25-45",
    campaign: "DE | Sprzedaż | Film od Mikołaja",
    peak: 10_000,
    cpm: 28,
    aov: 109,
    freq: 1.2,
    ads: [
      { name: "Elf Fajtłapa 15s pion", since: 22, weight: 0.3, ctr: 0.017, cvr: 0.105, hook: 0.33 },
      { name: "Fabryka prezentów UGC", since: 22, weight: 0.27, ctr: 0.018, cvr: 0.106, hook: 0.37 },
      { name: "Sekret Mikołaja - karuzela", since: 22, weight: 0.22, ctr: 0.015, cvr: 0.104 },
      { name: "List od Mikołaja - statyczna", since: 22, weight: 0.19, ctr: 0.0125, cvr: 0.104 },
      { name: "Nikolaus 6.12 - film 10s", since: 0, fixed: 70, ctr: 0.018, cvr: 0.11, hook: 0.35 },
      { name: "Renifer Rudi UGC", since: 1, fixed: 40, ctr: 0.017, cvr: 0.1, hook: 0.31 },
    ],
  },
  {
    name: "DE | Film od Mikołaja | Szeroka grupa",
    campaign: "DE | Sprzedaż | Film od Mikołaja",
    peak: 4_500,
    cpm: 22,
    aov: 105,
    freq: 1.15,
    ads: [
      { name: "Fabryka prezentów UGC", since: 20, weight: 0.45, ctr: 0.017, cvr: 0.095, hook: 0.36 },
      { name: "Elf Fajtłapa 15s pion", since: 20, weight: 0.35, ctr: 0.016, cvr: 0.094, hook: 0.31 },
      { name: "List od Mikołaja - statyczna", since: 20, pausedAgo: 2, weight: 0.2, ctr: 0.011, cvr: 0.07 },
    ],
  },
  {
    name: "IT | Film od Mikołaja | Rodzice 25-45",
    campaign: "IT | Sprzedaż | Film od Mikołaja",
    peak: 4_000,
    cpm: 20,
    aov: 99,
    freq: 1.2,
    ads: [
      { name: "Fabryka prezentów UGC", since: 15, weight: 0.4, ctr: 0.019, cvr: 0.126, hook: 0.4 },
      { name: "Elf Fajtłapa 15s pion", since: 15, weight: 0.35, ctr: 0.018, cvr: 0.108, hook: 0.32 },
      { name: "List od Mikołaja - statyczna", since: 15, weight: 0.25, ctr: 0.013, cvr: 0.093 },
    ],
  },
  {
    name: "UK | Film od Mikołaja | Advantage+",
    campaign: "UK | Advantage+ | Film od Mikołaja",
    peak: 3_000,
    cpm: 33,
    aov: 115,
    freq: 1.2,
    ads: [
      { name: "Fabryka prezentów UGC", since: 18, weight: 0.55, ctr: 0.016, cvr: 0.125, hook: 0.38 },
      { name: "Sekret Mikołaja - karuzela", since: 18, weight: 0.45, ctr: 0.013, cvr: 0.078 },
    ],
  },
  {
    name: "US | Film od Mikołaja | Rodzice 25-45",
    campaign: "US | Sprzedaż | Film od Mikołaja",
    peak: 1_800,
    cpm: 38,
    aov: 129,
    freq: 1.1,
    ads: [
      { name: "Elf Fajtłapa 15s pion", since: 12, weight: 0.55, ctr: 0.014, cvr: 0.134, hook: 0.35 },
      { name: "Fabryka prezentów UGC", since: 12, weight: 0.45, ctr: 0.015, cvr: 0.131, hook: 0.39 },
      { name: "List od Mikołaja - kwadrat", since: 1, fixed: 30, ctr: 0.012, cvr: 0.12 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Calendar

/**
 * How hard the shop pushes on a day, 0..1 of the 5 December peak: a slow
 * October, Black Week, the eve of St Nicholas, the run-up to Christmas Eve.
 */
function intensity(iso: string): number {
  const md = iso.slice(5);
  if (md < "10-01") return md >= "09-01" ? 0.2 : 0.1; // September: pre-season tests
  if (md > "12-24") return 0.08;
  const d = diffDaysIso(`${iso.slice(0, 4)}-10-01`, iso);
  let v = 0.32 + (0.3 * Math.min(d, 50)) / 50;
  if (md >= "11-21" && md <= "12-01") v += 0.14;
  if (md >= "12-02") {
    const day = Number(md.slice(3));
    if (day <= 5) v = [0.78, 0.86, 0.93, 1][day - 2];
    else if (day === 6) v = 0.8;
    else if (day <= 20) v = 0.86 + ((day - 7) * 0.09) / 13;
    else v = [0.78, 0.66, 0.52, 0.34][day - 21];
  }
  return v;
}

// Sunday and Monday evenings sell best; Friday and Saturday are quieter.
const WEEKDAY = [1.06, 1.05, 1.0, 0.99, 0.98, 0.95, 0.96];

const todayWarsaw = () => formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");

/** Outside the season the demo shows a December day of the last season. */
function seasonDay(iso: string): string {
  const md = iso.slice(5);
  if (md >= "10-01" && md <= "12-24") return iso;
  const y = Number(iso.slice(0, 4));
  return md > "12-24" ? `${y}-12-09` : `${y - 1}-12-09`;
}

// ---------------------------------------------------------------------------
// Generation

interface GenAd {
  def: DemoAdDef;
  set: DemoSetDef;
  adId: string;
  adsetId: string;
  campaignId: string;
  /** Days before today the ad went live (see generate()). */
  since: number;
}

function fadeOf(def: DemoAdDef, daysAgo: number): number {
  if (!def.fade || daysAgo >= def.fade.days) return 1;
  return 1 - (def.fade.drop * (def.fade.days - daysAgo)) / def.fade.days;
}

/** The ads of every set as they stand on `today`. */
function demoAds(today: string): GenAd[][] {
  // The core ads have run since the season opened (deep into December that
  // is 70+ days), so "Cały sezon" isn't empty before mid-November; test
  // newcomers keep their own short age.
  const seasonAge = Math.max(0, diffDaysIso(`${today.slice(0, 4)}-10-01`, today));
  return SETS.map((set, si) => {
    const adsetId = `demo-adset-${si + 1}`;
    const campaignId = `demo-camp-${hash(set.campaign) % 100_000}`;
    return set.ads.map((def, ai) => ({
      def,
      set,
      adId: `demo-ad-${si + 1}-${ai + 1}`,
      adsetId,
      campaignId,
      since: def.since >= 15 ? Math.max(def.since, seasonAge) : def.since,
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
        set.peak * 100 * intensity(date) * WEEKDAY[new Date(`${date}T12:00:00Z`).getUTCDay()] * (1 + 0.05 * gauss(r));
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

/** The demo's "today": `pinned` or the real Warsaw day, moved into the season. */
function demoDay(pinned?: string): { day: string; live: boolean } {
  const real = todayWarsaw();
  const day = seasonDay(pinned || real);
  return { day, live: day === real };
}

// ---------------------------------------------------------------------------

/**
 * Demo creative-test view for a period. `today` (yyyy-MM-dd) pins the day;
 * by default it is today in Warsaw, moved into the season when the real
 * date is outside it (the demo shop sells October - Christmas Eve only).
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
  const win = resolveAbWindow(windowKey, day, DEMO_SEASON_CONFIG);
  const liveWindow = win.start < day && win.end >= addDaysIso(day, -1);
  const lookback = addDaysIso(day, -FATIGUE_LOOKBACK_DAYS);
  const from = liveWindow && lookback < win.start ? lookback : win.start;
  const sets = demoAds(day);

  return computeAbView({
    windowKey: win.key,
    start: win.start,
    end: win.end,
    today: day,
    rows: generateRows(sets, day, from, win.end, partial),
    meta: demoMeta(sets, day),
    updatedAt,
    marketOf,
    moments: salesMomentsFor(DEMO_SEASON_CONFIG, day),
  });
}

/** The compare chart's series for the demo (lib/demo/ab-actions.ts), same days as the view. */
export function getDemoAbSeries(req: AbSeriesRequest, today?: string): AbSeries[] {
  const { day } = demoDay(today);
  const end = req.end > day ? day : req.end;
  if (req.start > end) return buildAbSeries(req.adIds, req.start, req.end, []);
  const ids = new Set(req.adIds);
  // Past days don't depend on how far today has synced.
  const rows = generateRows(demoAds(day), day, req.start, end, PINNED_PARTIAL).filter((r) => ids.has(r.adId));
  return buildAbSeries(req.adIds, req.start, req.end, rows);
}
