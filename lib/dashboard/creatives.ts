/**
 * Creative (single ad) scoring for the "Kreacje" tab.
 *
 * Everything here is deterministic and derived only from what the
 * `creatives` table stores: spend, impressions, clicks, ctr, cpc and (since
 * migration 0025, all optional) reach, frequency, Meta's relevance rankings
 * and video retention counts. Every optional metric may be missing - before
 * the migration, for static ads, or below Meta's thresholds - and the copy
 * below never fills a gap with a guess.
 * Pure functions - safe to import from Server and Client Components.
 */

import { formatMoneyPLN, formatNumberPL } from "@/lib/utils";

export type Lang = "pl" | "en";

/** Raw counts from Meta's video insights (null = not reported). */
export interface CreativeVideoStats {
  /** Meta "3-second video plays" (actions[video_view]). */
  plays3s: number | null;
  /** Watched to the end or for 15s+, whichever comes first. */
  thruplays: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p100: number | null;
  avgWatchSeconds: number | null;
}

export interface CreativeItem {
  adId: string;
  name: string;
  thumbnailUrl: string | null;
  /** Minor units (grosze). */
  spend: number;
  impressions: number;
  clicks: number;
  /** Percent units, e.g. 2.4 = 2.4%. */
  ctr: number | null;
  /** Minor units (grosze). */
  cpc: number | null;
  // Optional so older data sources (demo, pre-0025 rows) stay valid as-is.
  reach?: number | null;
  /** Average times one person saw the ad over the period. */
  frequency?: number | null;
  /** Raw Meta enum, e.g. "ABOVE_AVERAGE", "BELOW_AVERAGE_20", "UNKNOWN". */
  qualityRanking?: string | null;
  engagementRanking?: string | null;
  conversionRanking?: string | null;
  /** Null/absent for static and carousel ads. */
  video?: CreativeVideoStats | null;
}

// Below these floors a single lucky click swings CTR/CPC wildly, so such ads
// are never ranked, awarded or compared - they get "too early to judge".
export const MIN_IMPRESSIONS = 1000;
export const MIN_CLICKS = 30;

// +/-15% band around the average reads as "about average"; tighter bands
// would flip verdicts on noise from day to day.
const BETTER_AT = 1.15;
const WORSE_AT = 1 / BETTER_AT;

export interface Benchmarks {
  /** Volume-weighted CTR in percent (total clicks / total impressions). */
  ctr: number | null;
  /** Volume-weighted CPC in minor units (total spend / total clicks). */
  cpc: number | null;
  totalImpressions: number;
  totalClicks: number;
  totalSpend: number;
  count: number;
  /**
   * Volume-weighted hook rate (0-1) across video ads only - comparing a video
   * against static ads, which cannot have a hook, would be meaningless.
   */
  hookRate: number | null;
  /** Video ads with enough views to be compared against `hookRate`. */
  videoCount: number;
}

export function ctrOf(c: CreativeItem): number | null {
  if (c.ctr != null && Number.isFinite(c.ctr)) return c.ctr;
  return c.impressions > 0 ? (c.clicks / c.impressions) * 100 : null;
}

export function cpcOf(c: CreativeItem): number | null {
  if (c.cpc != null && Number.isFinite(c.cpc) && c.cpc > 0) return c.cpc;
  return c.clicks > 0 ? c.spend / c.clicks : null;
}

export function hasEnoughData(c: CreativeItem): boolean {
  return c.impressions >= MIN_IMPRESSIONS;
}

/**
 * Weighted (not simple) averages: a simple mean would let a 500-impression
 * test with 6% CTR drag "your average" far from what the budget really buys.
 */
