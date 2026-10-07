// Creative A/B test maths for "Testy kreacji". Pure and dependency-free (no
// "@/" imports, no date library, type-only imports) so `node --test` runs it
// as is. lib/ab/load.ts feeds it ads_ad_daily rows; the reaction alerts
// (lib/alerts/creative-tests.ts) reuse the very same verdicts.
//
// The method, plainly:
// - An ad's rate is purchases per LINK click. With a flat Beta(1,1) prior its
//   posterior is Beta(1 + purchases, 1 + clicks - purchases). Meta also counts
//   view-through purchases, so on a tiny ad purchases can exceed clicks: the
//   "failures" are floored at 0. It is a sales rate, not a strict probability.
// - "Beats the rest of its ad set" compares the ad with the POOLED other ads of
//   the set (their purchases and clicks summed). Both posteriors are replaced
//   by normals with the same mean and variance, so
//   P(ad > rest) = Phi((mean_ad - mean_rest) / sqrt(var_ad + var_rest)).
//   That is accurate with a few hundred clicks and misleading with a handful -
//   which is why nothing is called before 10 purchases and 200 clicks.
// - probBest (best ad of its set): 2000 joint draws from the same normals,
//   counting how often each ad comes out on top. The PRNG is seeded from the
//   ad set id, so identical data gives identical numbers on every render.
//   Only ads with >= 200 clicks take part: below that the flat prior (mean
//   50%) would make an unproven ad look like the favourite.
// - The statistics test purchases per click; money decides whether the better
//   seller is worth more. A winner must also return at least its ad set's
//   ROAS (purchase value / spend), a loser must return under 80% of it.
// - Fatigue looks at the ad's own trend, not its rivals: the last 3 finished
//   days against the 7 before them.
//
// Not a randomised experiment: Meta does not split traffic evenly inside an
// ad set (delivery favours early leaders). It is one consistent rule of thumb
// that refuses to speak before there is enough data.

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
} from "./types";

// ------------------------------------------------------------------ settings

/** Below either, an ad is "too early" (its window numbers say nothing yet). */
export const MIN_PURCHASES = 10;
export const MIN_CLICKS = 200;
/** Probability needed to call a winner / loser. */
export const SIGNIFICANCE = 0.95;
/** A loser must matter: at least this share of its ad set's spend. */
export const LOSER_MIN_SPEND_SHARE = 0.1;
/** ...and return under this fraction of the ad set's ROAS. */
export const LOSER_ROAS_RATIO = 0.8;
/** Fatigue: last-3-day ROAS at most this fraction of the 7 days before. */
export const FATIGUE_ROAS_RATIO = 0.7;
/** Fatigue: the earlier 7 days must have had this many purchases... */
export const FATIGUE_MIN_PURCHASES = 10;
/** ...the ad at least this many days with spend... */
export const FATIGUE_MIN_HISTORY_DAYS = 7;
/** ...and frequency rising, or already at least this high. */
export const FATIGUE_HIGH_FREQUENCY = 3;
/**
 * Noise guard: at its earlier cost per purchase the last 3 days' spend should
 * have bought at least this many - otherwise "0 purchases on 40 zł" would
 * read as a collapse.
 */
export const FATIGUE_MIN_EXPECTED_PURCHASES = 3;
/** Days before today the fatigue check reads (3 recent + 7 before). */
export const FATIGUE_LOOKBACK_DAYS = 10;
/** "Scale" means: what if this ad got 30% more budget. */
export const SCALE_STEP = 0.3;
/** "Watch": undecided ads taking more than this share of total spend. */
export const WATCH_MIN_SPEND_SHARE = 0.05;
export const MAX_ACTIONS = 8;
export const PROB_BEST_DRAWS = 2000;
/** AbTest.leaderAdId needs this probBest. */
export const LEADER_MIN_PROB = 0.9;

/** Meta effective_status values meaning the ad no longer delivers. */
const OFF_STATUSES = new Set([
  "PAUSED",
  "ADSET_PAUSED",
  "CAMPAIGN_PAUSED",
  "ARCHIVED",
  "DELETED",
  "DISAPPROVED",
]);

