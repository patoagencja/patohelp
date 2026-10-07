import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAdsDayTotals } from "@/lib/dashboard/ads-totals";
import { syncCached } from "@/lib/dashboard/sync-cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";

// "Puls" - a Whoop-style form score (0-100) for a client, measured against the
// client's OWN long-run norm. Deliberately SMOOTHED (7-day window) and floored
// so it reads as a calm "forma" that trends with real momentum instead of a
// noisy day-to-day number that swings ugly for no reason. The point is a single
// positive-leaning figure people check daily, plus a streak they don't break.

const WARSAW_TZ = "Europe/Warsaw";
const WINDOW = 7; // rolling window that defines "recent form"
const FETCH_DAYS = 56; // enough history for a stable baseline + prev-week delta
const FLOOR = 58; // the score never drops below this - it always looks decent
const CAP = 99; // leave a little headroom so 100 stays aspirational

export type ScoreTier = "low" | "mid" | "high";

export interface ScoreFactor {
  key: "ctr" | "clicks" | "sessions" | "reach";
  label: string;
  deltaPct: number | null; // recent window vs baseline
}

export interface ScoreRing {
  key: "form" | "engagement" | "traffic";
  label: string;
  value: number; // 0-100
  tier: ScoreTier;
}

export interface DailyScore {
  score: number;
  prevScore: number | null; // previous 7-day window, for the delta
  delta: number | null;
  tier: ScoreTier;
  streak: number; // consecutive recent days with healthy activity
  date: string;
  headline: string;
  factors: ScoreFactor[];
  rings: ScoreRing[]; // 3 dials for the card (Whoop/Apple style)
}

interface DayMetrics {
  date: string;
  spend: number;
  clicks: number;
  impressions: number;
  sessions: number;
}

const avg = (n: number[]) => (n.length ? n.reduce((a, b) => a + b, 0) / n.length : 0);

/**
 * CTR of a set of days as a ratio of sums. The mean of daily CTRs counted
 * every day without impressions (GA4-only days, paused weekends) as a 0% CTR
 * and let a 30-impression day weigh as much as a 30 000 one, so "CTR o X%
 * powyżej normy" moved with the calendar rather than the ads.
 */
const ctrOfDays = (days: DayMetrics[]) => {
  let clicks = 0;
  let impressions = 0;
  for (const d of days) {
    clicks += d.clicks;
    impressions += d.impressions;
  }
  return impressions > 0 ? clicks / impressions : 0;
};

/**
 * Map a recent/baseline ratio to a 0-100 sub-score with a GENEROUS curve:
 * "normal" (ratio 1) lands at 78, improvement climbs fast, and a downturn is
 * cushioned (never below 45). This is what keeps the Puls looking healthy.
 */
function ratioScore(ratio: number): number {
  if (!isFinite(ratio) || ratio <= 0) return 72;
  return Math.max(45, Math.min(100, 78 + (ratio - 1) * 85));
}

function tierOf(score: number): ScoreTier {
  return score >= 78 ? "high" : score >= 66 ? "mid" : "low";
}

/** Composite score for a 7-day window (indices [end-6, end]) vs a baseline. */
function windowScore(
  days: DayMetrics[],
  end: number,
  base: {
    ctr: number;
    clicks: number;
    sessions: number;
    impressions: number;
  }
): number | null {
  if (end < 0) return null;
  const win = days.slice(Math.max(0, end - WINDOW + 1), end + 1);
  if (!win.length) return null;

  const winImpr = avg(win.map((d) => d.impressions));
  const winClicks = avg(win.map((d) => d.clicks));
  const winSessions = avg(win.map((d) => d.sessions));
  const winCtr = ctrOfDays(win);
  const activeDays = win.filter((d) => d.impressions > 0 || d.sessions > 0).length;

  const ctrS = ratioScore(base.ctr > 0 ? winCtr / base.ctr : 1);
  const clicksS = ratioScore(base.clicks > 0 ? winClicks / base.clicks : 1);
  const sessionsS = ratioScore(base.sessions > 0 ? winSessions / base.sessions : 1);
  const reachS = ratioScore(base.impressions > 0 ? winImpr / base.impressions : 1);
  const consistency = 55 + (activeDays / WINDOW) * 45; // steady activity keeps it up

  const raw =
    ctrS * 0.3 +
    clicksS * 0.24 +
    sessionsS * 0.2 +
    reachS * 0.14 +
    consistency * 0.12;
  return Math.round(Math.max(FLOOR, Math.min(CAP, raw)));
}

function pct(recent: number, base: number): number | null {
  if (base <= 0) return null;
  return Math.round(((recent - base) / base) * 100);
}

/**
 * The overview's "Puls". Eight weeks of daily totals that only move when a
 * sync lands: shared across requests per sync stamp (lib/dashboard/
 * sync-cache.ts). Service-role read - `clientId` MUST come from
 * getClientBySlug (resolved through RLS).
 */
export function getDailyScore(clientId: string): Promise<DailyScore | null> {
  return syncCached("score", clientId, [], () =>
    computeDailyScore(clientId, createAdminClient())
  );
}

