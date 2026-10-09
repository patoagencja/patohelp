// Creative A/B test maths for "Testy kreacji". Pure and dependency-free (no
// "@/" imports, no date library, type-only imports) so `node --test` runs it
// as is. lib/ab/load.ts feeds it ads_ad_daily rows; the reaction alerts
// (lib/alerts/creative-tests.ts) and the public demo (lib/demo/ab.ts) run
// through the very same analyzeAb().
//
// The method, plainly:
// - Only FINISHED days are judged. Today is partial and Meta keeps adding
//   purchases to the last day or two (attribution lag), so a period that
//   includes today makes every ad look worse than it is - and the newest,
//   fastest-growing ones most. "Dziś" is a preview without verdicts.
// - An ad's rate is purchases per LINK click. With a flat Beta(1,1) prior its
//   posterior is Beta(1 + purchases, 1 + clicks - purchases). Meta also counts
//   view-through purchases, so on a tiny ad purchases can exceed clicks: the
//   "failures" are floored at 0. It is a sales rate, not a strict probability.
// - An ad is compared with the REST of its ad set (the other ads' purchases,
//   clicks, spend and value summed), and only on the days the ad delivered:
//   a new ad that ran through the quiet week must not be measured against the
//   rest's busy weekend, and the set total must not contain the ad itself
//   (a big spender would be half of its own benchmark).
// - Both posteriors are replaced by normals with the same mean and variance,
//   so P(ad > k x rest) = Phi((mean_ad - k mean_rest) / sqrt(var_ad + k^2 var_rest)).
//   Accurate with a few hundred clicks, misleading with a handful - which is
//   why nothing is called before 200 clicks and 3 finished days with spend.
// - Statistics say whether an ad sells more often; money and a minimum effect
//   decide whether that is worth moving budget for (see verdictFor).
// - probBest (best ad of its set): 2000 joint draws from the same normals,
//   counting how often each ad comes out on top. The PRNG is seeded from the
//   ad set id, so identical data gives identical numbers on every render.
//   Only ads with >= 200 clicks take part: below that the flat prior (mean
//   50%) would make an unproven ad look like the favourite.
// - Fatigue compares the ad's last 3 finished days with the 7 before them,
//   RELATIVE to the rest of its set over the same days: the whole season
//   cooling down after a peak is not one creative wearing out. Around known
//   sales moments (Black Friday, Mikołajki, Wigilia...) it is not judged.
//
// Not a randomised experiment: Meta does not split traffic evenly inside an
// ad set (delivery favours early leaders). It is one consistent rule of thumb
// that refuses to speak before there is enough data.

import type {
  AbAction,
  AbActionFacts,
  AbAd,
  AbAdTotals,
  AbDay,
  AbRates,
  AbSeries,
  AbTest,
  AbVerdict,
  AbView,
  AbWindowKey,
} from "./types";

// ------------------------------------------------------------------ settings

/** Below either, an ad can't be a winner yet ("too early"). */
export const MIN_PURCHASES = 10;
export const MIN_CLICKS = 200;
/** Finished days with spend before an ad is judged at all (cut or scale). */
export const MIN_DECISION_DAYS = 3;
/** Probability that the ad sells more (winner) / less (loser) than the rest. */
export const SIGNIFICANCE = 0.95;
/**
 * Switching off a big seller by mistake costs the most, so ads spending more
 * than BIG_SPENDER_DAILY a day (average over their days with spend) need this
 * much certainty to be called losers.
 */
export const LOSER_SIGNIFICANCE_BIG = 0.975;
/** 1 000 zł a day, grosze. */
export const BIG_SPENDER_DAILY = 100_000;
/** Winner: purchases per click more than 5% above the rest... */
export const WINNER_MIN_LIFT = 0.05;
/** ...with at least this probability... */
export const WINNER_LIFT_PROB = 0.9;
/** ...and a return at least this multiple of the rest's. */
export const WINNER_ROAS_RATIO = 1.15;
/** A loser must matter: at least this share of its ad set's spend. */
export const LOSER_MIN_SPEND_SHARE = 0.1;
/** ...and return at most this fraction of the rest's ROAS. */
export const LOSER_ROAS_RATIO = 0.8;
/**
 * Sets that report no purchase value have no ROAS to bound the effect, and
 * at a million clicks 2.00% vs 2.06% is "certain". There a loser's purchase
 * rate must be below this fraction of the rest's, with the loser probability.
 */
