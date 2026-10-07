import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

import type {
  AbAction,
  AbAd,
  AbAdTotals,
  AbDay,
  AbRates,
  AbTest,
  AbVerdict,
  AbView,
  AbWindowKey,
} from "@/lib/ab/types";
import { addDaysIso, diffDaysIso } from "@/lib/season/config";
import { marketOf } from "@/lib/season/markets";
import { formatNumberPL } from "@/lib/utils";

// Synthetic creative tests for the public demo: the same Santa video shop
// as the season demo (lib/demo/season.ts), seen ad by ad on Meta. Eight ad
// sets across the markets, each a running A/B test of 2-6 ads.
//
// Every ad has a "true" click-through and purchase rate; the days are
// generated from those plus seeded noise, and every derived number
// (rates, probabilities, verdicts, actions) is then computed from the
// generated days - so a "93% szans" always matches the purchases shown next
// to it. The scenario is built to show every state of the UI: clear winners
// and losers, a tired remarketing ad, a test with no leader yet, brand-new
// ads too early to judge and a paused ad.
//
// Each day is a pure function of its date and the ad (hashed seed): the same
// day shows the same numbers whatever window is picked.

const TZ = "Europe/Warsaw";
/** Below this many purchases we don't judge an ad (same rule as the UI copy). */
const MIN_PURCHASES = 10;
/** Confidence needed to call a winner / loser. */
const CALL = 0.9;
/**
 * And the gap must matter: at season volumes a 3% difference in purchases
 * per click is "certain" within a day, but not worth moving budget for.
 */
const MATERIAL = 0.15;
/** Monte Carlo draws for "szansa, że najlepsza". */
const DRAWS = 4000;
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