export function computeBenchmarks(creatives: CreativeItem[]): Benchmarks {
  let imp = 0;
  let clk = 0;
  let spd = 0;
  let vidImp = 0;
  let vid3s = 0;
  let videoCount = 0;
  for (const c of creatives) {
    imp += c.impressions;
    clk += c.clicks;
    spd += c.spend;
    const plays = c.video?.plays3s;
    if (plays != null && c.impressions > 0) {
      vidImp += c.impressions;
      vid3s += Math.min(plays, c.impressions);
      if (hasEnoughData(c)) videoCount += 1;
    }
  }
  return {
    ctr: imp > 0 ? (clk / imp) * 100 : null,
    cpc: clk > 0 ? spd / clk : null,
    totalImpressions: imp,
    totalClicks: clk,
    totalSpend: spd,
    count: creatives.length,
    hookRate: vidImp > 0 ? vid3s / vidImp : null,
    videoCount,
  };
}

// ---------------------------------------------------------------------------
// Video retention (hook / hold / completion)
// ---------------------------------------------------------------------------

export interface VideoRates {
  /** 3s plays / impressions (0-1): how often the video stops the scroll. */
  hook: number | null;
  /** ThruPlays / 3s plays (0-1): of those hooked, how many kept watching. */
  hold: number | null;
  /** 100% plays / 3s plays (0-1): of those hooked, how many saw the end. */
  completion: number | null;
  avgWatchSeconds: number | null;
}

// Rates are clamped to 1: Meta counts plays and impressions slightly
// differently (replays, attribution lag), and "104% watched" would read as a bug.
function rate(part: number | null | undefined, whole: number | null | undefined): number | null {
  if (part == null || whole == null || whole <= 0) return null;
  return Math.min(Math.max(part / whole, 0), 1);
}

/** Null for non-video ads (no 3-second play data at all). */
export function videoRatesOf(c: CreativeItem): VideoRates | null {
  const v = c.video;
  if (!v || v.plays3s == null) return null;
  return {
    hook: rate(v.plays3s, c.impressions),
    hold: rate(v.thruplays, v.plays3s),
    completion: rate(v.p100, v.plays3s),
    avgWatchSeconds:
      v.avgWatchSeconds != null && v.avgWatchSeconds > 0 ? v.avgWatchSeconds : null,
  };
}

function pct0(fraction: number): number {
  return Math.round(fraction * 100);
}

/** "Zatrzymuje uwagę: w 34 na 100 wyświetleń ktoś ogląda dłużej niż 3 sekundy." */
export function hookSentence(hook: number, lang: Lang): string {
  // Phrased per 100 *views*, not people: both counts are per impression.
  const n = pct0(hook);
  return lang === "en"
    ? `Stops the scroll: in ${n} of every 100 views, people watch for more than 3 seconds.`
    : `Zatrzymuje uwagę: w ${n} na 100 wyświetleń ktoś ogląda dłużej niż 3 sekundy.`;
}

/** "Do końca dotrwało 12% oglądających." */
export function completionSentence(completion: number, lang: Lang): string {
  const n = pct0(completion);
  return lang === "en"
    ? `${n}% of viewers watched to the end.`
    : `Do końca dotrwało ${n}% oglądających.`;
}

export function holdSentence(hold: number, lang: Lang): string {
  const n = pct0(hold);
  return lang === "en"
    ? `${n}% of viewers watched 15 seconds or the whole video.`
    : `${n}% oglądających obejrzało 15 sekund lub cały film.`;
}

// ---------------------------------------------------------------------------
// Meta relevance diagnostics (quality / engagement / conversion rankings)
// ---------------------------------------------------------------------------

/** Meta itself returns UNKNOWN below this, and we never trust less. */
export const RANKING_MIN_IMPRESSIONS = 500;

export type RankingKind = "quality" | "engagement" | "conversion";
export type RankingLevel = "above" | "average" | "below35" | "below20" | "below10";
export type RankingTone = "good" | "neutral" | "bad";