export const LOSER_RATE_RATIO = 0.9;
/** Fatigue: (ad recent / earlier ROAS) / (rest recent / earlier) at most this. */
export const FATIGUE_RELATIVE_RATIO = 0.75;
/** Fatigue: frequency up at least this much (+15%)... */
export const FATIGUE_FREQ_RISE = 0.15;
/** ...or already at least this high. */
export const FATIGUE_HIGH_FREQUENCY = 3;
/** Fatigue: the earlier 7 days must have had this many purchases... */
export const FATIGUE_MIN_PURCHASES = 10;
/** ...and the ad at least this many days with spend. */
export const FATIGUE_MIN_HISTORY_DAYS = 7;
/**
 * Noise guard: at its earlier cost per purchase the last 3 days' spend should
 * have bought at least this many - otherwise "0 purchases on 40 zł" would
 * read as a collapse.
 */
export const FATIGUE_MIN_EXPECTED_PURCHASES = 3;
/** The recent finished days fatigue looks at, and the days before them. */
export const FATIGUE_RECENT_DAYS = 3;
export const FATIGUE_BEFORE_DAYS = 7;
/** Days before today the fatigue check reads (3 recent + 7 before). */
export const FATIGUE_LOOKBACK_DAYS = FATIGUE_RECENT_DAYS + FATIGUE_BEFORE_DAYS;
/** A sales moment this many days around the fatigue days suppresses it. */
export const MOMENT_MARGIN_DAYS = 1;
/** "Give it more budget" means: what if this ad got 30% more... */
export const SCALE_STEP = 0.3;
/** ...counting half the gain - extra budget never sells at the ad's average. */
export const SCALE_DIMINISHING = 0.5;
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

