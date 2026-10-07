// Contract between the Meta ad-level data layer (lib/ab/load.ts, the
// refresh-ads-meta-ads cron) and the creative test UI ("Testy kreacji").
// Advertisers who A/B test heavily (dozens of ads per ad set, tens of
// thousands of złoty a day in season) need to know within hours which ad
// wins, which burns money and which is wearing out - so everything here is
// per ad per day, with purchases and their value, not a 30-day snapshot.
//
// Money is minor units (grosze). Rates are plain ratios (0.0123 = 1.23%).

/** Comparison windows offered in the UI. "season" needs a season config. */
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
  /** Significantly better than the rest of its ad set: scale it. */
  | "winner"
  /** Significantly worse and spending: switch it off / cut budget. */
  | "loser"
  /** Was good, its own recent days fell off (with rising frequency). */
  | "fatigue"
  /** Not enough purchases yet to call it. */
  | "too_early"
  /** In line with its ad set. */
  | "steady";

export interface AbVerdict {
  kind: AbVerdictKind;
  /**
   * Probability (0..1) that this ad's purchase rate per click beats the rest
   * of its ad set (winner/steady) or is below it (loser). null for too_early.
   */
  probability: number | null;
  /** One plain Polish sentence for the UI, e.g. "93% szans, że sprzedaje lepiej niż reszta zestawu". */
  text: string;
  /** For too_early: roughly how many more purchases before a call. */
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
  totals: AbAdTotals;
  rates: AbRates;
  /** Share of the ad set's spend in the window (0..1). */
  spendShare: number;
  /** Probability this ad is the best in its ad set by purchases per click. */
  probBest: number | null;
  verdict: AbVerdict;
  /** Daily series over the window (oldest -> newest), zero-filled. */
  daily: AbDay[];
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
  /** Headline, e.g. "Wyłącz: «Elf Fajtłapa 15s» przepala 1 240 zł dziennie". */
  title: string;
  /** Why, in one sentence with the numbers. */
  detail: string;
  /**
   * Rough money at stake per day (grosze): spend that would be saved (cut)
   * or extra value expected (scale). Used to sort the list.
   */
  impactPerDay: number;
}

export interface AbView {
  windowKey: AbWindowKey;
  start: string;
  end: string;
  /** Newest synced timestamp of ad-level data (ISO), null when none. */
  updatedAt: string | null;
  /** false = migration missing or no ad-level data synced yet. */
  available: boolean;
  totals: AbAdTotals;
  rates: AbRates;
  tests: AbTest[];
  actions: AbAction[];
  /** Ads with spend in the window (flat list for the compare picker). */
  adCount: number;
}