export function isOffStatus(status: string | null | undefined): boolean {
  return status != null && OFF_STATUSES.has(status.toUpperCase());
}

// ------------------------------------------------------------------ dates

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function eachDayIso(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

const FIXED_WINDOW_DAYS: Record<Exclude<AbWindowKey, "season">, number> = {
  today: 1,
  "3d": 3,
  "7d": 7,
  "14d": 14,
  "30d": 30,
};

/** A fixed window ending today (today included): "3d" = today and 2 days before. */
export function fixedWindow(
  key: Exclude<AbWindowKey, "season">,
  today: string
): { start: string; end: string } {
  return { start: addDaysIso(today, -(FIXED_WINDOW_DAYS[key] - 1)), end: today };
}

// ------------------------------------------------------------------ formatting (pl-PL)

const NBSP = " ";

/** Thousands grouped on every number (pl-PL leaves 4 digits ungrouped). */
function groupInt(n: number): string {
  const r = Math.round(Math.abs(n));
  return `${n < 0 && r > 0 ? "-" : ""}${String(r).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)}`;
}

/** Grosze -> whole złoty, "1 240 zł". */
export function formatZl(minor: number): string {
  return `${groupInt(minor / 100)}${NBSP}zł`;
}

/** ROAS-style multiple with one decimal: 9.06 -> "9,1×". */
export function formatX(ratio: number): string {
  return `${(Math.round(ratio * 10) / 10).toFixed(1).replace(".", ",")}×`;
}

/** Probability as a whole percent, never claiming 0% or 100%. */
export function formatChance(p: number): string {
  return `${Math.min(99, Math.max(1, Math.round(p * 100)))}%`;
}

function formatShare(share: number): string {
  return `${Math.max(1, Math.round(share * 100))}%`;
}

function formatDec1(v: number): string {
  return (Math.round(v * 10) / 10).toFixed(1).replace(".", ",");
}

/** Polish count form: 1 zakup, 2-4 zakupy, 5+ zakupów (12-14 too). */
function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const d = n % 10;
  const dd = n % 100;
  return d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many;
}

function quoted(name: string, max = 48): string {
  const s = name.trim();
  return `«${s.length > max ? `${s.slice(0, max - 1)}…` : s}»`;
}

// ------------------------------------------------------------------ probability

export interface Arm {
  purchases: number;
  clicks: number;
}

/** Mean and variance of Beta(1 + purchases, 1 + max(0, clicks - purchases)). */
export function betaPosterior(purchases: number, clicks: number): { mean: number; variance: number } {
  const s = Math.max(0, purchases);
  const f = Math.max(0, clicks - s);
  const a = 1 + s;
  const b = 1 + f;
  const n = a + b;
  return { mean: a / n, variance: (a * b) / (n * n * (n + 1)) };
}

/**
 * Standard normal CDF (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7). Built
 * symmetrically, so normalCdf(x) + normalCdf(-x) === 1.
 */
export function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const poly =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = 1 - poly * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** P(rate of a > rate of b), normal approximation of the two Beta posteriors. */
export function probAbove(a: Arm, b: Arm): number {
  const pa = betaPosterior(a.purchases, a.clicks);
  const pb = betaPosterior(b.purchases, b.clicks);
  return normalCdf((pa.mean - pb.mean) / Math.sqrt(pa.variance + pb.variance));
}

/** 32-bit FNV-1a: a stable PRNG seed from an id. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: tiny, fast, good enough for 2000 draws, and reproducible. */
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

/**
 * P(each arm has the highest rate): Monte Carlo over the normal
 * approximations with a seeded PRNG (Box-Muller). Deterministic for a given
 * (arms, seed, draws); sums to 1.
 */