const RANKING_LEVEL: Record<string, RankingLevel> = {
  ABOVE_AVERAGE: "above",
  AVERAGE: "average",
  BELOW_AVERAGE_35: "below35",
  BELOW_AVERAGE_20: "below20",
  BELOW_AVERAGE_10: "below10",
};

function rawRanking(c: CreativeItem, kind: RankingKind): string | null | undefined {
  if (kind === "quality") return c.qualityRanking;
  if (kind === "engagement") return c.engagementRanking;
  return c.conversionRanking;
}

/** Null for UNKNOWN, unrecognised values, or too few impressions. */
export function rankingOf(c: CreativeItem, kind: RankingKind): RankingLevel | null {
  if (c.impressions < RANKING_MIN_IMPRESSIONS) return null;
  const raw = rawRanking(c, kind);
  if (!raw) return null;
  return RANKING_LEVEL[raw.toUpperCase()] ?? null;
}

function isBelow(level: RankingLevel | null): boolean {
  return level === "below35" || level === "below20" || level === "below10";
}

const RANKING_NAME: Record<Lang, Record<RankingKind, string>> = {
  pl: { quality: "Jakość reklamy", engagement: "Zaangażowanie", conversion: "Realizacja celu" },
  en: { quality: "Ad quality", engagement: "Engagement", conversion: "Goal completion" },
};

const RANKING_SHORT: Record<Lang, Record<RankingKind, string>> = {
  pl: { quality: "Jakość", engagement: "Zaangażowanie", conversion: "Cel" },
  en: { quality: "Quality", engagement: "Engagement", conversion: "Goal" },
};

// Level phrases avoid adjectives so they agree with any metric's gender
// ("Jakość ... średnia" vs "Zaangażowanie ... średnie").
const RANKING_LEVEL_LABEL: Record<Lang, Record<RankingLevel, string>> = {
  pl: {
    above: "powyżej średniej",
    average: "na poziomie średniej",
    below35: "poniżej średniej",
    below20: "wyraźnie poniżej średniej",
    below10: "wśród najsłabszych 10%",
  },
  en: {
    above: "above average",
    average: "average",
    below35: "below average",
    below20: "well below average",
    below10: "in the bottom 10%",
  },
};

const RANKING_WHAT: Record<Lang, Record<RankingKind, string>> = {
  pl: {
    quality: "jak odbiorcy oceniają samą reklamę",
    engagement: "jak często ludzie reagują na reklamę (kliknięcia, reakcje, komentarze)",
    conversion: "jak często reklama prowadzi do celu kampanii",
  },
  en: {
    quality: "how people perceive the ad itself",
    engagement: "how often people interact with the ad (clicks, reactions, comments)",
    conversion: "how often the ad leads to the campaign's goal",
  },
};

export interface RankingChip {
  kind: RankingKind;
  level: RankingLevel;
  tone: RankingTone;
  /** "Jakość reklamy: powyżej średniej" */
  label: string;
  /** "Jakość: powyżej średniej" - for narrow cards. */
  short: string;
  /** Tooltip: what is measured and against whom. */
  hint: string;
}

