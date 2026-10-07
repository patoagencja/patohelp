// Contract between the Meta ad-level data layer (lib/ab/load.ts, the
// refresh-ads-meta-ads cron) and the creative test UI ("Testy kreacji").
// Advertisers who A/B test heavily (dozens of ads per ad set, tens of
// thousands of złoty a day in season) need to know within hours which ad
// wins, which sells too expensively and which is wearing out - so everything
// here is per ad per day, with purchases and their value, not a 30-day
// snapshot.
//
// Money is minor units (grosze). Rates are plain ratios (0.0123 = 1.23%).

/**
 * Periods offered in the UI. Every period but "today" is made of FINISHED
 * days (it ends yesterday): today is still filling up and Meta keeps adding
 * purchases to the last day or two for a while. "today" is a preview only.
 * "season" needs a season config.
 */
export type AbWindowKey = "today" | "3d" | "7d" | "14d" | "30d" | "season";

export const AB_WINDOW_LABEL: Record<AbWindowKey, string> = {
  today: "Dziś",
  "3d": "3 dni",
  "7d": "7 dni",
  "14d": "14 dni",
  "30d": "30 dni",
  season: "Cały sezon",
};

export interface AbDay {
  date: string;
  spend: number;
  impressions: number;
  /** Link clicks. */
  clicks: number;
  purchases: number;
  value: number;
}

export interface AbAdTotals {
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  value: number;
  /** Reach-weighted average frequency over the window, null if unknown. */
  frequency: number | null;
  /** 3-second video plays (null for images / not reported). */
  video3s: number | null;
}

/** Derived rates for one ad (null when the denominator is 0). */
export interface AbRates {
  ctr: number | null; // clicks / impressions
  cvr: number | null; // purchases / clicks
  cpa: number | null; // spend / purchases (grosze)
  roas: number | null; // value / spend
  cpm: number | null; // spend / impressions * 1000 (grosze)
  hookRate: number | null; // video3s / impressions
}

export type AbVerdictKind =
  /** Clearly sells better than the rest of its ad set: give it more budget. */
  | "winner"
  /** Clearly sells worse, more expensively, and still spends: switch it off. */
  | "loser"
  /** Its return fell much faster than the rest of its set's, frequency up. */
  | "fatigue"
  /** Not enough purchases, clicks or finished days yet to call it. */
  | "too_early"
  /** In line with its ad set. */
  | "steady"
  /** "Dziś": today's numbers only, never judged. */
  | "preview";

export interface AbVerdict {
  kind: AbVerdictKind;
  /**
   * Probability (0..1) that this ad's purchase rate per click beats the rest
   * of its ad set (winner/steady) or is below it (loser). null for
   * too_early and preview.
   */
  probability: number | null;
  /** One plain Polish sentence for the UI, e.g. "97% szans, że sprzedaje lepiej niż reszta zestawu". */
  text: string;
  /** For too_early: roughly how many more purchases before a call (null when purchases are not what's missing). */
  purchasesNeeded?: number | null;
}

export interface AbAd {
  adId: string;
  adName: string;
  adsetId: string;
  adsetName: string;
  campaignId: string;
  campaignName: string;
  /** Market code read from campaign / ad set name (lib/season/markets.ts). */
  market: string | null;
  thumbnailUrl: string | null;
  /** Meta effective_status, e.g. "ACTIVE", "PAUSED"; null when unknown. */
  status: string | null;
  /** When the ad was created (ISO), null when unknown. */
  createdTime: string | null;
  /** First / last day with spend inside the loaded history. */
  firstDate: string | null;
  lastDate: string | null;
  /** Days of the period with spend. */
  deliveryDays: number;
  totals: AbAdTotals;
  rates: AbRates;
  /** Share of the ad set's spend in the window (0..1). */
  spendShare: number;
  /** Probability this ad is the best in its ad set by purchases per click. */
  probBest: number | null;
  verdict: AbVerdict;
  // No per-day series here on purpose: on a busy account it was ~86% of the
  // payload and pushed the cached view over 2 MB. The compare chart asks for
  // its few ads on demand (AbSeriesLoader).
}

/** One ad set = one test: its ads compete for the same audience and budget. */
export interface AbTest {
  adsetId: string;
  adsetName: string;
  campaignId: string;
  campaignName: string;
  market: string | null;
  totals: AbAdTotals;
  rates: AbRates;
  /** Ads sorted by spend desc. Ad sets with a single ad are still listed. */
  ads: AbAd[];
  /** The ad with the highest probBest, when one is clearly ahead (>= 0.9). */
  leaderAdId: string | null;
}

export type AbActionKind = "scale" | "cut" | "refresh" | "watch";

/** "Do decyzji dziś": the short list the owner acts on. */
export interface AbAction {
  kind: AbActionKind;
  adId: string;
  adsetId: string;
  /** Headline, e.g. "Wyłącz „Elf 15s”: zakup 2,1× droższy niż w reszcie zestawu". */
  title: string;
  /** Why, in one sentence with the numbers. */
  detail: string;
  /**
   * Rough sales value per day at stake (grosze) for cut / scale / refresh -
   * the same unit, so they sort together: extra sales if the budget went to
   * the rest of the set (cut), extra sales from moving budget onto the ad
   * (scale), sales lost to wear-out (refresh). For watch: the ad's spend per
   * day (listed after every decision).
   */
  impactPerDay: number;
}

export interface AbView {
  windowKey: AbWindowKey;
  start: string;
  end: string;
  /** Warsaw today the view was computed for. */
  today: string;
  /** true = the "Dziś" preview: today's numbers, no verdicts or actions. */
  monitor: boolean;
  /** Newest synced timestamp of ad-level data (ISO), null when none. */
  updatedAt: string | null;
  /** false = migration missing or no ad-level data synced yet. */
  available: boolean;
  totals: AbAdTotals;
  rates: AbRates;
  /** Every ad together, day by day over the window (tile sparklines). */
  days: AbDay[];
  tests: AbTest[];
  actions: AbAction[];
  /** Ads with spend in the window (flat list for the compare picker). */
  adCount: number;
}

/** The compare chart's on-demand request: up to 4 ads over the view's days. */
export interface AbSeriesRequest {
  adIds: string[];
  start: string;
  end: string;
}

/** One ad's days over the request (oldest -> newest, zero-filled). */
export interface AbSeries {
  adId: string;
  days: AbDay[];
}

/** A server action reading series: production by slug, the demo by its pinned day. */
export type AbSeriesLoader = (req: AbSeriesRequest) => Promise<AbSeries[]>;