export function probBest(arms: Arm[], seed: number, draws = PROB_BEST_DRAWS): number[] {
  if (arms.length === 0) return [];
  if (arms.length === 1) return [1];
  const post = arms.map((a) => betaPosterior(a.purchases, a.clicks));
  const sd = post.map((p) => Math.sqrt(p.variance));
  const wins = new Array<number>(arms.length).fill(0);
  const rand = mulberry32(seed);
  let spare: number | null = null;
  const gauss = (): number => {
    if (spare != null) {
      const s = spare;
      spare = null;
      return s;
    }
    const u1 = 1 - rand(); // (0, 1]: log(0) is impossible
    const u2 = rand();
    const r = Math.sqrt(-2 * Math.log(u1));
    spare = r * Math.sin(2 * Math.PI * u2);
    return r * Math.cos(2 * Math.PI * u2);
  };
  for (let d = 0; d < draws; d++) {
    let best = 0;
    let bestValue = -Infinity;
    for (let k = 0; k < arms.length; k++) {
      const v = post[k].mean + sd[k] * gauss();
      if (v > bestValue) {
        bestValue = v;
        best = k;
      }
    }
    wins[best] += 1;
  }
  return wins.map((w) => w / draws);
}

// ------------------------------------------------------------------ verdicts

/** One period of an ad, for the fatigue check. Money in grosze. */
export interface FatiguePeriod {
  spend: number;
  purchases: number;
  value: number;
  /** Reach-weighted average daily frequency; null when unknown. */
  frequency: number | null;
}

export interface FatigueSignal {
  roasBefore: number;
  roasRecent: number;
  freqBefore: number | null;
  freqRecent: number;
  frequencyRising: boolean;
  /**
   * Purchase value lost per day at the CURRENT spend because ROAS fell
   * (recent daily spend x ROAS drop, grosze). Spend-normalised on purpose: a
   * budget cut also lowers daily value, but that is not fatigue.
   */
  valueDropPerDay: number;
}

/**
 * Fatigue: the ad had >= 7 days with spend, its last 3 finished days return
 * <= 70% of the ROAS of the 7 days before (which had >= 10 purchases), and
 * its frequency is rising or already >= 3. Frequency is the reach-weighted
 * average DAILY frequency (unique reach across days isn't additive), so 3 is
 * a high bar - which is intended.
 */
export function detectFatigue(
  activeDays: number,
  before: FatiguePeriod,
  recent: FatiguePeriod,
  recentDays = 3
): FatigueSignal | null {
  if (activeDays < FATIGUE_MIN_HISTORY_DAYS) return null;
  if (before.purchases < FATIGUE_MIN_PURCHASES || before.spend <= 0 || recent.spend <= 0) {
    return null;
  }
  const roasBefore = before.value / before.spend;
  const roasRecent = recent.value / recent.spend;
  // The epsilon keeps "exactly 70%" on the documented side of the line
  // despite floating-point division.
  if (roasBefore <= 0 || roasRecent / roasBefore > FATIGUE_ROAS_RATIO + 1e-9) return null;
  const expected = recent.spend * (before.purchases / before.spend);
  if (expected < FATIGUE_MIN_EXPECTED_PURCHASES) return null;
  if (recent.frequency == null) return null;
  const rising = before.frequency != null && recent.frequency >= before.frequency;
  if (!rising && recent.frequency < FATIGUE_HIGH_FREQUENCY) return null;
  return {
    roasBefore,
    roasRecent,
    freqBefore: before.frequency,
    freqRecent: recent.frequency,
    frequencyRising: rising,
    valueDropPerDay: Math.round((recent.spend / recentDays) * (roasBefore - roasRecent)),
  };
}

export function fatigueText(f: FatigueSignal): string {
  const base = `Zwrot z reklamy spadł z ${formatX(f.roasBefore)} do ${formatX(f.roasRecent)} w 3 dni`;
  return f.frequencyRising
    ? `${base}, częstotliwość rośnie`
    : `${base}, częstotliwość już ${formatDec1(f.freqRecent)}`;
}

export interface VerdictInput {
  /** The ad's window totals. */
  purchases: number;
  clicks: number;
  /** P(ad beats the rest of its set); null = nothing to compare with. */
  pBeatRest: number | null;
  /** The only ad with spend in its ad set (explains a null pBeatRest). */
  alone?: boolean;
  roas: number | null;
  setRoas: number | null;
  spendShare: number;
  fatigue: FatigueSignal | null;
}

