import { addDays, monthLabelPl, todayWarsaw } from "@/lib/ecom/insights";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";

// Monthly goals for engagement (non-shop) clients - the counterpart of the
// e-commerce revenue pacing. Everything is computed from what we already sync
// (ads_daily + ga4_daily totals): no external API calls on page load.
// Callers must have verified the user can see `clientId` (pages resolve the
// client through RLS first); reads here use the admin client.

export const GOAL_METRICS = ["sessions", "clicks", "impressions", "conversions"] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];

/** Pace window for the forecast: long enough to smooth weekdays out. */
const RECENT_DAYS = 7;
/** Below this many days with data in the window a forecast is a guess. */
const MIN_RECENT_DAYS = 5;

export interface EngagementGoal {
  metric: GoalMetric;
  target: number;
  monthStart: string;
  /** "październik" - for "Cele na październik". */
  monthName: string;
  daysInMonth: number;
  /** Finished days of the month (today's partial day excluded). */
  completeDays: number;
  /** Days left to work with, today included. */
  remainingDays: number;
  /** Month to date over complete days only. */
  actual: number;
  /** Today so far - shown, never used for pace (it's a partial day). */
  today: number;
  /** Average per day over the last 7 complete days with data. */
  recentDailyAvg: number | null;
  /** actual + recentDailyAvg × remainingDays; null when data is too thin. */
  forecast: number | null;
  progressPct: number;
  forecastPct: number | null;
  /** Per day still needed to hit the target; null once achieved. */
  requiredDaily: number | null;
  /** Day (yyyy-MM-dd) the running total crossed the target, if it has. */
  achievedOn: string | null;
  status: "ahead" | "on_track" | "behind" | "unknown";
}

// ---- small date helpers (plain yyyy-MM-dd strings, UTC maths) ----