/** Standard normal CDF (Abramowitz-Stegun 26.2.17, error < 1e-7). */
function phi(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
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
  /** Wear-out: rates fall by `drop` over the last `days` days. */
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
      { name: "Reakcja dziecka 9s reels", since: 0, fixed: 90, ctr: 0.02, cvr: 0.11, hook: 0.38 },
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

function windowStart(key: AbWindowKey, today: string): string {
  if (key === "season") return `${today.slice(0, 4)}-10-01`;
  const days = { today: 1, "3d": 3, "7d": 7, "14d": 14, "30d": 30 }[key];
  return addDaysIso(today, -(days - 1));
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
  /** Every day from the history start to today, zero-filled. */
  days: AbDay[];
}

function fadeOf(def: DemoAdDef, daysAgo: number): number {
  if (!def.fade || daysAgo >= def.fade.days) return 1;
  return 1 - (def.fade.drop * (def.fade.days - daysAgo)) / def.fade.days;
}

function generate(today: string, from: string, partial: number): GenAd[][] {
  const dates: string[] = [];
  for (let d = from; d <= today; d = addDaysIso(d, 1)) dates.push(d);

  // The core ads have run since the season opened (deep into December that
  // is 70+ days), so "Cały sezon" isn't empty before mid-November; test
  // newcomers keep their own short age.
  const seasonAge = Math.max(0, diffDaysIso(`${today.slice(0, 4)}-10-01`, today));

  return SETS.map((set, si) => {
    const adsetId = `demo-adset-${si + 1}`;
    const campaignId = `demo-camp-${hash(set.campaign) % 100_000}`;
    const ads: GenAd[] = set.ads.map((def, ai) => ({
      def,
      set,
      adId: `demo-ad-${si + 1}-${ai + 1}`,
      adsetId,
      campaignId,
      since: def.since >= 15 ? Math.max(def.since, seasonAge) : def.since,
      days: [],
    }));

    for (const date of dates) {
      const ago = diffDaysIso(date, today);
      const live = (ad: GenAd) => ago <= ad.since && (ad.def.pausedAgo == null || ago > ad.def.pausedAgo);
      const r = mulberry32(hash(`${set.name}|${date}`));
      const dayShare = ago === 0 ? partial : 1;
      const budget =
        set.peak * 100 * intensity(date) * WEEKDAY[new Date(`${date}T12:00:00Z`).getUTCDay()] * (1 + 0.05 * gauss(r));
      const weightSum = ads.reduce((s, a) => s + (live(a) && a.def.weight ? a.def.weight : 0), 0);

      ads.forEach((ad) => {
        const { def } = ad;
        if (!live(ad)) {
          ad.days.push({ date, spend: 0, impressions: 0, clicks: 0, purchases: 0, value: 0 });
          return;
        }
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
        ad.days.push({ date, spend, impressions, clicks, purchases, value });
      });
    }
    return ads;
  });
}

// ---------------------------------------------------------------------------
// Maths over the generated days

function sumDays(days: AbDay[]) {
  return days.reduce(
    (t, d) => ({
      spend: t.spend + d.spend,
      impressions: t.impressions + d.impressions,
      clicks: t.clicks + d.clicks,
      purchases: t.purchases + d.purchases,
      value: t.value + d.value,
    }),
    { spend: 0, impressions: 0, clicks: 0, purchases: 0, value: 0 }
  );
}

function ratesOf(t: AbAdTotals): AbRates {
  return {
    ctr: t.impressions > 0 ? t.clicks / t.impressions : null,
    cvr: t.clicks > 0 ? t.purchases / t.clicks : null,
    cpa: t.purchases > 0 ? t.spend / t.purchases : null,
    roas: t.spend > 0 ? t.value / t.spend : null,
    cpm: t.impressions > 0 ? (t.spend / t.impressions) * 1000 : null,
    hookRate: t.video3s != null && t.impressions > 0 ? t.video3s / t.impressions : null,
  };
}

/** Beta(1+p, 1+c-p) posterior of purchases per click, as mean / variance. */
function posterior(purchases: number, clicks: number) {
  const a = 1 + purchases;
  const b = 1 + Math.max(0, clicks - purchases);
  const n = a + b;
  return { mean: a / n, var: (a * b) / (n * n * (n + 1)) };
}

/** P(this ad's purchase rate > the rest of its ad set). */
function probBetter(p: number, c: number, restP: number, restC: number): number {
  const x = posterior(p, c);
  const y = posterior(restP, restC);
  return phi((x.mean - y.mean) / Math.sqrt(x.var + y.var || 1e-12));
}

const pct = (p: number) => `${Math.min(99, Math.max(1, Math.round(p * 100)))}%`;
const roasText = (r: number | null) =>
  r == null ? "-" : `${r.toLocaleString("pl-PL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×`;
const zl = (minor: number) => `${formatNumberPL(minor / 100)} zł`;
const zlCents = (minor: number) =>
  `${(minor / 100).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;

function purchasesWord(n: number): string {
  if (n === 1) return "zakup";
  const t = n % 10;
  const h = n % 100;
  return t >= 2 && t <= 4 && !(h >= 12 && h <= 14) ? "zakupy" : "zakupów";
}

/** "PL · Rodzice 25-45": market + the audience part of the ad set name. */
function setShort(set: DemoSetDef): string {
  const parts = set.name.split("|").map((s) => s.trim());
  return `${parts[0]} · ${parts[parts.length - 1]}`;
}

interface Fatigue {
  drop: number;
  probability: number;
  /** Recent vs earlier value per zł of spend. */
  roasRecent: number;
  roasEarlier: number;
  spendPerDay: number;
}

/**
 * Wear-out from the ad's own history, whatever the window: the last three
 * full days against the week before them.
 */
function fatigueOf(ad: GenAd, freq7: number): Fatigue | null {
  const n = ad.days.length;
  const recent = sumDays(ad.days.slice(Math.max(0, n - 4), n - 1));
  const earlier = sumDays(ad.days.slice(Math.max(0, n - 11), Math.max(0, n - 4)));
  if (earlier.purchases < 30 || recent.clicks === 0 || freq7 < 3) return null;
  const cr = recent.purchases / recent.clicks;
  const ce = earlier.purchases / earlier.clicks;
  const drop = 1 - cr / ce;
  if (drop < 0.2) return null;
  const x = posterior(recent.purchases, recent.clicks);
  const y = posterior(earlier.purchases, earlier.clicks);
  return {
    drop,
    probability: phi((y.mean - x.mean) / Math.sqrt(x.var + y.var)),
    roasRecent: recent.spend > 0 ? recent.value / recent.spend : 0,
    roasEarlier: earlier.spend > 0 ? earlier.value / earlier.spend : 0,
    spendPerDay: recent.spend / 3,
  };
}

/** The ad's spend per day lately (last three full days, or today). */
function recentSpendPerDay(ad: GenAd, partial: number): number {
  const n = ad.days.length;
  const last3 = ad.days.slice(Math.max(0, n - 4), n - 1);
  const live = last3.filter((d) => d.spend > 0);
  if (live.length > 0) return live.reduce((s, d) => s + d.spend, 0) / live.length;
  return ad.days[n - 1].spend / Math.max(partial, 0.05);
}

/** Frequency over `days` days of delivery (grows sub-linearly). */
function frequencyOf(ad: GenAd, days: number): number {
  const jitter = 0.92 + (hash(ad.adId) % 17) / 100;
  return ad.set.freq * (ad.def.freq ?? jitter) * (0.8 + 0.42 * Math.sqrt(Math.max(1, days)));
}

// ---------------------------------------------------------------------------

/**
 * Demo creative-test view for a window. `today` (yyyy-MM-dd) pins the day;
 * by default it is today in Warsaw, moved into the season when the real
 * date is outside it (the demo shop sells October - Christmas Eve only).
 */
export function getDemoAbView(windowKey: AbWindowKey, today?: string): AbView {
  const real = todayWarsaw();
  const day = seasonDay(today ?? real);
  const live = day === real;

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

  const start = windowStart(windowKey, day);
  const historyFrom = start < addDaysIso(day, -40) ? start : addDaysIso(day, -40);
  const sets = generate(day, historyFrom, partial);
  const windowFrom = diffDaysIso(historyFrom, start);

  const tests: AbTest[] = [];
  const actions: AbAction[] = [];

  sets.forEach((gen, si) => {
    const set = SETS[si];
    const inWindow = gen.map((g) => {
      const daily = g.days.slice(windowFrom);
      const sum = sumDays(daily);
      const spendDays = daily.filter((d) => d.spend > 0).length;
      const totals: AbAdTotals = {
        ...sum,
        frequency: sum.impressions > 0 ? frequencyOf(g, spendDays) : null,
        video3s: g.def.hook != null ? Math.round(sum.impressions * g.def.hook) : null,
      };
      return { g, daily, totals };
    });
    const withSpend = inWindow.filter((x) => x.totals.spend > 0);
    if (withSpend.length === 0) return;

    const setSum = sumDays(withSpend.map((x) => x.totals as unknown as AbDay));
    const judged = withSpend.filter((x) => x.totals.purchases >= MIN_PURCHASES);
    let scaleAction: AbAction | null = null;

    // "Szansa, że najlepsza": share of posterior draws in which the ad has
    // the highest purchase rate among the ads we judge.
    const best = new Map<string, number>();
    if (judged.length >= 2) {
      const r = mulberry32(hash(`${set.name}|${windowKey}|${day}`));
      const post = judged.map((x) => posterior(x.totals.purchases, x.totals.clicks));
      const wins = new Array(judged.length).fill(0);
      for (let k = 0; k < DRAWS; k++) {
        let top = -1;
        let topV = -Infinity;
        post.forEach((p, i) => {
          const v = p.mean + Math.sqrt(p.var) * gauss(r);
          if (v > topV) {
            topV = v;
            top = i;
          }
        });
        wins[top] += 1;
      }
      judged.forEach((x, i) => best.set(x.g.adId, wins[i] / DRAWS));
    }

    const ads: AbAd[] = withSpend.map(({ g, daily, totals }) => {
      const rates = ratesOf(totals);
      const rest = {
        spend: setSum.spend - totals.spend,
        clicks: setSum.clicks - totals.clicks,
        purchases: setSum.purchases - totals.purchases,
        value: setSum.value - totals.value,
      };
      const restRoas = rest.spend > 0 ? rest.value / rest.spend : null;
      const restCpa = rest.purchases > 0 ? rest.spend / rest.purchases : null;
      const spendShare = setSum.spend > 0 ? totals.spend / setSum.spend : 0;
      const paused = g.def.pausedAgo != null;
      const short = setShort(set);
      const name = g.def.name;
      const perDay = recentSpendPerDay(g, partial);
      const fatigue = fatigueOf(g, frequencyOf(g, 7));

      let verdict: AbVerdict;
      if (totals.purchases < MIN_PURCHASES) {
        const need = MIN_PURCHASES - totals.purchases;
        verdict = {
          kind: "too_early",
          probability: null,
          text: `Za mało zakupów, żeby ocenić - potrzeba jeszcze ok. ${need}.`,
          purchasesNeeded: need,
        };
        // Only brand-new ads: an old ad "too early" in a one-day window just
        // needs a longer window, not the owner's attention.
        if (!paused && g.def.since <= 2) {
          actions.push({
            kind: "watch",
            adId: g.adId,
            adsetId: g.adsetId,
            title: `Obserwuj: «${name}» - nowa reklama, za wcześnie na ocenę`,
            detail: `${short}: ${totals.purchases} ${purchasesWord(totals.purchases)} do tej pory, do oceny potrzeba jeszcze ok. ${need}. Daj jej dzień, zanim cokolwiek zmienisz.`,
            impactPerDay: Math.round(perDay),
          });
        }
      } else if (fatigue) {
        const freq = frequencyOf(g, 7).toLocaleString("pl-PL", { maximumFractionDigits: 1 });
        verdict = {
          kind: "fatigue",
          probability: fatigue.probability,
          text: `Od 3 dni o ${Math.round(fatigue.drop * 100)}% mniej zakupów z kliknięcia niż tydzień wcześniej, a jedna osoba widzi ją już ${freq} razy.`,
        };
        if (!paused) {
          actions.push({
            kind: "refresh",
            adId: g.adId,
            adsetId: g.adsetId,
            title: `Odśwież: «${name}» traci siłę`,
            detail: `${short}: zwrot spadł z ${roasText(fatigue.roasEarlier)} do ${roasText(fatigue.roasRecent)}, a ta sama osoba widzi reklamę średnio ${freq} razy w tygodniu. Przygotuj nową wersję i dodaj ją do zestawu.`,
            impactPerDay: Math.round(Math.max(0, fatigue.roasEarlier - fatigue.roasRecent) * fatigue.spendPerDay),
          });
        }
      } else {
        const others = withSpend.filter((x) => x.g.adId !== g.adId);
        const pb =
          others.length > 0 ? probBetter(totals.purchases, totals.clicks, rest.purchases, rest.clicks) : 0.5;
        const lift = rates.roas != null && restRoas ? rates.roas / restRoas - 1 : 0;
        if (others.length === 0) {
          verdict = { kind: "steady", probability: null, text: "Jedyna reklama w zestawie - nie ma z czym jej porównać." };
        } else if (pb >= CALL && lift >= MATERIAL) {
          verdict = { kind: "winner", probability: pb, text: `${pct(pb)} szans, że sprzedaje lepiej niż reszta zestawu.` };
          if (!paused && rates.roas != null && restRoas != null) {
            const restPerDay = others.reduce((s, x) => s + recentSpendPerDay(x.g, partial), 0);
            const candidate: AbAction = {
              kind: "scale",
              adId: g.adId,
              adsetId: g.adsetId,
              title: `Skaluj: «${name}» sprzedaje najlepiej w zestawie`,
              detail: `${short}: zwrot ${roasText(rates.roas)} wobec ${roasText(restRoas)} w reszcie zestawu, zakup za ${zlCents(rates.cpa ?? 0)} zamiast ${zlCents(restCpa ?? 0)}. Przesuń tu część budżetu.`,
              // A fifth of the rest's daily budget moved onto the winner,
              // halved because extra budget never sells at the same rate.
              impactPerDay: Math.round(0.1 * restPerDay * Math.max(0, rates.roas - restRoas)),
            };
            // One "scale" per ad set: the strongest winner.
            if (!scaleAction || candidate.impactPerDay > scaleAction.impactPerDay) scaleAction = candidate;
          }
        } else if (1 - pb >= CALL && lift <= -MATERIAL && spendShare >= 0.05) {
          verdict = {
            kind: "loser",
            probability: 1 - pb,
            text: paused
              ? `${pct(1 - pb)} szans, że sprzedawała gorzej niż reszta zestawu - dobrze, że jest wstrzymana.`
              : `${pct(1 - pb)} szans, że sprzedaje gorzej niż reszta zestawu.`,
          };
          if (!paused) {
            actions.push({
              kind: "cut",
              adId: g.adId,
              adsetId: g.adsetId,
              title: `Wyłącz: «${name}» przepala ${zl(Math.round(perDay / 1000) * 1000)} dziennie`,
              detail: `${short}: zakup kosztuje ${zlCents(rates.cpa ?? 0)}, a w reszcie zestawu ${zlCents(restCpa ?? 0)}. Te pieniądze sprzedadzą więcej w pozostałych reklamach.`,
              impactPerDay: Math.round(perDay),
            });
          }
        } else {
          const sure = pb >= CALL || 1 - pb >= CALL;
          verdict = {
            kind: "steady",
            probability: pb,
            text: sure
              ? `Sprzedaje ${pb >= 0.5 ? "trochę lepiej" : "trochę słabiej"} niż reszta zestawu - zwrot różni się o mniej niż ${Math.round(MATERIAL * 100)}%.`
              : pb >= 0.5
                ? `Sprzedaje podobnie jak reszta zestawu (${pct(pb)} szans, że lepiej).`
                : `Sprzedaje podobnie jak reszta zestawu (${pct(1 - pb)} szans, że gorzej).`,
          };
          if (!paused && !sure && pb >= 0.8) {
            actions.push({
              kind: "watch",
              adId: g.adId,
              adsetId: g.adsetId,
              title: `Obserwuj: «${name}» może wygrać`,
              detail: `${short}: ${pct(pb)} szans, że sprzedaje lepiej niż reszta zestawu. Przy 90% podpowiemy, żeby ją skalować.`,
              impactPerDay: Math.round(0.1 * perDay * Math.max(0, (rates.roas ?? 0) - (restRoas ?? 0))),
            });
          }
        }
      }

      const firstIdx = g.days.findIndex((d) => d.spend > 0);
      let lastIdx = -1;
      g.days.forEach((d, i) => {
        if (d.spend > 0) lastIdx = i;
      });

      return {
        adId: g.adId,
        adName: name,
        adsetId: g.adsetId,
        adsetName: set.name,
        campaignId: g.campaignId,
        campaignName: set.campaign,
        market: marketOf(set.campaign),
        thumbnailUrl: null,
        status: paused ? "PAUSED" : "ACTIVE",
        createdTime: fromZonedTime(`${addDaysIso(day, -g.since)}T08:${String(10 + (hash(g.adId) % 45)).padStart(2, "0")}:00`, TZ).toISOString(),
        firstDate: firstIdx >= 0 ? g.days[firstIdx].date : null,
        lastDate: lastIdx >= 0 ? g.days[lastIdx].date : null,
        totals,
        rates,
        spendShare,
        probBest: best.get(g.adId) ?? null,
        verdict,
        daily,
      };
    });

    if (scaleAction) actions.push(scaleAction);
    ads.sort((a, b) => b.totals.spend - a.totals.spend);
    const video = ads.some((a) => a.totals.video3s != null)
      ? ads.reduce((s, a) => s + (a.totals.video3s ?? 0), 0)
      : null;
    const totals: AbAdTotals = {
      ...setSum,
      frequency:
        setSum.impressions > 0
          ? ads.reduce((s, a) => s + (a.totals.frequency ?? 0) * a.totals.impressions, 0) / setSum.impressions
          : null,
      video3s: video,
    };
    let leader: AbAd | null = null;
    for (const a of ads) if ((a.probBest ?? 0) >= CALL && (!leader || (a.probBest ?? 0) > (leader.probBest ?? 0))) leader = a;

    tests.push({
      adsetId: ads[0].adsetId,
      adsetName: set.name,
      campaignId: ads[0].campaignId,
      campaignName: set.campaign,
      market: marketOf(set.campaign),
      totals,
      rates: ratesOf(totals),
      ads,
      leaderAdId: leader?.adId ?? null,
    });
  });

  tests.sort((a, b) => b.totals.spend - a.totals.spend);

  // Most money at stake first: up to five decisions, then the one ad most
  // worth watching (a "watch" never pushes a decision off the list).
  actions.sort((a, b) => b.impactPerDay - a.impactPerDay);
  const decisions = actions.filter((a) => a.kind !== "watch").slice(0, 5);
  const watch = actions.find((a) => a.kind === "watch");
  const shortlist = watch ? [...decisions, watch] : decisions;

  const all = tests.flatMap((t) => t.ads);
  const sum = sumDays(all.map((a) => a.totals as unknown as AbDay));
  const video = all.some((a) => a.totals.video3s != null)
    ? all.reduce((s, a) => s + (a.totals.video3s ?? 0), 0)
    : null;
  const totals: AbAdTotals = {
    ...sum,
    frequency:
      sum.impressions > 0
        ? all.reduce((s, a) => s + (a.totals.frequency ?? 0) * a.totals.impressions, 0) / sum.impressions
        : null,
    video3s: video,
  };

  return {
    windowKey,
    start,
    end: day,
    updatedAt,
    available: true,
    totals,
    rates: ratesOf(totals),
    tests,
    actions: shortlist,
    adCount: all.length,
  };
}
