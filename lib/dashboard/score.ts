import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

import { fetchAll } from "@/lib/supabase/fetch-all";
import { createClient } from "@/lib/supabase/server";

// "Puls" - a Whoop-style daily score (0-100) for a client, measured against the
// client's OWN recent norm rather than an absolute target. The point is a single
// number that changes every day and a streak you don't want to break, so people
// come back to check it. Computed purely from data we already store.

const WARSAW_TZ = "Europe/Warsaw";
const GOOD = 60; // score at/above which a day counts as a "good" day (streak)
const BASELINE_DAYS = 21; // trailing window that defines "normal" for this client

export type ScoreTier = "low" | "mid" | "high";

export interface ScoreFactor {
  key: "ctr" | "clicks" | "sessions" | "stability";
  label: string;
  deltaPct: number | null; // vs baseline, e.g. +12 means 12% above normal
}

export interface DailyScore {
  score: number; // 0-100 for the latest day with data
  prevScore: number | null; // the day before, for the delta
  delta: number | null;
  tier: ScoreTier;
  streak: number; // consecutive most-recent good days
  date: string; // the day the score refers to
  headline: string; // one Polish sentence: what stands out today
  factors: ScoreFactor[];
}

interface DayMetrics {
  date: string;
  spend: number;
  clicks: number;
  impressions: number;
  sessions: number;
}

/** Map a today/baseline ratio to a 0-100 sub-score. 1.0 (normal) -> 65. */
function ratioScore(ratio: number): number {
  if (!isFinite(ratio) || ratio <= 0) return 50;
  return Math.max(5, Math.min(100, 65 + (ratio - 1) * 130));
}

/** Stability: reward spend staying near normal, penalise spikes either way. */
function stabilityScore(ratio: number): number {
  if (!isFinite(ratio) || ratio <= 0) return 50;
  return Math.max(5, Math.min(100, 100 - Math.abs(ratio - 1) * 120));
}

function tierOf(score: number): ScoreTier {
  return score >= 70 ? "high" : score >= 45 ? "mid" : "low";
}

function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Compute the composite score for the day at `idx` using the trailing window. */
function scoreForDay(days: DayMetrics[], idx: number): number | null {
  if (idx <= 0) return null;
  const day = days[idx];
  const base = days.slice(Math.max(0, idx - BASELINE_DAYS), idx);
  if (base.length < 5) return null; // not enough history to judge "normal"

  const dayCtr = day.impressions > 0 ? day.clicks / day.impressions : 0;
  const baseCtr = avg(
    base.map((d) => (d.impressions > 0 ? d.clicks / d.impressions : 0))
  );
  const baseClicks = avg(base.map((d) => d.clicks));
  const baseSessions = avg(base.map((d) => d.sessions));
  const baseSpend = avg(base.map((d) => d.spend));

  const ctrS = ratioScore(baseCtr > 0 ? dayCtr / baseCtr : 1);
  const clicksS = ratioScore(baseClicks > 0 ? day.clicks / baseClicks : 1);
  const sessionsS = ratioScore(
    baseSessions > 0 ? day.sessions / baseSessions : 1
  );
  const stabS = stabilityScore(baseSpend > 0 ? day.spend / baseSpend : 1);

  const score =
    ctrS * 0.35 + clicksS * 0.3 + sessionsS * 0.25 + stabS * 0.1;
  return Math.round(score);
}

function pct(today: number, base: number): number | null {
  if (base <= 0) return null;
  return Math.round(((today - base) / base) * 100);
}

export async function getDailyScore(clientId: string): Promise<DailyScore | null> {
  const supabase = createClient();
  const today = formatInTimeZone(new Date(), WARSAW_TZ, "yyyy-MM-dd");
  const since = formatInTimeZone(
    subDays(new Date(), BASELINE_DAYS + 14),
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

  // Aggregate per day (sum across campaigns / providers).
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
  for (const r of ga4Rows) {
    get(r.date).sessions += Number(r.sessions) || 0;
  }

  const days = [...byDate.values()].sort((a, b) =>
    a.date < b.date ? -1 : 1
  );
  if (days.length < 6) return null;

  // Latest day that actually has activity (avoid scoring an empty "today").
  let latestIdx = days.length - 1;
  while (latestIdx > 0 && days[latestIdx].impressions === 0 && days[latestIdx].sessions === 0) {
    latestIdx -= 1;
  }

  const score = scoreForDay(days, latestIdx);
  if (score === null) return null;
  const prevScore = scoreForDay(days, latestIdx - 1);

  // Streak: consecutive good days ending at the latest scored day.
  let streak = 0;
  for (let i = latestIdx; i > 0; i--) {
    const s = scoreForDay(days, i);
    if (s !== null && s >= GOOD) streak += 1;
    else break;
  }

  // Factor deltas vs baseline, for the headline and chips.
  const day = days[latestIdx];
  const base = days.slice(Math.max(0, latestIdx - BASELINE_DAYS), latestIdx);
  const dayCtr = day.impressions > 0 ? day.clicks / day.impressions : 0;
  const baseCtr = avg(
    base.map((d) => (d.impressions > 0 ? d.clicks / d.impressions : 0))
  );
  const factors: ScoreFactor[] = [
    { key: "ctr", label: "CTR", deltaPct: pct(dayCtr, baseCtr) },
    { key: "clicks", label: "Kliknięcia", deltaPct: pct(day.clicks, avg(base.map((d) => d.clicks))) },
    { key: "sessions", label: "Sesje", deltaPct: pct(day.sessions, avg(base.map((d) => d.sessions))) },
  ];

  // Headline: the factor that stands out most (positively or negatively).
  const ranked = [...factors]
    .filter((f) => f.deltaPct !== null)
    .sort((a, b) => Math.abs(b.deltaPct!) - Math.abs(a.deltaPct!));
  const top = ranked[0];
  let headline: string;
  if (!top || Math.abs(top.deltaPct!) < 5) {
    headline = "Stabilny dzień - wyniki blisko Twojej normy.";
  } else if (top.deltaPct! > 0) {
    headline = `${top.label} wyższe niż zwykle o ${top.deltaPct}% 🔥`;
  } else {
    headline = `${top.label} niższe niż zwykle o ${Math.abs(top.deltaPct!)}% - warto zerknąć.`;
  }

  return {
    score,
    prevScore,
    delta: prevScore !== null ? score - prevScore : null,
    tier: tierOf(score),
    streak,
    date: day.date,
    headline,
    factors,
  };
}