async function computeDailyScore(
  clientId: string,
  supabase: SupabaseClient
): Promise<DailyScore | null> {
  const today = formatInTimeZone(new Date(), WARSAW_TZ, "yyyy-MM-dd");
  // Complete days only: today's half-synced day counted as a full day in the
  // 7-day averages, so every morning the "Puls" and its factor deltas sagged
  // (and disagreed with the goals card, which also stops at yesterday).
  // Date-string maths, so a 23/25-hour DST day can't land back on today.
  const lastFullDay = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
  const since = formatInTimeZone(
    subDays(new Date(), FETCH_DAYS),
    WARSAW_TZ,
    "yyyy-MM-dd"
  );

  // Per-day account totals (ads_daily_totals view, raw-row fallback): one
  // row per day and platform instead of one per campaign.
  const [adsRows, ga4Rows] = await Promise.all([
    getAdsDayTotals(supabase, clientId, since, lastFullDay),
    fetchAll<{ date: string; sessions: number | string }>((from, to) =>
      supabase
        .from("ga4_daily")
        .select("date, sessions")
        .eq("client_id", clientId)
        .is("source_medium", null)
        .is("device_category", null)
        .is("page_path", null)
        .gte("date", since)
        .lte("date", lastFullDay)
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    ),
  ]);

  const byDate = new Map<string, DayMetrics>();
  const get = (d: string): DayMetrics => {
    let m = byDate.get(d);
    if (!m) {
      m = { date: d, spend: 0, clicks: 0, impressions: 0, sessions: 0 };
      byDate.set(d, m);
    }
    return m;
  };
  for (const r of adsRows) {
    const m = get(r.date);
    m.spend += r.spend;
    m.clicks += r.clicks;
    m.impressions += r.impressions;
  }
  for (const r of ga4Rows) get(r.date).sessions += Number(r.sessions) || 0;

  const days = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (days.length < WINDOW + 3) return null;

  // Latest day with activity (avoid scoring an empty "today").
  let latestIdx = days.length - 1;
  while (
    latestIdx > 0 &&
    days[latestIdx].impressions === 0 &&
    days[latestIdx].sessions === 0
  ) {
    latestIdx -= 1;
  }

  // Baseline = the client's own average over everything BEFORE the recent
  // window, so recent improvement reads as a ratio above 1.
  const baseDays = days.slice(0, Math.max(1, latestIdx - WINDOW + 1));
  const base = {
    ctr: ctrOfDays(baseDays),
    clicks: avg(baseDays.map((d) => d.clicks)),
    sessions: avg(baseDays.map((d) => d.sessions)),
    impressions: avg(baseDays.map((d) => d.impressions)),
  };

  const score = windowScore(days, latestIdx, base);
  if (score === null) return null;
  const prevScore = windowScore(days, latestIdx - WINDOW, base);

  // Streak: consecutive recent days that weren't "dead" (activity >= 40% of
  // the client's normal clicks). Forgiving on purpose - it should feel earned,
  // not punishing.
  const clicksBar = base.clicks * 0.4;
  let streak = 0;
  for (let i = latestIdx; i >= 0; i--) {
    const d = days[i];
    const alive = d.impressions > 0 && (base.clicks <= 0 || d.clicks >= clicksBar);
    if (alive) streak += 1;
    else break;
  }

  // Factor deltas: recent 7-day window vs baseline.
  const win = days.slice(Math.max(0, latestIdx - WINDOW + 1), latestIdx + 1);
  const winCtr = ctrOfDays(win);
  const winSessions = avg(win.map((d) => d.sessions));
  const factors: ScoreFactor[] = [
    { key: "ctr", label: "CTR", deltaPct: pct(winCtr, base.ctr) },
    { key: "clicks", label: "Kliknięcia", deltaPct: pct(avg(win.map((d) => d.clicks)), base.clicks) },
    {
      key: "sessions",
      label: "Wizyty na stronie",
      // A week with zero sessions is GA4 not syncing, not "-100%" traffic.
      deltaPct: winSessions > 0 ? pct(winSessions, base.sessions) : null,
    },
    { key: "reach", label: "Wyświetlenia", deltaPct: pct(avg(win.map((d) => d.impressions)), base.impressions) },
  ];

  // Headline: always lead with the strongest positive; only nudge gently if the
  // best signal is actually down.
  const ranked = [...factors]
    .filter((f) => f.deltaPct !== null)
    .sort((a, b) => (b.deltaPct ?? 0) - (a.deltaPct ?? 0));
  const best = ranked[0];
  let headline: string;
  if (best && best.deltaPct! >= 5) {
    headline = `${best.label}: w tym tygodniu o ${best.deltaPct}% powyżej normy 🔥`;
  } else if (score >= 78) {
    headline = "Mocny tydzień - forma trzyma poziom.";
  } else if (best && best.deltaPct! <= -8) {
    headline = `${best.label}: lekko poniżej normy - sprawdzamy, co poprawić.`;
  } else {
    headline = "Stabilna forma - blisko Twojej normy.";
  }

  // Three dials for the card. Same generous curve + floor, so each one always
  // reads as a healthy ring rather than an empty sliver.
  const clamp = (n: number) => Math.round(Math.max(FLOOR, Math.min(CAP, n)));
  const engagement = clamp(ratioScore(base.ctr > 0 ? winCtr / base.ctr : 1));
  const traffic = clamp(
    (ratioScore(base.clicks > 0 ? avg(win.map((d) => d.clicks)) / base.clicks : 1) +
      ratioScore(
        base.sessions > 0 ? avg(win.map((d) => d.sessions)) / base.sessions : 1
      )) /
      2
  );
  const rings: ScoreRing[] = [
    { key: "form", label: "Forma", value: score, tier: tierOf(score) },
    {
      key: "engagement",
      label: "Zaangażowanie",
      value: engagement,
      tier: tierOf(engagement),
    },
    { key: "traffic", label: "Ruch", value: traffic, tier: tierOf(traffic) },
  ];

  return {
    score,
    prevScore,
    delta: prevScore !== null ? score - prevScore : null,
    tier: tierOf(score),
    streak,
    date: days[latestIdx].date,
    headline,
    factors,
    rings,
  };
}
