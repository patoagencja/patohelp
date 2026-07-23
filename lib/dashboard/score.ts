import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

import { fetchAll } from "@/lib/supabase/fetch-all";
import { createClient } from "@/lib/supabase/server";

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
  const winCtr = avg(win.map((d) => (d.impressions > 0 ? d.clicks / d.impressions : 0)));
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

export async function getDailyScore(clientId: string): Promise<DailyScore | null> {
  const supabase = createClient();
  const today = formatInTimeZone(new Date(), WARSAW_TZ, "yyyy-MM-dd");
  const since = formatInTimeZone(
    subDays(new Date(), FETCH_DAYS),
    WARSAW_TZ,
    "yyyy-MM-dd"
  );

  const [adsRows, ga4Rows] = await Promise.all([
    fetchAll<{
      date: string;
      spend_minor_units: number | string;
      clicks: number | string;
      impressions: number | string;
    }>((from, to) =>
      supabase
        .from("ads_daily")
        .select("date, spend_minor_units, clicks, impressions")
        .eq("client_id", clientId)
        .gte("date", since)
        .lte("date", today)
        .order("date", { ascending: true })
        .order("campaign_id", { ascending: true })
        .range(from, to)
    ),
    fetchAll<{ date: string; sessions: number | string }>((from, to) =>
      supabase
        .from("ga4_daily")
        .select("date, sessions")
        .eq("client_id", clientId)
        .is("source_medium", null)
        .is("device_category", null)
        .is("page_path", null)
        .gte("date", since)
        .lte("date", today)
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
    m.spend += Number(r.spend_minor_units) || 0;
    m.clicks += Number(r.clicks) || 0;
    m.impressions += Number(r.impressions) || 0;
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
    ctr: avg(baseDays.map((d) => (d.impressions > 0 ? d.clicks / d.impressions : 0))),
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
  const winCtr = avg(win.map((d) => (d.impressions > 0 ? d.clicks / d.impressions : 0)));
  const factors: ScoreFactor[] = [
    { key: "ctr", label: "CTR", deltaPct: pct(winCtr, base.ctr) },
    { key: "clicks", label: "Kliknięcia", deltaPct: pct(avg(win.map((d) => d.clicks)), base.clicks) },
    { key: "sessions", label: "Sesje", deltaPct: pct(avg(win.map((d) => d.sessions)), base.sessions) },
    { key: "reach", label: "Zasięg", deltaPct: pct(avg(win.map((d) => d.impressions)), base.impressions) },
  ];

  // Headline: always lead with the strongest positive; only nudge gently if the
  // best signal is actually down.
  const ranked = [...factors]
    .filter((f) => f.deltaPct !== null)
    .sort((a, b) => (b.deltaPct ?? 0) - (a.deltaPct ?? 0));
  const best = ranked[0];
  let headline: string;
  if (best && best.deltaPct! >= 5) {
    headline = `${best.label} w tym tygodniu wyżej o ${best.deltaPct}% 🔥`;
  } else if (score >= 78) {
    headline = "Mocny tydzień - forma trzyma poziom.";
  } else if (best && best.deltaPct! <= -8) {
    headline = `${best.label} lekko niżej niż zwykle - jest co poprawiać.`;
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