/**
 * Precedence, most urgent first:
 * - not enough data in the window -> fatigue if the ad's own history shows
 *   it (that evidence comes from the 7 days before, not the window), else
 *   too_early;
 * - loser (cut beats everything: switching off also ends any fatigue);
 * - fatigue (before winner: scaling an ad that is wearing out loses money);
 * - winner;
 * - steady.
 */
export function verdictFor(v: VerdictInput): AbVerdict {
  const enough = v.purchases >= MIN_PURCHASES && v.clicks >= MIN_CLICKS;
  if (!enough) {
    if (v.fatigue) return { kind: "fatigue", probability: null, text: fatigueText(v.fatigue) };
    return tooEarly(v.purchases, v.clicks);
  }
  const p = v.pBeatRest;
  // An ad set that reports no purchase value can only be judged on the rate.
  const setRoas = v.setRoas != null && v.setRoas > 0 ? v.setRoas : null;
  const roas = v.roas ?? 0;

  if (
    p != null &&
    1 - p >= SIGNIFICANCE &&
    v.spendShare >= LOSER_MIN_SPEND_SHARE &&
    (setRoas == null || roas < LOSER_ROAS_RATIO * setRoas)
  ) {
    return {
      kind: "loser",
      probability: 1 - p,
      text: `${formatChance(1 - p)} szans, że sprzedaje słabiej niż reszta zestawu`,
    };
  }
  if (v.fatigue) return { kind: "fatigue", probability: p, text: fatigueText(v.fatigue) };
  if (p != null && p >= SIGNIFICANCE && (setRoas == null || roas >= setRoas)) {
    return {
      kind: "winner",
      probability: p,
      text: `${formatChance(p)} szans, że sprzedaje lepiej niż reszta zestawu`,
    };
  }
  return { kind: "steady", probability: p, text: steadyText(v, p, roas, setRoas) };
}

function tooEarly(purchases: number, clicks: number): AbVerdict {
  const purchasesNeeded = Math.max(1, MIN_PURCHASES - purchases);
  if (purchases >= MIN_PURCHASES) {
    const n = Math.max(1, MIN_CLICKS - clicks);
    return {
      kind: "too_early",
      probability: null,
      text: `Za wcześnie - potrzeba jeszcze ok. ${n} ${n === 1 ? "kliknięcia" : "kliknięć"}`,
      purchasesNeeded,
    };
  }
  return {
    kind: "too_early",
    probability: null,
    // Genitive after "ok.": 1 zakupu, 2+ zakupów.
    text: `Za wcześnie - potrzeba jeszcze ok. ${purchasesNeeded} ${purchasesNeeded === 1 ? "zakupu" : "zakupów"}`,
    purchasesNeeded,
  };
}

function steadyText(v: VerdictInput, p: number | null, roas: number, setRoas: number | null): string {
  if (p == null) {
    return v.alone
      ? "Jedyna reklama w zestawie - nie ma z czym porównać"
      : "Reszta zestawu ma za mało danych, by porównać";
  }
  if (p >= SIGNIFICANCE && setRoas != null) {
    return `Sprzedaje częściej niż reszta zestawu (${formatChance(p)} szans), ale zwrot ${formatX(roas)} nie przebija zestawu (${formatX(setRoas)})`;
  }
  if (1 - p >= SIGNIFICANCE) {
    const head = `${formatChance(1 - p)} szans, że sprzedaje słabiej niż reszta zestawu`;
    if (v.spendShare < LOSER_MIN_SPEND_SHARE) {
      return `${head}, ale wydaje tylko ${formatShare(v.spendShare)} budżetu zestawu`;
    }
    if (setRoas != null) {
      return `${head}, ale zwrot ${formatX(roas)} trzyma poziom zestawu (${formatX(setRoas)})`;
    }
    return head;
  }
  return `W normie - ${formatChance(p)} szans, że sprzedaje lepiej niż reszta zestawu`;
}