export function eachDayIso(start: string, end: string): string[] {
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

/**
 * A fixed period. "today" is today alone (a preview); every other one is
 * that many FINISHED days, ending yesterday: "3d" = the 3 days before today.
 */
export function fixedWindow(
  key: Exclude<AbWindowKey, "season">,
  today: string
): { start: string; end: string } {
  if (key === "today") return { start: today, end: today };
  return { start: addDaysIso(today, -FIXED_WINDOW_DAYS[key]), end: addDaysIso(today, -1) };
}

// ------------------------------------------------------------------ formatting (pl-PL)

const NBSP = "\u00a0";

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

/** 0.975 -> "97,5%", 0.95 -> "95%" (thresholds in copy). */
export function formatPct(p: number): string {
  const v = Math.round(p * 1000) / 10;
  return `${Number.isInteger(v) ? v : v.toFixed(1).replace(".", ",")}%`;
}

function formatShare(share: number): string {
  return `${Math.max(1, Math.round(share * 100))}%`;
}

function formatDec1(v: number): string {
  return (Math.round(v * 10) / 10).toFixed(1).replace(".", ",");
}

/**
 * Polish count form: 1 zakup, 2-4 zakupy, 5+ zakupów (12-14 too). The same
 * rule as plPlural in lib/dashboard/story.ts - copied because this module
 * must not import "@/" paths (node --test runs it without the bundler).
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.round(n));
  if (abs === 1) return one;
  const d = abs % 10;
  const dd = abs % 100;
  return d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many;
}

/** „name”, shortened to `max` characters. */
export function quoted(name: string, max = 48): string {
  const s = name.trim();
  return `„${s.length > max ? `${s.slice(0, max - 1)}…` : s}”`;
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

/**
 * P(rate of a > factor x rate of b), normal approximation of the two Beta
 * posteriors. factor 1.05 = "a beats b by more than 5%"; 1 - P(.., 0.9) =
 * "a is more than 10% below b".
 */
export function probAboveBy(a: Arm, b: Arm, factor: number): number {
  const pa = betaPosterior(a.purchases, a.clicks);
  const pb = betaPosterior(b.purchases, b.clicks);
  return normalCdf((pa.mean - factor * pb.mean) / Math.sqrt(pa.variance + factor * factor * pb.variance));
}

/** P(rate of a > rate of b). */
export function probAbove(a: Arm, b: Arm): number {
  return probAboveBy(a, b, 1);
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

// ------------------------------------------------------------------ fatigue

/** One period of an ad (or the rest of its set), for the fatigue check. Money in grosze. */
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
  /**
   * The rest of the set's recent / earlier ROAS over the same days (1 when
   * the rest has too little data to say). 0.6 = the whole set fell by 40%.
   */
  restTrend: number;
  /** (roasRecent / roasBefore) / restTrend. */
  relative: number;
  freqBefore: number | null;
  freqRecent: number;
  frequencyRising: boolean;
  /**
   * Sales lost per day at the CURRENT spend against following the rest's
   * trend: recent daily spend x (roasBefore x restTrend - roasRecent), grosze.
   * Spend-normalised on purpose: a budget cut also lowers daily value, but
   * that is not fatigue.
   */
  valueDropPerDay: number;
}

/** The rest's recent / earlier ROAS, or 1 when it is too thin to trust. */
function restTrendOf(rest: { before: FatiguePeriod; recent: FatiguePeriod } | null | undefined): number {
  if (!rest) return 1;
  const { before, recent } = rest;
  if (before.purchases < FATIGUE_MIN_PURCHASES || before.spend <= 0 || before.value <= 0) return 1;
  if (recent.spend * (before.purchases / before.spend) < FATIGUE_MIN_EXPECTED_PURCHASES) return 1;
  return recent.value / recent.spend / (before.value / before.spend);
}

/**
 * Fatigue: the ad had >= 7 days with spend, the 7 days before its last 3
 * finished days had >= 10 purchases, and the ratio of its last-3-day ROAS to
 * the earlier one, divided by the same ratio for the rest of its set, is at
 * most 0.75 - while its frequency rose by 15%+ or is already >= 3. Frequency
 * is the reach-weighted average DAILY frequency (unique reach across days
 * isn't additive), so 3 is a high bar - which is intended. Known sales
 * moments are handled by the caller (analyzeAb).
 */
export function detectFatigue(
  activeDays: number,
  before: FatiguePeriod,
  recent: FatiguePeriod,
  rest: { before: FatiguePeriod; recent: FatiguePeriod } | null = null,
  recentDays = FATIGUE_RECENT_DAYS
): FatigueSignal | null {
  if (activeDays < FATIGUE_MIN_HISTORY_DAYS) return null;
  if (before.purchases < FATIGUE_MIN_PURCHASES || before.spend <= 0 || recent.spend <= 0) {
    return null;
  }
  const roasBefore = before.value / before.spend;
  const roasRecent = recent.value / recent.spend;
  if (roasBefore <= 0) return null;
  const restTrend = restTrendOf(rest);
  // The rest sold nothing lately: the whole set collapsed (tracking, stock,
  // the site) - not this creative.
  if (restTrend <= 0) return null;
  const relative = roasRecent / roasBefore / restTrend;
  // The epsilon keeps "exactly 0.75" on the documented side of the line
  // despite floating-point division.
  if (relative > FATIGUE_RELATIVE_RATIO + 1e-9) return null;
  const expected = recent.spend * (before.purchases / before.spend);
  if (expected < FATIGUE_MIN_EXPECTED_PURCHASES) return null;
  if (recent.frequency == null) return null;
  const rising =
    before.frequency != null &&
    before.frequency > 0 &&
    recent.frequency >= before.frequency * (1 + FATIGUE_FREQ_RISE) - 1e-9;
  if (!rising && recent.frequency < FATIGUE_HIGH_FREQUENCY) return null;
  return {
    roasBefore,
    roasRecent,
    restTrend,
    relative,
    freqBefore: before.frequency,
    freqRecent: recent.frequency,
    frequencyRising: rising,
    valueDropPerDay: Math.max(
      0,
      Math.round((recent.spend / recentDays) * (roasBefore * restTrend - roasRecent))
    ),
  };
}

export function fatigueText(f: Pick<FatigueSignal, "roasBefore" | "roasRecent" | "frequencyRising" | "freqRecent">): string {
  const base = `Zwrot spadł z ${formatX(f.roasBefore)} do ${formatX(f.roasRecent)} w ostatnich 3 dniach (wobec tygodnia wcześniej)`;
  return f.frequencyRising
    ? `${base}, częstotliwość rośnie`
    : `${base}, częstotliwość już ${formatDec1(f.freqRecent)}`;
}

/** A known sales day (Black Friday, Mikołajki, ...). */
export interface SalesMoment {
  date: string;
  label: string;
}

/** The latest moment within MOMENT_MARGIN_DAYS of [from, to] (the one people remember), or null. */
export function momentNear(moments: SalesMoment[], from: string, to: string): SalesMoment | null {
  let out: SalesMoment | null = null;
  for (const m of moments) {
    const touches = addDaysIso(m.date, MOMENT_MARGIN_DAYS) >= from && addDaysIso(m.date, -MOMENT_MARGIN_DAYS) <= to;
    if (touches && (!out || m.date > out.date)) out = m;
  }
  return out;
}

/** A fall that would read as fatigue, left unjudged because of a sales moment. */
export interface SeasonalDip {
  roasBefore: number;
  roasRecent: number;
  label: string;
}

// ------------------------------------------------------------------ verdicts

export interface VerdictInput {
  /** The ad's purchases and link clicks over the period. */
  ad: Arm;
  /**
   * The rest of its ad set on the days the ad delivered; null when the ad is
   * alone or the rest has under 200 clicks (nothing to compare with).
   */
  rest: Arm | null;
  /** Finished days of the period with spend. */
  deliveryDays: number;
  /** The only ad with spend in its ad set (explains a null rest). */
  alone?: boolean;
  roas: number | null;
  /** The rest's ROAS on the same days; null when it reports no value. */
  restRoas: number | null;
  /** Share of the ad set's spend in the period. */
  spendShare: number;
  /** Average spend per day with spend (grosze). */
  dailySpend: number;
  fatigue: FatigueSignal | null;
  seasonalDip?: SeasonalDip | null;
}

/** The loser bar for this ad: stricter for big spenders. */
export function loserBar(dailySpend: number): number {
  return dailySpend > BIG_SPENDER_DAILY ? LOSER_SIGNIFICANCE_BIG : SIGNIFICANCE;
}

const vs = (roas: number, restRoas: number | null) =>
  restRoas != null ? ` (zwrot ${formatX(roas)} wobec ${formatX(restRoas)} w reszcie zestawu)` : "";

/**
 * Precedence, most urgent first:
 * - loser: P(sells less than the rest) >= 95% (97.5% above 1 000 zł a day),
 *   >= 10% of the set's spend, ROAS <= 0.8x the rest's (no value reported:
 *   the rate below 0.9x the rest's with the same certainty). Gated on clicks
 *   and on the purchases the ad SHOULD have made at the rest's rate, not on
 *   its own: 2 purchases on 5 000 clicks is the clearest loser there is.
 *   Cut beats everything: switching off also ends any fatigue;
 * - not enough data (10 purchases, 200 clicks, 3 finished days) -> fatigue if
 *   the ad's own history shows it (that evidence is its last 10 days, not
 *   the period), else too_early;
 * - fatigue (before winner: giving budget to an ad that is wearing out
 *   loses money);
 * - winner: P(sells more) >= 95%, P(more than 5% more) >= 90%, ROAS >= 1.15x
 *   the rest's;
 * - steady.
 */
export function verdictFor(v: VerdictInput): AbVerdict {
  const { ad, rest } = v;
  const daysOk = v.deliveryDays >= MIN_DECISION_DAYS;
  // An ad set that reports no purchase value can only be judged on the rate.
  const restRoas = v.restRoas != null && v.restRoas > 0 ? v.restRoas : null;
  const roas = v.roas ?? 0;
  const p = rest ? probAbove(ad, rest) : null;

  if (rest && p != null && daysOk && ad.clicks >= MIN_CLICKS && expectedAtRest(ad, rest) >= MIN_PURCHASES) {
    const bar = loserBar(v.dailySpend);
    const effect =
      restRoas != null
        ? roas <= LOSER_ROAS_RATIO * restRoas + 1e-9
        : 1 - probAboveBy(ad, rest, LOSER_RATE_RATIO) >= bar;
    if (1 - p >= bar && v.spendShare >= LOSER_MIN_SPEND_SHARE && effect) {
      return {
        kind: "loser",
        probability: 1 - p,
        text: `${formatChance(1 - p)} szans, że sprzedaje słabiej niż reszta zestawu${vs(roas, restRoas)}`,
      };
    }
  }

  const enough = ad.purchases >= MIN_PURCHASES && ad.clicks >= MIN_CLICKS && daysOk;
  if (!enough) {
    if (v.fatigue) return { kind: "fatigue", probability: null, text: fatigueText(v.fatigue) };
    return tooEarly(ad.purchases, ad.clicks, v.deliveryDays);
  }
  if (v.fatigue) return { kind: "fatigue", probability: p, text: fatigueText(v.fatigue) };
  if (
    rest &&
    p != null &&
    p >= SIGNIFICANCE &&
    probAboveBy(ad, rest, 1 + WINNER_MIN_LIFT) >= WINNER_LIFT_PROB &&
    (restRoas == null || roas >= WINNER_ROAS_RATIO * restRoas - 1e-9)
  ) {
    return {
      kind: "winner",
      probability: p,
      text: `${formatChance(p)} szans, że sprzedaje lepiej niż reszta zestawu${vs(roas, restRoas)}`,
    };
  }
  return { kind: "steady", probability: p, text: steadyText(v, p, roas, restRoas) };
}

/** Purchases the ad would have made at the rest's rate on its own clicks. */
function expectedAtRest(ad: Arm, rest: Arm): number {
  return rest.clicks > 0 ? (ad.clicks * Math.max(0, rest.purchases)) / rest.clicks : 0;
}

function tooEarly(purchases: number, clicks: number, deliveryDays: number): AbVerdict {
  if (purchases < MIN_PURCHASES) {
    const n = MIN_PURCHASES - purchases;
    return {
      kind: "too_early",
      probability: null,
      // Genitive after "ok.": 1 zakupu, 2+ zakupów.
      text: `Za wcześnie - potrzeba jeszcze ok. ${n} ${n === 1 ? "zakupu" : "zakupów"}`,
      purchasesNeeded: n,
    };
  }
  if (clicks < MIN_CLICKS) {
    const n = MIN_CLICKS - clicks;
    return {
      kind: "too_early",
      probability: null,
      text: `Za wcześnie - potrzeba jeszcze ok. ${n} ${n === 1 ? "kliknięcia" : "kliknięć"}`,
      purchasesNeeded: null,
    };
  }
  return {
    kind: "too_early",
    probability: null,
    text: `Za wcześnie - oceniamy po ${MIN_DECISION_DAYS} pełnych dniach emisji (na razie ${deliveryDays} ${deliveryDays === 1 ? "dzień" : "dni"})`,
    purchasesNeeded: null,
  };
}

function steadyText(v: VerdictInput, p: number | null, roas: number, restRoas: number | null): string {
  if (p == null) {
    return v.alone
      ? "Jedyna reklama w zestawie - nie ma z czym porównać"
      : "Reszta zestawu ma za mało danych, by porównać";
  }
  if (v.seasonalDip) {
    const d = v.seasonalDip;
    return `Zwrot spadł z ${formatX(d.roasBefore)} do ${formatX(d.roasRecent)} w ostatnich 3 dniach, ale to okolice szczytu sprzedaży (${d.label}) - zmęczenia wtedy nie oceniamy`;
  }
  if (p >= SIGNIFICANCE) {
    const head = `Sprzedaje częściej niż reszta zestawu (${formatChance(p)} szans)`;
    if (restRoas != null && roas < WINNER_ROAS_RATIO * restRoas) {
      return `${head}, ale zwrot ${formatX(roas)} nie przebija reszty zestawu (${formatX(restRoas)}) o 15%`;
    }
    return `${head}, ale przewaga może być mniejsza niż 5%`;
  }
  if (1 - p >= SIGNIFICANCE) {
    const head = `${formatChance(1 - p)} szans, że sprzedaje słabiej niż reszta zestawu`;
    if (v.spendShare < LOSER_MIN_SPEND_SHARE) {
      return `${head}, ale wydaje tylko ${formatShare(v.spendShare)} budżetu zestawu`;
    }
    if (restRoas != null && roas > LOSER_ROAS_RATIO * restRoas) {
      return `${head}, ale zwrot ${formatX(roas)} nie odstaje od reszty zestawu (${formatX(restRoas)})`;
    }
    if (1 - p < loserBar(v.dailySpend)) {
      return `${head} - przy ponad ${formatZl(BIG_SPENDER_DAILY)} dziennie czekamy na ${formatPct(LOSER_SIGNIFICANCE_BIG)} pewności`;
    }
    return `${head}, ale różnica jest za mała, by wyłączać`;
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
  /**
   * Warsaw today. A period starting today is the preview; any other is cut
   * at yesterday, whatever `end` says. Fatigue and actions are relative to it.
   */
  today: string;
  /**
   * Rows of [start, end], plus FATIGUE_LOOKBACK_DAYS before today when the
   * period is shorter - those only feed fatigue and first/last dates.
   */
  rows: AbRow[];
  meta?: Record<string, AbAdMeta>;
  updatedAt?: string | null;
  /** Market from campaign + ad set name (lib/season/markets), injected to stay dependency-free. */
  marketOf?: (name: string) => string | null;
  /** Known sales moments: fatigue is not judged across them (lib/ab/window.ts). */
  moments?: SalesMoment[];
}

/** Per-ad facts the view hides but actions and alerts need. */
export interface AbAdAnalysis {
  ad: AbAd;
  /** Average daily spend over the last 3 finished days (grosze). */
  recentDailySpend: number;
  fatigue: FatigueSignal | null;
  /** The rest of the ad set on the ad's days: ROAS (null without value) and cost per purchase. */
  restRoas: number | null;
  restCpa: number | null;
  /** Meta says the ad no longer delivers (paused, archived, ...). */
  off: boolean;
  /** This ad's action before the list was cut to MAX_ACTIONS (alerts read it). */
  action: AbAction | null;
}

export interface AbAnalysis {
  view: AbView;
  ads: AbAdAnalysis[];
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

/** a += sign x b. */
function addAcc(a: Acc, b: Acc, sign: 1 | -1 = 1): void {
  a.spend += sign * b.spend;
  a.impressions += sign * b.impressions;
  a.clicks += sign * b.clicks;
  a.purchases += sign * b.purchases;
  a.value += sign * b.value;
  a.reach += sign * b.reach;
  a.freqReach += sign * b.freqReach;
  if (b.video3s != null) a.video3s = (a.video3s ?? 0) + sign * b.video3s;
}

const freqOf = (a: Acc): number | null => (a.reach > 0 ? a.freqReach / a.reach : null);

const period = (a: Acc): FatiguePeriod => ({
  spend: a.spend,
  purchases: a.purchases,
  value: a.value,
  frequency: freqOf(a),
});

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
  /** Every loaded day of the ad (window and look-back). */
  byDate: Map<string, Acc>;
  window: Acc;
  activeDaysBeforeToday: number;
  firstDate: string | null;
  lastDate: string | null;
}

export function emptyAbView(
  windowKey: AbWindowKey,
  start: string,
  end: string,
  today: string,
  updatedAt: string | null = null,
  available = false
): AbView {
  const totals = totalsOf(newAcc());
  return {
    windowKey,
    start,
    end,
    today,
    monitor: start >= today,
    updatedAt,
    available,
    totals,
    rates: ratesOf(totals),
    days: [],
    tests: [],
    actions: [],
    adCount: 0,
  };
}

const PREVIEW: AbVerdict = {
  kind: "preview",
  probability: null,
  text: "Dziś tylko podgląd - decyzje liczymy na pełnych dniach",
};

const toDay = (date: string, a: Acc | undefined): AbDay => ({
  date,
  spend: a?.spend ?? 0,
  impressions: a?.impressions ?? 0,
  clicks: a?.clicks ?? 0,
  purchases: a?.purchases ?? 0,
  value: a?.value ?? 0,
});

/** The view plus the per-ad facts behind it (actions and alerts read those). */
export function analyzeAb(input: AbInput): AbAnalysis {
  const { start, today } = input;
  const yesterday = addDaysIso(today, -1);
  // A period starting today is the preview: today's numbers, no calls.
  const monitor = start >= today;
  const end = monitor || input.end < today ? input.end : yesterday;
  // Actions and fatigue speak about NOW; a finished season's period doesn't.
  const live = !monitor && end >= yesterday;
  const recentStart = addDaysIso(today, -FATIGUE_RECENT_DAYS);
  const beforeStart = addDaysIso(today, -FATIGUE_LOOKBACK_DAYS);
  const beforeEnd = addDaysIso(recentStart, -1);
  const windowDays = eachDayIso(start, end);
  const moment = live ? momentNear(input.moments ?? [], beforeStart, yesterday) : null;

  const states = new Map<string, AdState>();
  for (const r of input.rows) {
    if (r.date > end) continue;
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
        byDate: new Map(),
        window: newAcc(),
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
    let day = st.byDate.get(r.date);
    if (!day) {
      day = newAcc();
      st.byDate.set(r.date, day);
    }
    addRow(day, r);
    if (r.date >= start) addRow(st.window, r);
  }

  // Ad sets over every loaded ad (the rest of a set on a look-back day may
  // be an ad without spend in the window); only ads that spent in the
  // window are shown and judged.
  const sets = new Map<string, AdState[]>();
  for (const st of states.values()) {
    const key = st.adsetId || `campaign:${st.campaignId}`;
    const list = sets.get(key) ?? [];
    list.push(st);
    sets.set(key, list);
  }

  const viewAcc = newAcc();
  const viewDays = new Map<string, Acc>();
  const analyses: AbAdAnalysis[] = [];
  const tests: AbTest[] = [];

  for (const [setKey, all] of sets) {
    const members = all.filter((m) => m.window.spend > 0);
    if (members.length === 0) continue;
    members.sort((a, b) => b.window.spend - a.window.spend || a.adId.localeCompare(b.adId));

    const setDays = new Map<string, Acc>();
    for (const m of all) {
      for (const [date, a] of m.byDate) {
        let d = setDays.get(date);
        if (!d) {
          d = newAcc();
          setDays.set(date, d);
        }
        addAcc(d, a);
      }
    }
    const setAcc = newAcc();
    for (const m of members) {
      addAcc(setAcc, m.window);
      addAcc(viewAcc, m.window);
      for (const date of windowDays) {
        const a = m.byDate.get(date);
        if (!a) continue;
        let d = viewDays.get(date);
        if (!d) {
          d = newAcc();
          viewDays.set(date, d);
        }
        addAcc(d, a);
      }
    }

    /** The ad and the rest of its set over [from, to], on the ad's days with spend only. */
    const split = (m: AdState, from: string, to: string) => {
      const ad = newAcc();
      const rest = newAcc();
      let days = 0;
      for (const [date, a] of m.byDate) {
        if (date < from || date > to || a.spend <= 0) continue;
        days += 1;
        addAcc(ad, a);
        addAcc(rest, setDays.get(date)!);
        addAcc(rest, a, -1);
      }
      return { ad, rest, days };
    };

    const contenders = monitor ? [] : members.filter((m) => m.window.clicks >= MIN_CLICKS);
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
      const win = split(m, start, end);
      const alone = members.length === 1;
      const restRoas = win.rest.spend > 0 && win.rest.value > 0 ? win.rest.value / win.rest.spend : null;
      const restCpa = win.rest.purchases > 0 ? Math.round(win.rest.spend / win.rest.purchases) : null;
      const recent = split(m, recentStart, yesterday);

      let fatigue: FatigueSignal | null = null;
      let seasonalDip: SeasonalDip | null = null;
      if (live) {
        const before = split(m, beforeStart, beforeEnd);
        const signal = detectFatigue(m.activeDaysBeforeToday, period(before.ad), period(recent.ad), {
          before: period(before.rest),
          recent: period(recent.rest),
        });
        if (signal && moment) {
          seasonalDip = { roasBefore: signal.roasBefore, roasRecent: signal.roasRecent, label: moment.label };
        } else fatigue = signal;
      }

      const roas = m.window.spend > 0 ? m.window.value / m.window.spend : null;
      const spendShare = setAcc.spend > 0 ? m.window.spend / setAcc.spend : 0;
      const verdict = monitor
        ? PREVIEW
        : verdictFor({
            ad: { purchases: m.window.purchases, clicks: m.window.clicks },
            rest: !alone && win.rest.clicks >= MIN_CLICKS ? { purchases: win.rest.purchases, clicks: win.rest.clicks } : null,
            deliveryDays: win.days,
            alone,
            roas,
            restRoas,
            spendShare,
            dailySpend: m.window.spend / Math.max(1, win.days),
            fatigue,
            seasonalDip,
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
        deliveryDays: win.days,
        totals,
        rates: ratesOf(totals),
        spendShare,
        probBest: best.get(m.adId) ?? null,
        verdict,
      };
      ads.push(ad);
      analyses.push({
        ad,
        recentDailySpend: Math.round(recent.ad.spend / FATIGUE_RECENT_DAYS),
        fatigue,
        restRoas,
        restCpa,
        off: isOffStatus(ad.status),
        action: null,
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
      today,
      monitor,
      updatedAt: input.updatedAt ?? null,
      available: true,
      totals: viewTotals,
      rates: ratesOf(viewTotals),
      days: windowDays.map((date) => toDay(date, viewDays.get(date))),
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

const byKindOrder: Record<AbAction["kind"], number> = { cut: 0, refresh: 1, scale: 2, watch: 3 };

/**
 * "Do decyzji dziś". Ads Meta already reports as switched off are skipped -
 * the owner has acted. impactPerDay (grosze of SALES per day, so the three
 * decisions sort together):
 * - cut: recent daily spend x (rest ROAS - ad ROAS). Switching an ad off does
 *   not save its budget - Meta spends it on the rest of the set - so the gain
 *   is what that money sells there instead;
 * - scale: half of 30% more daily spend x (ad ROAS - rest ROAS), the extra
 *   budget taken from the rest; halved because more budget never sells at
 *   the ad's average. At most one per ad set (they would draw on the same
 *   budget);
 * - refresh: the fatigue value drop against the rest's trend at current spend;
 * - watch (after every decision, a different unit): an undecided big
 *   spender's average daily spend.
 * Every ad's action is stored on its analysis before the list is cut, so the
 * alerts see all of them.
 */
function buildActions(analyses: AbAdAnalysis[], totalSpend: number): AbAction[] {
  const decisions: Array<{ a: AbAdAnalysis; action: AbAction }> = [];
  const watches: Array<{ a: AbAdAnalysis; action: AbAction }> = [];
  const scaleBySet = new Map<string, { a: AbAdAnalysis; action: AbAction }>();

  for (const a of analyses) {
    if (a.off) continue;
    const { ad } = a;
    const name = quoted(ad.adName);
    const roas = ad.rates.roas ?? 0;
    const kind = ad.verdict.kind;
    const cpaRatio = ad.rates.cpa != null && a.restCpa ? ad.rates.cpa / a.restCpa : null;
    // The same numbers the sentences below are written from (AbActionFacts).
    const facts = (over: Partial<AbActionFacts>): AbActionFacts => ({
      dailySpend: a.recentDailySpend,
      restRoas: a.restRoas,
      cpaRatio,
      extraSpend: null,
      roasBefore: null,
      roasRecent: null,
      frequencyRising: null,
      spendShare: null,
      ...over,
    });

    if (kind === "loser" && a.recentDailySpend > 0 && a.restRoas != null) {
      const impact = Math.round(a.recentDailySpend * (a.restRoas - roas));
      if (impact <= 0) continue;
      decisions.push({
        a,
        action: {
          kind: "cut",
          adId: ad.adId,
          adsetId: ad.adsetId,
          title:
            cpaRatio != null && cpaRatio >= 1
              ? `Wyłącz ${name}: zakup ${formatX(cpaRatio)} droższy niż w reszcie zestawu`
              : `Wyłącz ${name}: zwrot ${formatX(roas)} przy ${formatX(a.restRoas)} w reszcie zestawu`,
          detail: `${ad.verdict.text}. Wydaje ok. ${formatZl(a.recentDailySpend)} dziennie - po wyłączeniu Meta przesunie ten budżet na pozostałe reklamy zestawu.`,
          impactPerDay: impact,
          facts: facts({}),
        },
      });
    } else if (kind === "winner" && a.recentDailySpend > 0 && a.restRoas != null) {
      const extraSpend = SCALE_STEP * a.recentDailySpend;
      const impact = Math.round(SCALE_DIMINISHING * extraSpend * (roas - a.restRoas));
      if (impact <= 0) continue;
      const candidate = {
        a,
        action: {
          kind: "scale" as const,
          adId: ad.adId,
          adsetId: ad.adsetId,
          title: `Daj więcej budżetu ${name}: wyłącz słabsze reklamy w zestawie albo przenieś ją do osobnego zestawu`,
          detail: `${ad.verdict.text}. Przy +30% budżetu (ok. ${formatZl(extraSpend)} dziennie ze słabszych reklam) to ok. +${formatZl(impact)} sprzedaży dziennie - liczymy połowę różnicy, bo dodatkowy budżet sprzedaje gorzej.`,
          impactPerDay: impact,
          facts: facts({ extraSpend }),
        },
      };
      const setKey = ad.adsetId || `campaign:${ad.campaignId}`;
      const prev = scaleBySet.get(setKey);
      if (!prev || impact > prev.action.impactPerDay) scaleBySet.set(setKey, candidate);
    } else if (kind === "fatigue" && a.fatigue && a.fatigue.valueDropPerDay > 0) {
      decisions.push({
        a,
        action: {
          kind: "refresh",
          adId: ad.adId,
          adsetId: ad.adsetId,
          title: `Odśwież ${name}: kreacja się wypala`,
          detail: `${ad.verdict.text}. Przy obecnym budżecie to ok. ${formatZl(a.fatigue.valueDropPerDay)} sprzedaży mniej dziennie, niż gdyby szła jak reszta zestawu - przygotuj nową wersję.`,
          impactPerDay: a.fatigue.valueDropPerDay,
          facts: facts({
            roasBefore: a.fatigue.roasBefore,
            roasRecent: a.fatigue.roasRecent,
            frequencyRising: a.fatigue.frequencyRising,
          }),
        },
      });
    } else if (kind === "too_early" && totalSpend > 0) {
      const share = ad.totals.spend / totalSpend;
      const daily = Math.round(ad.totals.spend / Math.max(1, ad.deliveryDays));
      if (share > WATCH_MIN_SPEND_SHARE && daily > 0) {
        const p = ad.totals.purchases;
        watches.push({
          a,
          action: {
            kind: "watch",
            adId: ad.adId,
            adsetId: ad.adsetId,
            title: `Obserwuj ${name}: wydaje ${formatZl(daily)} dziennie bez rozstrzygnięcia`,
            detail: `To ${formatShare(share)} wydatków, a ma dopiero ${p} ${plural(p, "zakup", "zakupy", "zakupów")}. ${ad.verdict.text}.`,
            impactPerDay: daily,
            facts: facts({ dailySpend: daily, spendShare: share }),
          },
        });
      }
    }
  }
  decisions.push(...scaleBySet.values());

  const order = (x: { action: AbAction }, y: { action: AbAction }) =>
    y.action.impactPerDay - x.action.impactPerDay ||
    byKindOrder[x.action.kind] - byKindOrder[y.action.kind] ||
    x.action.adId.localeCompare(y.action.adId);
  decisions.sort(order);
  watches.sort(order);
  const all = [...decisions, ...watches];
  for (const { a, action } of all) a.action = action;
  return all.slice(0, MAX_ACTIONS).map((x) => x.action);
}

// ------------------------------------------------------------------ compare series

/** Rows for a few ads -> one zero-filled series per ad over [start, end]. */
export function buildAbSeries(
  adIds: string[],
  start: string,
  end: string,
  rows: Array<Omit<AbDay, "date"> & { date: string; adId: string }>
): AbSeries[] {
  const dates = eachDayIso(start, end);
  const byAd = new Map<string, Map<string, AbDay>>();
  for (const id of adIds) byAd.set(id, new Map());
  for (const r of rows) {
    const m = byAd.get(r.adId);
    if (!m || r.date < start || r.date > end) continue;
    const d = m.get(r.date) ?? toDay(r.date, undefined);
    d.spend += r.spend;
    d.impressions += r.impressions;
    d.clicks += r.clicks;
    d.purchases += r.purchases;
    d.value += r.value;
    m.set(r.date, d);
  }
  return adIds.map((adId) => ({
    adId,
    days: dates.map((date) => byAd.get(adId)!.get(date) ?? toDay(date, undefined)),
  }));
}