export function rankingChips(
  c: CreativeItem,
  lang: Lang,
  kinds: RankingKind[] = ["quality", "engagement"]
): RankingChip[] {
  const en = lang === "en";
  const out: RankingChip[] = [];
  for (const kind of kinds) {
    const level = rankingOf(c, kind);
    if (!level) continue;
    const lvl = RANKING_LEVEL_LABEL[lang][level];
    // Meta compares against ads competing for the same audience - not a
    // whole industry - so the hint says exactly that.
    const bottom =
      level === "below35" ? 35 : level === "below20" ? 20 : level === "below10" ? 10 : null;
    const against = en
      ? bottom
        ? `in the bottom ${bottom}% of ads competing for the same audience`
        : "compared with ads competing for the same audience"
      : bottom
        ? `w dolnych ${bottom}% reklam walczących o tych samych odbiorców`
        : "na tle reklam walczących o tych samych odbiorców";
    out.push({
      kind,
      level,
      tone: level === "above" ? "good" : level === "average" ? "neutral" : "bad",
      label: `${RANKING_NAME[lang][kind]}: ${lvl}`,
      short: `${RANKING_SHORT[lang][kind]}: ${lvl}`,
      hint: en
        ? `Meta's rating of ${RANKING_WHAT[lang][kind]} - ${against}.`
        : `Ocena Meta: ${RANKING_WHAT[lang][kind]} - ${against}.`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fatigue ("Do odświeżenia")
// ---------------------------------------------------------------------------

/**
 * Over our 30-day window an average person seeing an ad more than 3 times is
 * common for small audiences and NOT a problem by itself. It only counts as
 * fatigue when a second, independent signal says people stopped responding.
 */
export const FATIGUE_FREQUENCY = 3;
/** Hook rate below 70% of the client's video average = "well below". */
const FATIGUE_HOOK_RATIO = 0.7;
/** A video average built from fewer ads is too shaky to judge against. */
const FATIGUE_MIN_VIDEOS = 3;

export type FatigueSignal = "engagement" | "hook";

export interface Fatigue {
  frequency: number;
  signals: FatigueSignal[];
  /** This ad's hook vs the client's video average (only with "hook"). */
  hookRatio: number | null;
}

export function frequencyOf(c: CreativeItem): number | null {
  if (c.frequency != null && Number.isFinite(c.frequency) && c.frequency > 0) return c.frequency;
  return c.reach != null && c.reach > 0 ? c.impressions / c.reach : null;
}

export function fatigueOf(c: CreativeItem, b: Benchmarks): Fatigue | null {
  if (!hasEnoughData(c)) return null;
  const freq = frequencyOf(c);
  if (freq == null || freq <= FATIGUE_FREQUENCY) return null;

  const signals: FatigueSignal[] = [];
  if (isBelow(rankingOf(c, "engagement"))) signals.push("engagement");

  let hookRatio: number | null = null;
  const hook = videoRatesOf(c)?.hook ?? null;
  if (hook != null && b.hookRate && b.videoCount >= FATIGUE_MIN_VIDEOS) {
    hookRatio = hook / b.hookRate;
    if (hookRatio < FATIGUE_HOOK_RATIO) signals.push("hook");
  }
  if (signals.length === 0) return null;
  return { frequency: freq, signals, hookRatio: signals.includes("hook") ? hookRatio : null };
}

export function fatigueHeadline(lang: Lang): string {
  return lang === "en"
    ? "People have seen this ad too often - worth refreshing"
    : "Reklama się opatrzyła - warto ją odświeżyć";
}

/** "Przeciętny odbiorca widział ją 3,8 razy, a zaangażowanie jest poniżej średniej." */
export function fatigueReason(f: Fatigue, lang: Lang): string {
  const en = lang === "en";
  const freq = fmtDec(f.frequency, lang);
  const parts: string[] = [];
  if (f.signals.includes("engagement")) {
    parts.push(en ? "engagement is below average" : "zaangażowanie jest poniżej średniej");
  }
  if (f.signals.includes("hook") && f.hookRatio != null) {
    const p = Math.round((1 - f.hookRatio) * 100);
    parts.push(
      en
        ? `it stops the scroll ${p}% less often than your average video`
        : `reklama zatrzymuje uwagę o ${p}% rzadziej niż przeciętny Twój film`
    );
  }
  const joined = parts.join(en ? " and " : " i ");
  return en
    ? `The average person has already seen it ${freq} times, and ${joined}.`
    : `Przeciętny odbiorca widział ją już ${freq} razy, a ${joined}.`;
}

export type Verdict = "better" | "average" | "worse" | "unknown";

export interface CreativeScore {
  /** CTR relative to average (1 = average, 2 = twice as clickable). */
  ctrRatio: number | null;
  /** Average CPC / this CPC (1 = average, 2 = half the price). */
  cpcRatio: number | null;
  /** Combined efficiency index, 1 = average. Null when data is too thin. */
  index: number | null;
  verdict: Verdict;
}

export function scoreCreative(c: CreativeItem, b: Benchmarks): CreativeScore {
  if (!hasEnoughData(c) || b.ctr == null || b.ctr <= 0) {
    return { ctrRatio: null, cpcRatio: null, index: null, verdict: "unknown" };
  }
  const ctr = ctrOf(c);
  const cpc = cpcOf(c);
  const ctrRatio = ctr != null ? ctr / b.ctr : null;
  const cpcRatio =
    // cpc of 0 (clicks synced before spend) would make this Infinity.
    c.clicks >= MIN_CLICKS && cpc != null && cpc > 0 && b.cpc != null ? b.cpc / cpc : null;

  // Geometric mean keeps the two signals symmetric: 2x better on one and 2x
  // worse on the other nets out to exactly "average".
  let index: number | null = null;
  if (ctrRatio != null && cpcRatio != null) index = Math.sqrt(ctrRatio * cpcRatio);
  else index = ctrRatio ?? cpcRatio;

  const verdict: Verdict =
    index == null
      ? "unknown"
      : index >= BETTER_AT
        ? "better"
        : index <= WORSE_AT
          ? "worse"
          : "average";
  return { ctrRatio, cpcRatio, index, verdict };
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export type GallerySort = "best" | "spend" | "newest";

/**
 * Meta ad IDs are allocated in increasing order, so a larger ID is a newer
 * ad. We store no creation date, and this is the only honest "newest" proxy.
 */
function compareIdsDesc(a: string, b: string): number {
  if (a.length !== b.length) return b.length - a.length;
  return a < b ? 1 : a > b ? -1 : 0;
}

export function sortCreatives(
  creatives: CreativeItem[],
  sort: GallerySort,
  b: Benchmarks
): CreativeItem[] {
  const list = [...creatives];
  if (sort === "spend") return list.sort((x, y) => y.spend - x.spend);
  if (sort === "newest") return list.sort((x, y) => compareIdsDesc(x.adId, y.adId));
  const idx = new Map(list.map((c) => [c.adId, scoreCreative(c, b).index]));
  // Ads we can judge first (best index on top); thin-data ads after, by spend.
  return list.sort((x, y) => {
    const ix = idx.get(x.adId) ?? null;
    const iy = idx.get(y.adId) ?? null;
    if (ix != null && iy != null) return iy - ix || y.spend - x.spend;
    if (ix != null) return -1;
    if (iy != null) return 1;
    return y.spend - x.spend;
  });
}

// ---------------------------------------------------------------------------
// Podium ("Najlepsze reklamy")
// ---------------------------------------------------------------------------

export type AwardKind = "ctr" | "cpc" | "hook" | "impressions" | "clicks";

/** "Best hook" needs rivals - one video beating nobody is not an award. */
const HOOK_AWARD_MIN_VIDEOS = 2;

export interface PodiumEntry {
  creative: CreativeItem;
  /** First award decides the headline; extra awards render as small badges. */
  awards: AwardKind[];
}

function maxBy<T>(items: T[], val: (t: T) => number): T | null {
  let best: T | null = null;
  let bestV = -Infinity;
  for (const it of items) {
    const v = val(it);
    if (Number.isFinite(v) && v > bestV) {
      bestV = v;
      best = it;
    }
  }
  return best;
}

/**
 * Up to three distinct ads, each winning at least one clearly-defined
 * category. When one ad wins several categories it gets one card with
 * several badges instead of us awarding a "cheapest" badge to the runner-up.
 */
export function pickPodium(creatives: CreativeItem[]): PodiumEntry[] {
  const eligible = creatives.filter(hasEnoughData);
  const videos = eligible.filter((c) => videoRatesOf(c)?.hook != null);
  // Ordered by how much each award tells the client; the podium keeps the
  // first three distinct ads, so volume awards come last.
  const winners: Array<[AwardKind, CreativeItem | null]> = [
    ["ctr", maxBy(eligible, (c) => ctrOf(c) ?? -Infinity)],
    [
      "cpc",
      maxBy(
        eligible.filter((c) => c.clicks >= MIN_CLICKS && cpcOf(c) != null),
        (c) => -(cpcOf(c) as number)
      ),
    ],
    [
      "hook",
      videos.length >= HOOK_AWARD_MIN_VIDEOS
        ? maxBy(videos, (c) => videoRatesOf(c)?.hook ?? -Infinity)
        : null,
    ],
    ["impressions", maxBy(eligible, (c) => c.impressions)],
    ["clicks", maxBy(eligible, (c) => c.clicks)],
  ];

  const entries: PodiumEntry[] = [];
  for (const [kind, c] of winners) {
    if (!c) continue;
    const existing = entries.find((e) => e.creative.adId === c.adId);
    if (existing) existing.awards.push(kind);
    else entries.push({ creative: c, awards: [kind] });
  }
  return entries.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Copy (plain language for non-technical readers)
// ---------------------------------------------------------------------------

export const AWARD_LABEL: Record<Lang, Record<AwardKind, string>> = {
  pl: {
    ctr: "Najczęściej klikana",
    cpc: "Najtańszy ruch",
    hook: "Najlepiej zatrzymuje uwagę",
    impressions: "Najwięcej wyświetleń",
    clicks: "Najwięcej kliknięć",
  },
  en: {
    ctr: "Most clicked",
    cpc: "Cheapest traffic",
    hook: "Best at stopping the scroll",
    impressions: "Most views",
    clicks: "Most clicks",
  },
};

function fmtDec(v: number, lang: Lang, digits = 1): string {
  return v.toLocaleString(lang === "en" ? "en-GB" : "pl-PL", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

/** Polish plural form picker (1 / 2-4 / 5+). */
export function plPlural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.round(n));
  if (abs === 1) return one;
  const d = abs % 10;
  const dd = abs % 100;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return few;
  return many;
}

/**
 * "2x more" reads better than "+104%" for big gaps; small gaps read better as
 * a percentage. Returns null when the gap is too small to be worth saying.
 */
function gapPhrase(
  ratio: number,
  lang: Lang,
  words: { more: string; less: string }
): string | null {
  if (ratio >= 1.95) return `${fmtDec(ratio, lang)}× ${words.more}`;
  const pct = Math.round(Math.abs(ratio - 1) * 100);
  if (pct < 5) return null;
  return lang === "en"
    ? `${pct}% ${ratio > 1 ? words.more : words.less}`
    : `o ${pct}% ${ratio > 1 ? words.more : words.less}`;
}

/** One plain sentence explaining why this ad won its (first) award. */
export function awardSentence(
  kind: AwardKind,
  c: CreativeItem,
  b: Benchmarks,
  lang: Lang
): string {
  const en = lang === "en";
  if (kind === "ctr") {
    const ctr = ctrOf(c) ?? 0;
    const ratio = b.ctr ? ctr / b.ctr : 1;
    const per100 = fmtDec(ctr, lang);
    const gap = gapPhrase(ratio, lang, en
      ? { more: "more than your average ad", less: "less than your average ad" }
      : { more: "więcej niż średnia Twoich reklam", less: "mniej niż średnia Twoich reklam" });
    // Polish verb agreement: "2 kończą się", but "2,6 / 5 kończy się".
    const rounded = Math.round(ctr * 10) / 10;
    const plural =
      Number.isInteger(rounded) && plPlural(rounded, "a", "b", "c") === "b";
    return en
      ? `Out of every 100 views, ${per100} end in a click${gap ? ` - ${gap}` : ""}.`
      : `Z każdych 100 wyświetleń ${per100} ${plural ? "kończą" : "kończy"} się kliknięciem${gap ? ` - ${gap}` : ""}.`;
  }
  if (kind === "cpc") {
    const cpc = cpcOf(c) ?? 0;
    const ratio = b.cpc && cpc > 0 ? b.cpc / cpc : 1;
    const price = formatMoneyPLN(Math.round(cpc));
    const gap =
      ratio >= 1.95
        ? en
          ? `${fmtDec(ratio, lang)}× cheaper than average`
          : `${fmtDec(ratio, lang)}× taniej niż średnio`
        : (() => {
            const pct = Math.round((1 - cpc / (b.cpc ?? cpc)) * 100);
            if (pct < 5) return null;
            return en ? `${pct}% below your average` : `o ${pct}% mniej niż średnio`;
          })();
    return en
      ? `One visit to your site costs ${price}${gap ? ` - ${gap}` : ""}.`
      : `Jedno wejście na stronę kosztuje tu ${price}${gap ? ` - ${gap}` : ""}.`;
  }
  if (kind === "hook") {
    const hook = videoRatesOf(c)?.hook ?? 0;
    const base = hookSentence(hook, lang);
    const ratio = b.hookRate ? hook / b.hookRate : 1;
    const gap = gapPhrase(ratio, lang, en
      ? { more: "more than your average video", less: "less than your average video" }
      : { more: "więcej niż średnia Twoich filmów", less: "mniej niż średnia Twoich filmów" });
    return gap ? `${base.slice(0, -1)} - ${gap}.` : base;
  }
  if (kind === "impressions") {
    const share = b.totalImpressions
      ? Math.round((c.impressions / b.totalImpressions) * 100)
      : 0;
    return en
      ? `Shown ${formatNumberPL(c.impressions)} times - ${share}% of all your ad views.`
      : `Wyświetlona ${formatNumberPL(c.impressions)} razy - to ${share}% wszystkich wyświetleń Twoich reklam.`;
  }
  const share = b.totalClicks ? Math.round((c.clicks / b.totalClicks) * 100) : 0;
  return en
    ? `Brought ${formatNumberPL(c.clicks)} clicks - ${share}% of all clicks from your ads.`
    : `Przyniosła ${formatNumberPL(c.clicks)} ${plPlural(c.clicks, "kliknięcie", "kliknięcia", "kliknięć")} - ${share}% wszystkich kliknięć z Twoich reklam.`;
}

export const VERDICT_LABEL: Record<Lang, Record<Verdict, string>> = {
  pl: {
    better: "Lepsza niż średnia",
    average: "W normie",
    worse: "Słabsza niż średnia",
    unknown: "Za mało danych",
  },
  en: {
    better: "Above average",
    average: "About average",
    worse: "Below average",
    unknown: "Not enough data",
  },
};

/**
 * Chip text. A flat "W normie" next to "klikana o 20% częściej" read as a
 * contradiction, so an average ad that still leans one way says which way.
 */
export function verdictLabel(s: CreativeScore, lang: Lang): string {
  if (s.verdict === "average" && s.index != null) {
    if (s.index >= 1.05) return lang === "en" ? "Slightly above average" : "Nieco lepsza niż średnia";
    if (s.index <= 0.95) return lang === "en" ? "Slightly below average" : "Nieco słabsza niż średnia";
  }
  return VERDICT_LABEL[lang][s.verdict];
}

/**
 * Short "why" behind a verdict: the stronger of the two signals, phrased the
 * way a client would say it out loud.
 */
export function verdictReason(s: CreativeScore, lang: Lang): string {
  const en = lang === "en";
  if (s.verdict === "unknown") {
    return en
      ? `Fewer than ${formatNumberPL(MIN_IMPRESSIONS)} views - too early to judge`
      : `Mniej niż ${formatNumberPL(MIN_IMPRESSIONS)} wyświetleń - za wcześnie na ocenę`;
  }
  const ctrDev = s.ctrRatio != null ? Math.abs(Math.log(s.ctrRatio)) : -1;
  const cpcDev = s.cpcRatio != null ? Math.abs(Math.log(s.cpcRatio)) : -1;
  if (ctrDev < 0 && cpcDev < 0) return "";

  // "About average" usually hides a trade-off (clicked more, but pricier);
  // saying that out loud is more useful than "close to average".
  if (s.verdict === "average") {
    if (s.ctrRatio != null && s.cpcRatio != null) {
      const ctrPct = Math.round((s.ctrRatio - 1) * 100);
      const pricePct = Math.round((1 / s.cpcRatio - 1) * 100);
      if (Math.abs(ctrPct) >= 5 && Math.abs(pricePct) >= 5 && Math.sign(ctrPct) === Math.sign(pricePct)) {
        return en
          ? `Clicked ${Math.abs(ctrPct)}% ${ctrPct > 0 ? "more" : "less"} often, but clicks are ${Math.abs(pricePct)}% ${pricePct > 0 ? "pricier" : "cheaper"}`
          : `Klikana o ${Math.abs(ctrPct)}% ${ctrPct > 0 ? "częściej" : "rzadziej"}, ale kliknięcie o ${Math.abs(pricePct)}% ${pricePct > 0 ? "droższe" : "tańsze"}`;
      }
    }
    if (Math.max(ctrDev, cpcDev) < Math.log(1.1)) {
      return en ? "Results close to your average" : "Wyniki zbliżone do Twojej średniej";
    }
  }

  if (ctrDev >= cpcDev && s.ctrRatio != null) {
    const gap = gapPhrase(s.ctrRatio, lang, en
      ? { more: "more often", less: "less often" }
      : { more: "częściej", less: "rzadziej" });
    if (!gap) return en ? "Clicked as often as average" : "Klikana tak często jak średnio";
    return en ? `Clicked ${gap} than average` : `Klikana ${gap} niż średnio`;
  }
  const r = s.cpcRatio as number;
  // Express CPC as price change (cheaper / pricier), not as a ratio of ratios.
  const priceRatio = 1 / r;
  if (r >= 1.95) {
    return en
      ? `Clicks ${fmtDec(r, lang)}× cheaper than average`
      : `Kliknięcie ${fmtDec(r, lang)}× tańsze niż średnio`;
  }
  const pct = Math.round(Math.abs(priceRatio - 1) * 100);
  if (pct < 5) return en ? "Click price about average" : "Cena kliknięcia jak średnio";
  return priceRatio < 1
    ? en
      ? `Clicks ${pct}% cheaper than average`
      : `Kliknięcie o ${pct}% tańsze niż średnio`
    : en
      ? `Clicks ${pct}% pricier than average`
      : `Kliknięcie o ${pct}% droższe niż średnio`;
}

// ---------------------------------------------------------------------------
// Format guess (placeholder visuals only)
// ---------------------------------------------------------------------------

export type CreativeFormat = "video" | "carousel" | "image";

/**
 * We do not store the creative type, but agencies name ads by format
 * ("Wideo | ...", "Karuzela | ..."). Only used to pick a placeholder icon
 * when the thumbnail is missing, so a wrong guess costs nothing.
 */
export function guessFormat(name: string): CreativeFormat {
  if (/(wideo|video|reels?|film|\bvid\b|mp4|ugc)/i.test(name)) return "video";
  if (/(karuzel|carousel|katalog|catalog|dpa)/i.test(name)) return "carousel";
  return "image";
}

export const FORMAT_LABEL: Record<Lang, Record<CreativeFormat, string>> = {
  pl: { video: "Wideo", carousel: "Karuzela", image: "Grafika" },
  en: { video: "Video", carousel: "Carousel", image: "Image" },
};