const monthStartOf = (s: string) => `${s.slice(0, 7)}-01`;
const daysInMonthOf = (s: string) => {
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
export const shiftMonth = (monthStart: string, n: number) => {
  const y = Number(monthStart.slice(0, 4));
  const m = Number(monthStart.slice(5, 7)) - 1;
  return new Date(Date.UTC(y, m + n, 1)).toISOString().slice(0, 10);
};
const monthName = (monthStart: string) => monthLabelPl(monthStart).split(" ")[0];

// ---- reads ----

type DailySeries = Record<GoalMetric, Map<string, number>>;

function emptySeries(): DailySeries {
  return {
    sessions: new Map(),
    clicks: new Map(),
    impressions: new Map(),
    conversions: new Map(),
  };
}

/**
 * Daily totals per metric. A date is present in a metric's map only when the
 * source has rows for it, so "no row" (sync gap) stays distinguishable from a
 * real zero when we count days with data.
 */
async function getDailySeries(
  clientId: string,
  start: string,
  end: string,
  need: { ads: boolean; ga4: boolean }
): Promise<DailySeries> {
  const admin = createAdminClient();
  const out = emptySeries();

  const ads = need.ads
    ? fetchAll<Record<string, unknown>>((from, to) =>
        admin
          .from("ads_daily")
          .select("date, clicks, impressions, conversions")
          .eq("client_id", clientId)
          .gte("date", start)
          .lte("date", end)
          .order("date", { ascending: true })
          .order("provider", { ascending: true })
          .order("campaign_id", { ascending: true })
          .range(from, to)
      ).catch(() => [])
    : Promise.resolve([]);

  // Daily totals only: dimension rows (source/device/page) would double count.
  const ga4 = need.ga4
    ? fetchAll<Record<string, unknown>>((from, to) =>
        admin
          .from("ga4_daily")
          .select("date, sessions")
          .eq("client_id", clientId)
          .is("source_medium", null)
          .is("device_category", null)
          .is("page_path", null)
          .gte("date", start)
          .lte("date", end)
          .order("date", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
      ).catch(() => [])
    : Promise.resolve([]);

  const [adsRows, ga4Rows] = await Promise.all([ads, ga4]);
  const add = (m: Map<string, number>, d: string, v: unknown) =>
    m.set(d, (m.get(d) ?? 0) + Number(v ?? 0));
  for (const r of adsRows) {
    const d = String(r.date).slice(0, 10);
    add(out.clicks, d, r.clicks);
    add(out.impressions, d, r.impressions);
    add(out.conversions, d, r.conversions);
  }
  for (const r of ga4Rows) add(out.sessions, String(r.date).slice(0, 10), r.sessions);
  return out;
}

export interface GoalTargets {
  /** false until migration 0030 has been applied. */
  available: boolean;
  /** month start -> metric -> target */
  byMonth: Map<string, Map<GoalMetric, number>>;
  /** Latest save, ISO timestamp - shown in settings as confirmation. */
  updatedAt: string | null;
}

export async function getGoalTargets(
  clientId: string,
  months: string[]
): Promise<GoalTargets> {
  const { data, error } = await createAdminClient()
    .from("engagement_goals")
    .select("month, metric, target, updated_at")
    .eq("client_id", clientId)
    .in("month", months);
  if (error) return { available: false, byMonth: new Map(), updatedAt: null };
  const byMonth = new Map<string, Map<GoalMetric, number>>();
  let updatedAt: string | null = null;
  for (const r of data ?? []) {
    const month = String(r.month).slice(0, 10);
    const metric = r.metric as GoalMetric;
    if (!GOAL_METRICS.includes(metric)) continue;
    const m = byMonth.get(month) ?? new Map<GoalMetric, number>();
    m.set(metric, Number(r.target));
    byMonth.set(month, m);
    const u = r.updated_at as string | null;
    if (u && (!updatedAt || u > updatedAt)) updatedAt = u;
  }
  return { available: true, byMonth, updatedAt };
}

/**
 * Totals of a finished month per metric, as a sanity anchor next to the goal
 * inputs ("wrzesień: 36 900"). null where the source had no rows at all.
 */
export async function getMonthTotals(
  clientId: string,
  monthStart: string
): Promise<Record<GoalMetric, number | null>> {
  const end = addDays(shiftMonth(monthStart, 1), -1);
  const s = await getDailySeries(clientId, monthStart, end, { ads: true, ga4: true });
  const total = (m: Map<string, number>) =>
    m.size === 0 ? null : Array.from(m.values()).reduce((a, b) => a + b, 0);
  return {
    sessions: total(s.sessions),
    clicks: total(s.clicks),
    impressions: total(s.impressions),
    conversions: total(s.conversions),
  };
}

// ---- pacing maths (pure, shared with the demo) ----

export function computeGoal(
  metric: GoalMetric,
  target: number,
  daily: Map<string, number>,
  today: string
): EngagementGoal {
  const monthStart = monthStartOf(today);
  const dim = daysInMonthOf(today);
  const yesterday = addDays(today, -1);
  const completeDays = Number(today.slice(8, 10)) - 1;
  const remainingDays = dim - completeDays;

  // Month to date over complete days; also note the day the running total
  // first reached the target, for the celebration line.
  let actual = 0;
  let achievedOn: string | null = null;
  for (let i = 0; i < completeDays; i++) {
    const d = addDays(monthStart, i);
    actual += daily.get(d) ?? 0;
    if (!achievedOn && actual >= target) achievedOn = d;
  }

  // Pace from the last 7 complete days, even when they reach into last month:
  // on the 3rd, two October days say much less than a full recent week.
  let recentTotal = 0;
  let recentDays = 0;
  for (let i = 0; i < RECENT_DAYS; i++) {
    const v = daily.get(addDays(yesterday, -i));
    if (v !== undefined) {
      recentTotal += v;
      recentDays += 1;
    }
  }
  const reliable = recentDays >= MIN_RECENT_DAYS;
  const recentDailyAvg = recentDays > 0 ? recentTotal / recentDays : null;
  const forecast =
    reliable && recentDailyAvg !== null ? actual + recentDailyAvg * remainingDays : null;
  const forecastPct = forecast !== null ? forecast / target : null;

  const status: EngagementGoal["status"] =
    achievedOn !== null
      ? "ahead"
      : forecastPct === null
        ? "unknown"
        : forecastPct >= 1.05
          ? "ahead"
          : forecastPct >= 0.95
            ? "on_track"
            : "behind";

  return {
    metric,
    target,
    monthStart,
    monthName: monthName(monthStart),
    daysInMonth: dim,
    completeDays,
    remainingDays,
    actual,
    today: daily.get(today) ?? 0,
    recentDailyAvg,
    forecast,
    progressPct: actual / target,
    forecastPct,
    requiredDaily:
      achievedOn === null && remainingDays > 0
        ? Math.max(0, target - actual) / remainingDays
        : null,
    achievedOn,
    status,
  };
}

/**
 * This month's goals with month-to-date progress and an end-of-month
 * forecast. Ordered sessions -> clicks -> impressions -> conversions.
 * Returns [] when no goals are set or migration 0030 is missing.
 */
export async function getEngagementGoals(
  clientId: string,
  today = todayWarsaw()
): Promise<EngagementGoal[]> {
  const monthStart = monthStartOf(today);
  const targets = await getGoalTargets(clientId, [monthStart]);
  const goals = targets.byMonth.get(monthStart);
  if (!goals || goals.size === 0) return [];

  const metrics = GOAL_METRICS.filter((m) => goals.has(m));
  const readStart = [monthStart, addDays(today, -(RECENT_DAYS + 1))].sort()[0];
  const series = await getDailySeries(clientId, readStart, today, {
    ga4: metrics.includes("sessions"),
    ads: metrics.some((m) => m !== "sessions"),
  });
  return metrics.map((m) => computeGoal(m, goals.get(m)!, series[m], today));
}

// ---- demo ----

/**
 * Plausible goals for the public demo, run through the same maths: one goal
 * ahead, one behind, one already achieved (when the month is old enough).
 */
export function demoEngagementGoals(today = todayWarsaw()): EngagementGoal[] {
  const monthStart = monthStartOf(today);
  const dim = daysInMonthOf(today);
  const completeDays = Number(today.slice(8, 10)) - 1;
  // Deterministic wiggle so the demo looks alive but never changes on reload.
  const series = (base: number, seed: number) => {
    const m = new Map<string, number>();
    for (let i = -(RECENT_DAYS + 1); i <= completeDays; i++) {
      const d = addDays(monthStart, i);
      const wiggle = 1 + 0.12 * Math.sin((i + seed) * 1.7) + 0.06 * Math.cos(i * 0.9);
      m.set(d, Math.round(base * wiggle * (i === completeDays ? 0.4 : 1)));
    }
    return m;
  };
  // Daily bases in scale with the demo trend (lib/demo/data.ts: ~1 220
  // visits and ~1 540 clicks a day) so the goal bars and the hero agree.
  const sessions = series(1420, 1);
  const clicks = series(1650, 2);
  const conversions = series(41, 3);
  const round = (n: number, step: number) => Math.max(step, Math.round(n / step) * step);

  const goals = [
    computeGoal("sessions", round(1420 * dim * 0.96, 500), sessions, today),
    computeGoal("clicks", round(1650 * dim * 1.1, 500), clicks, today),
  ];
  const convSoFar = Array.from({ length: completeDays }, (_, i) =>
    conversions.get(addDays(monthStart, i)) ?? 0
  ).reduce((a, b) => a + b, 0);
  goals.push(
    computeGoal(
      "conversions",
      completeDays >= 3 ? round(convSoFar * 0.85, 10) : round(41 * dim, 50),
      conversions,
      today
    )
  );
  return goals;
}