// ------------------------------------------------------------------ view

/** One ads_ad_daily row in app units (money in grosze). */
export interface AbRow {
  date: string;
  adId: string;
  adName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  spend: number;
  impressions: number;
  /** Link clicks. */
  clicks: number;
  reach: number | null;
  frequency: number | null;
  purchases: number;
  value: number;
  video3s: number | null;
}

export interface AbAdMeta {
  thumbnailUrl: string | null;
  status: string | null;
  createdTime: string | null;
}

export interface AbInput {
  windowKey: AbWindowKey;
  start: string;
  end: string;
  /** Warsaw today; the fatigue check and actions are relative to it. */
  today: string;
  /**
   * Rows of [start, end], plus FATIGUE_LOOKBACK_DAYS before today when the
   * window is shorter - those only feed fatigue and first/last dates.
   */
  rows: AbRow[];
  meta?: Record<string, AbAdMeta>;
  updatedAt?: string | null;
  /** Market from campaign + ad set name (lib/season/markets), injected to stay dependency-free. */
  marketOf?: (name: string) => string | null;
}

/** Per-ad facts the view hides but actions and alerts need. */
export interface AbAdAnalysis {
  ad: AbAd;
  /** Average daily spend over the last 3 finished days (grosze). */
  recentDailySpend: number;
  fatigue: FatigueSignal | null;
  /** The ad set's ROAS in the window; null when it reports no value. */
  setRoas: number | null;
  /** Meta says the ad no longer delivers (paused, archived, ...). */
  off: boolean;
}

interface Acc {
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  value: number;
  /** Σ reach and Σ frequency x reach over days where both are known. */
  reach: number;
  freqReach: number;
  video3s: number | null;
}

const newAcc = (): Acc => ({
  spend: 0,
  impressions: 0,
  clicks: 0,
  purchases: 0,
  value: 0,
  reach: 0,
  freqReach: 0,
  video3s: null,
});

function addRow(a: Acc, r: AbRow): void {
  a.spend += r.spend;
  a.impressions += r.impressions;
  a.clicks += r.clicks;
  a.purchases += r.purchases;
  a.value += r.value;
  const reach = r.reach ?? 0;
  const freq = r.frequency ?? (reach > 0 ? r.impressions / reach : null);
  if (reach > 0 && freq != null) {
    a.reach += reach;
    a.freqReach += freq * reach;
  }
  if (r.video3s != null) a.video3s = (a.video3s ?? 0) + r.video3s;
}

function addAcc(a: Acc, b: Acc): void {
  a.spend += b.spend;
  a.impressions += b.impressions;
  a.clicks += b.clicks;
  a.purchases += b.purchases;
  a.value += b.value;
  a.reach += b.reach;
  a.freqReach += b.freqReach;
  if (b.video3s != null) a.video3s = (a.video3s ?? 0) + b.video3s;
}

const freqOf = (a: Acc): number | null => (a.reach > 0 ? a.freqReach / a.reach : null);

function totalsOf(a: Acc): AbAdTotals {
  return {
    spend: a.spend,
    impressions: a.impressions,
    clicks: a.clicks,
    purchases: a.purchases,
    value: a.value,
    frequency: freqOf(a),
    video3s: a.video3s,
  };
}

export function ratesOf(t: AbAdTotals): AbRates {
  return {
    ctr: t.impressions > 0 ? t.clicks / t.impressions : null,
    cvr: t.clicks > 0 ? t.purchases / t.clicks : null,
    cpa: t.purchases > 0 ? Math.round(t.spend / t.purchases) : null,
    roas: t.spend > 0 ? t.value / t.spend : null,
    cpm: t.impressions > 0 ? Math.round((t.spend / t.impressions) * 1000) : null,
    hookRate: t.video3s != null && t.impressions > 0 ? t.video3s / t.impressions : null,
  };
}

interface AdState {
  adId: string;
  newest: string;
  adName: string;
  adsetId: string;
  adsetName: string;
  campaignId: string;
  campaignName: string;
  window: Acc;
  recent: Acc;
  before: Acc;
  daily: Map<string, AbDay>;
  activeDaysBeforeToday: number;
  firstDate: string | null;
  lastDate: string | null;
}

export function emptyAbView(
  windowKey: AbWindowKey,
  start: string,
  end: string,
  updatedAt: string | null = null,
  available = false
): AbView {
  const totals = totalsOf(newAcc());
  return {
    windowKey,
    start,
    end,
    updatedAt,
    available,
    totals,
    rates: ratesOf(totals),
    tests: [],
    actions: [],
    adCount: 0,
  };
}

const byKindOrder: Record<AbAction["kind"], number> = { cut: 0, refresh: 1, scale: 2, watch: 3 };

/** The view plus the per-ad facts behind it (alerts read those). */
export function analyzeAb(input: AbInput): { view: AbView; ads: AbAdAnalysis[] } {
  const { start, end, today } = input;
  // Actions and fatigue speak about NOW; a finished season's window doesn't.
  const live = end >= today;
  const recentStart = addDaysIso(today, -3);
  const recentEnd = addDaysIso(today, -1);
  const beforeStart = addDaysIso(today, -FATIGUE_LOOKBACK_DAYS);
  const beforeEnd = addDaysIso(today, -4);
  const windowDays = eachDayIso(start, end);

  const states = new Map<string, AdState>();
  for (const r of input.rows) {
    let st = states.get(r.adId);
    if (!st) {
      st = {
        adId: r.adId,
        newest: "",
        adName: "",
        adsetId: "",
        adsetName: "",
        campaignId: "",
        campaignName: "",
        window: newAcc(),
        recent: newAcc(),
        before: newAcc(),
        daily: new Map(),
        activeDaysBeforeToday: 0,
        firstDate: null,
        lastDate: null,
      };
      states.set(r.adId, st);
    }
    // Names follow the newest row: ads and ad sets get renamed mid-test.
    if (r.date >= st.newest) {
      st.newest = r.date;
      st.adName = r.adName || st.adName;
      st.adsetId = r.adsetId || st.adsetId;
      st.adsetName = r.adsetName || st.adsetName;
      st.campaignId = r.campaignId || st.campaignId;
      st.campaignName = r.campaignName || st.campaignName;
    }
    if (r.spend > 0) {
      if (st.firstDate == null || r.date < st.firstDate) st.firstDate = r.date;
      if (st.lastDate == null || r.date > st.lastDate) st.lastDate = r.date;
      if (r.date < today) st.activeDaysBeforeToday += 1;
    }
    if (r.date >= start && r.date <= end) {
      addRow(st.window, r);
      const day = st.daily.get(r.date) ?? {
        date: r.date,
        spend: 0,
        impressions: 0,
        clicks: 0,
        purchases: 0,
        value: 0,
      };
      day.spend += r.spend;
      day.impressions += r.impressions;
      day.clicks += r.clicks;
      day.purchases += r.purchases;
      day.value += r.value;
      st.daily.set(r.date, day);
    }
    if (r.date >= recentStart && r.date <= recentEnd) addRow(st.recent, r);
    if (r.date >= beforeStart && r.date <= beforeEnd) addRow(st.before, r);
  }

  // Only ads that spent in the window take part; group them by ad set.
  const sets = new Map<string, AdState[]>();
  const viewAcc = newAcc();
  for (const st of states.values()) {
    if (st.window.spend <= 0) continue;
    addAcc(viewAcc, st.window);
    const key = st.adsetId || `campaign:${st.campaignId}`;
    const list = sets.get(key) ?? [];
    list.push(st);
    sets.set(key, list);
  }

  const analyses: AbAdAnalysis[] = [];
  const tests: AbTest[] = [];

  for (const [setKey, members] of sets) {
    members.sort((a, b) => b.window.spend - a.window.spend || a.adId.localeCompare(b.adId));
    const setAcc = newAcc();
    for (const m of members) addAcc(setAcc, m.window);
    const setRoas = setAcc.spend > 0 && setAcc.value > 0 ? setAcc.value / setAcc.spend : null;

    const contenders = members.filter((m) => m.window.clicks >= MIN_CLICKS);
    const best = new Map<string, number>();
    if (contenders.length >= 2) {
      const p = probBest(
        contenders.map((m) => ({ purchases: m.window.purchases, clicks: m.window.clicks })),
        hashSeed(setKey)
      );
      contenders.forEach((m, i) => best.set(m.adId, p[i]));
    }

    const ads: AbAd[] = [];
    for (const m of members) {
      const rest: Arm = {
        purchases: setAcc.purchases - m.window.purchases,
        clicks: setAcc.clicks - m.window.clicks,
      };
      const alone = members.length === 1;
      const pBeatRest =
        !alone && rest.clicks >= MIN_CLICKS
          ? probAbove({ purchases: m.window.purchases, clicks: m.window.clicks }, rest)
          : null;
      const fatigue = live
        ? detectFatigue(
            m.activeDaysBeforeToday,
            { spend: m.before.spend, purchases: m.before.purchases, value: m.before.value, frequency: freqOf(m.before) },
            { spend: m.recent.spend, purchases: m.recent.purchases, value: m.recent.value, frequency: freqOf(m.recent) }
          )
        : null;
      const roas = m.window.spend > 0 ? m.window.value / m.window.spend : null;
      const spendShare = setAcc.spend > 0 ? m.window.spend / setAcc.spend : 0;
      const verdict = verdictFor({
        purchases: m.window.purchases,
        clicks: m.window.clicks,
        pBeatRest,
        alone,
        roas,
        setRoas,
        spendShare,
        fatigue,
      });
      const meta = input.meta?.[m.adId];
      const totals = totalsOf(m.window);
      const ad: AbAd = {
        adId: m.adId,
        adName: m.adName || m.adId,
        adsetId: m.adsetId,
        adsetName: m.adsetName,
        campaignId: m.campaignId,
        campaignName: m.campaignName,
        market: input.marketOf ? input.marketOf(`${m.campaignName} ${m.adsetName}`) : null,
        thumbnailUrl: meta?.thumbnailUrl ?? null,
        status: meta?.status ?? null,
        createdTime: meta?.createdTime ?? null,
        firstDate: m.firstDate,
        lastDate: m.lastDate,
        totals,
        rates: ratesOf(totals),
        spendShare,
        probBest: best.get(m.adId) ?? null,
        verdict,
        daily: windowDays.map(
          (date) =>
            m.daily.get(date) ?? { date, spend: 0, impressions: 0, clicks: 0, purchases: 0, value: 0 }
        ),
      };
      ads.push(ad);
      analyses.push({
        ad,
        recentDailySpend: Math.round(m.recent.spend / 3),
        fatigue,
        setRoas,
        off: isOffStatus(ad.status),
      });
    }

    let leaderAdId: string | null = null;
    let leaderProb = LEADER_MIN_PROB;
    for (const ad of ads) {
      if (ad.probBest != null && ad.probBest >= leaderProb) {
        leaderProb = ad.probBest;
        leaderAdId = ad.adId;
      }
    }

    const head = members[0];
    const setTotals = totalsOf(setAcc);
    tests.push({
      adsetId: head.adsetId,
      adsetName: head.adsetName,
      campaignId: head.campaignId,
      campaignName: head.campaignName,
      market: input.marketOf ? input.marketOf(`${head.campaignName} ${head.adsetName}`) : null,
      totals: setTotals,
      rates: ratesOf(setTotals),
      ads,
      leaderAdId,
    });
  }

  tests.sort((a, b) => b.totals.spend - a.totals.spend || a.adsetId.localeCompare(b.adsetId));

  const actions = live ? buildActions(analyses, viewAcc.spend) : [];
  const viewTotals = totalsOf(viewAcc);
  return {
    view: {
      windowKey: input.windowKey,
      start,
      end,
      updatedAt: input.updatedAt ?? null,
      available: true,
      totals: viewTotals,
      rates: ratesOf(viewTotals),
      tests,
      actions,
      adCount: analyses.length,
    },
    ads: analyses,
  };
}

export function computeAbView(input: AbInput): AbView {
  return analyzeAb(input).view;
}

/**
 * "Do decyzji dziś". Ads Meta already reports as switched off are skipped -
 * the owner has acted. impactPerDay (grosze):
 * - cut: average daily spend over the last 3 finished days (what stops burning);
 * - scale: +30% of that daily spend x (ad ROAS - ad set ROAS), i.e. the extra
 *   value over spending the same money at the ad set's average;
 * - refresh: the fatigue value drop at current spend;
 * - watch: average daily spend in the window of an undecided big spender.
 */
function buildActions(analyses: AbAdAnalysis[], totalSpend: number): AbAction[] {
  const out: AbAction[] = [];
  for (const a of analyses) {
    if (a.off) continue;
    const { ad } = a;
    const name = quoted(ad.adName);
    const roas = ad.rates.roas ?? 0;
    const kind = ad.verdict.kind;

    if (kind === "loser" && a.recentDailySpend > 0) {
      out.push({
        kind: "cut",
        adId: ad.adId,
        adsetId: ad.adsetId,
        title: `Wyłącz: ${name} przepala ${formatZl(a.recentDailySpend)} dziennie`,
        detail:
          a.setRoas != null
            ? `Zwrot ${formatX(roas)} przy ${formatX(a.setRoas)} w zestawie ${quoted(ad.adsetName)} - ${ad.verdict.text}.`
            : `${ad.verdict.text} (${quoted(ad.adsetName)}).`,
        impactPerDay: a.recentDailySpend,
      });
    } else if (kind === "winner" && a.recentDailySpend > 0 && a.setRoas != null) {
      const extraSpend = SCALE_STEP * a.recentDailySpend;
      const impact = Math.round(extraSpend * (roas - a.setRoas));
      if (impact > 0) {
        out.push({
          kind: "scale",
          adId: ad.adId,
          adsetId: ad.adsetId,
          title: `Zwiększ budżet: ${name} - zwrot ${formatX(roas)} przy ${formatX(a.setRoas)} w zestawie`,
          detail: `Przy +30% budżetu (ok. ${formatZl(extraSpend)} dziennie) to ok. ${formatZl(impact)} sprzedaży dziennie więcej niż średnio w zestawie; ${ad.verdict.text}.`,
          impactPerDay: impact,
        });
      }
    } else if (kind === "fatigue" && a.fatigue && a.fatigue.valueDropPerDay > 0) {
      out.push({
        kind: "refresh",
        adId: ad.adId,
        adsetId: ad.adsetId,
        title: `Odśwież kreację: ${name} się wypala`,
        detail: `${ad.verdict.text}. Przy obecnym budżecie to ok. ${formatZl(a.fatigue.valueDropPerDay)} sprzedaży mniej dziennie.`,
        impactPerDay: a.fatigue.valueDropPerDay,
      });
    } else if (kind === "too_early" && totalSpend > 0) {
      const share = ad.totals.spend / totalSpend;
      const activeDays = ad.daily.filter((d) => d.spend > 0).length;
      const daily = Math.round(ad.totals.spend / Math.max(1, activeDays));
      if (share > WATCH_MIN_SPEND_SHARE && daily > 0) {
        const p = ad.totals.purchases;
        out.push({
          kind: "watch",
          adId: ad.adId,
          adsetId: ad.adsetId,
          title: `Obserwuj: ${name} wydaje ${formatZl(daily)} dziennie bez rozstrzygnięcia`,
          detail: `To ${formatShare(share)} wydatków, a ma dopiero ${p} ${plural(p, "zakup", "zakupy", "zakupów")}. ${ad.verdict.text}.`,
          impactPerDay: daily,
        });
      }
    }
  }
  out.sort(
    (a, b) =>
      b.impactPerDay - a.impactPerDay ||
      byKindOrder[a.kind] - byKindOrder[b.kind] ||
      a.adId.localeCompare(b.adId)
  );
  return out.slice(0, MAX_ACTIONS);
}
