import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchAll } from "@/lib/supabase/fetch-all";
import { createClient } from "@/lib/supabase/server";
import type { Anomaly } from "@/lib/alerts/anomalies";
import { formatMoneyPLN } from "@/lib/utils";

const WARSAW_TZ = "Europe/Warsaw";
const fmtDate = (d: Date) => formatInTimeZone(d, WARSAW_TZ, "yyyy-MM-dd");

// Baseline for single-day checks = the 14 complete days before yesterday.
const DAY_BASELINE = 14;
// Rolling week vs the prior two weeks (for sustained-overspend detection).
const WEEK_DAYS = 7;
const PRIOR_WEEKS_DAYS = 14;

// Defaults (grosze). Tunable per client via notification_settings.
const DEFAULT_MULTIPLIER = 3; // day >= 3x the normal daily average
const Z_THRESHOLD = 2.5; // day is a statistical outlier (mean + 2.5 sigma)
const MIN_ABS_CAMPAIGN = 30_000; // 300 zl - single-day noise floor
const MIN_ABS_ACCOUNT = 100_000; // 1 000 zl
// Dormant/new campaign suddenly spending big (baseline ~0, no multiplier possible).
const NEW_SPEND_FLOOR_CAMPAIGN = 200_000; // 2 000 zl
const NEW_SPEND_FLOOR_ACCOUNT = 500_000; // 5 000 zl
// Sustained weekly overspend.
const WEEK_RATIO = 1.6; // this week's daily avg >= 1.6x the prior average
const WEEK_ABS_CAMPAIGN = 200_000; // 2 000 zl over the week to bother flagging
const WEEK_ABS_ACCOUNT = 1_000_000; // 10 000 zl

export interface BudgetConfig {
  /** Per-campaign hard daily cap (grosze). Any campaign over this = critical. */
  campaignCap: number | null;
  /** Whole-account hard daily cap (grosze). */
  accountCap: number | null;
  /** Spike multiplier vs the trailing daily average. */
  multiplier: number;
}

export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  campaignCap: null,
  accountCap: null,
  multiplier: DEFAULT_MULTIPLIER,
};

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[], m: number): number {
  if (xs.length < 2) return 0;
  const variance =
    xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

// Evaluate one day (yesterday complete / today partial) for one spender.
function evaluateDay(params: {
  idPrefix: string;
  scope: "campaign" | "client";
  label: string;
  daySpend: number;
  dayLabel: string; // "wczoraj" | "dziś"
  baseline: number[];
  cap: number | null;
  multiplier: number;
  minAbs: number;
  newFloor: number;
  isToday: boolean;
}): Anomaly | null {
  const {
    idPrefix,
    scope,
    label,
    daySpend,
    dayLabel,
    baseline,
    cap,
    multiplier,
    minAbs,
    newFloor,
    isToday,
  } = params;

  if (daySpend <= 0) return null;

  const m = mean(baseline);
  const sd = stddev(baseline, m);
  const hasBaseline = m >= minAbs / 2; // meaningful history

  const overCap = cap != null && cap > 0 && daySpend >= cap;
  const overMultiple = hasBaseline && daySpend >= m * multiplier;
  // Statistical outlier: well above the normal spread, and clearly above the
  // mean (so low-variance campaigns don't trip on a tiny wobble).
  const overSigma =
    hasBaseline && sd > 0 && daySpend >= m + Z_THRESHOLD * sd && daySpend >= m * 1.5;
  const dormantJump = !hasBaseline && daySpend >= newFloor;

  if (!overCap && !overMultiple && !overSigma && !dormantJump) return null;
  if (!overCap && daySpend < minAbs) return null; // absolute noise floor

  const reason = overCap
    ? `przekroczono limit dzienny (${formatMoneyPLN(cap!)})`
    : hasBaseline
      ? `to ${(daySpend / m).toFixed(1)}x średniej dziennej (${formatMoneyPLN(
          Math.round(m)
        )})`
      : `nagły wydatek przy braku historii`;

  return {
    id: `${idPrefix}-${isToday ? "today" : "yesterday"}`,
    severity: "critical",
    scope,
    scopeLabel: scope === "client" ? "Całe konto" : label,
    metric: "Wydatki",
    direction: "up",
    changePct: m > 0 ? ((daySpend - m) / m) * 100 : 0,
    title: `🚨 Skok wydatków ${dayLabel}: ${formatMoneyPLN(daySpend)}`,
    description:
      scope === "client"
        ? `Konto wydało ${formatMoneyPLN(daySpend)} ${dayLabel} - ${reason}.${
            isToday ? " Dzień jeszcze trwa." : ""
          }`
        : `Kampania „${label}" wydała ${formatMoneyPLN(daySpend)} ${dayLabel} - ${reason}.${
            isToday ? " Dzień jeszcze trwa." : ""
          }`,
  };
}

// Sustained overspend: this week's daily average vs the prior two weeks.
function evaluateWeek(params: {
  idPrefix: string;
  scope: "campaign" | "client";
  label: string;
  weekTotal: number;
  priorAvgPerDay: number;
  absFloor: number;
}): Anomaly | null {
  const { idPrefix, scope, label, weekTotal, priorAvgPerDay, absFloor } = params;
  if (weekTotal < absFloor) return null;

  const weekAvgPerDay = weekTotal / WEEK_DAYS;
  const hasPrior = priorAvgPerDay > 0;
  const overRatio = hasPrior && weekAvgPerDay >= priorAvgPerDay * WEEK_RATIO;
  // No prior spend but a large sustained week = also worth a flag.
  const newSustained = !hasPrior && weekTotal >= absFloor;
  if (!overRatio && !newSustained) return null;

  const pct = hasPrior
    ? `+${(((weekAvgPerDay - priorAvgPerDay) / priorAvgPerDay) * 100).toFixed(0)}%`
    : "nowy wydatek";
  const reason = hasPrior
    ? `${pct} względem poprzednich tygodni (śr. ${formatMoneyPLN(
        Math.round(priorAvgPerDay)
      )}/dzień → ${formatMoneyPLN(Math.round(weekAvgPerDay))}/dzień)`
    : `${formatMoneyPLN(weekTotal)} w tydzień przy braku wcześniejszej historii`;

  return {
    id: `${idPrefix}-week`,
    severity: "high",
    scope,
    scopeLabel: scope === "client" ? "Całe konto" : label,
    metric: "Wydatki (7 dni)",
    direction: "up",
    changePct:
      hasPrior && priorAvgPerDay > 0
        ? ((weekAvgPerDay - priorAvgPerDay) / priorAvgPerDay) * 100
        : 100,
    title: `📈 Podwyższone wydatki (7 dni): ${formatMoneyPLN(weekTotal)}`,
    description:
      scope === "client"
        ? `Konto wydało ${formatMoneyPLN(weekTotal)} przez ostatnie 7 dni - ${reason}.`
        : `Kampania „${label}" wydała ${formatMoneyPLN(
            weekTotal
          )} przez ostatnie 7 dni - ${reason}.`,
  };
}

/**
 * Budget-spike detection focused on catching abnormal spend FAST and robustly:
 *   1. Single-day blowout (yesterday complete + today partial) per campaign and
 *      account - flagged when the day exceeds a hard cap, the trailing average
 *      x multiplier, OR is a statistical outlier (mean + 2.5 sigma). Marked
 *      `critical` so the notifier bypasses quiet hours.
 *   2. Sustained weekly overspend - this week's daily average vs the prior two
 *      weeks. Marked `high` (slower-burn signal, respects the send window).
 * Reads live from ads_daily (admin client for cron / RLS-free).
 */
export async function detectBudgetSpikes(
  clientId: string,
  client?: SupabaseClient,
  config: BudgetConfig = DEFAULT_BUDGET_CONFIG
): Promise<Anomaly[]> {
  const supabase = client ?? createClient();
  const todayStr = fmtDate(new Date());
  const today = new Date(`${todayStr}T00:00:00`);

  // Fetch enough history for both single-day baselines and the weekly window.
  const fetchStart = fmtDate(subDays(today, WEEK_DAYS + PRIOR_WEEKS_DAYS + 1)); // ~22 days

  const data = await fetchAll<Record<string, unknown>>((from, to) =>
    supabase
      .from("ads_daily")
      .select("date, campaign_id, campaign_name, spend_minor_units")
      .eq("client_id", clientId)
      .gte("date", fetchStart)
      .lte("date", todayStr)
      .order("date", { ascending: true })
      .order("provider", { ascending: true })
      .order("campaign_id", { ascending: true })
      .range(from, to)
  );

  // Date-string helpers for window membership.
  const d = (offset: number) => fmtDate(subDays(today, offset));
  const yesterdayStr = d(1);
  const dayBaseline = new Set<string>(); // [today-15 .. today-2]
  for (let i = 2; i <= 1 + DAY_BASELINE; i++) dayBaseline.add(d(i));
  const weekWindow = new Set<string>(); // [today-7 .. today-1]
  for (let i = 1; i <= WEEK_DAYS; i++) weekWindow.add(d(i));
  const priorWindow = new Set<string>(); // [today-21 .. today-8]
  for (let i = WEEK_DAYS + 1; i <= WEEK_DAYS + PRIOR_WEEKS_DAYS; i++)
    priorWindow.add(d(i));

  interface Acc {
    name: string;
    baseline: Map<string, number>; // date -> spend (day-baseline window)
    yesterday: number;
    today: number;
    week: number;
    prior: number;
  }
  const camp = new Map<string, Acc>();
  const account: Acc = {
    name: "Całe konto",
    baseline: new Map(),
    yesterday: 0,
    today: 0,
    week: 0,
    prior: 0,
  };

  const add = (acc: Acc, date: string, spend: number) => {
    if (date === todayStr) acc.today += spend;
    else if (date === yesterdayStr) acc.yesterday += spend;
    if (dayBaseline.has(date))
      acc.baseline.set(date, (acc.baseline.get(date) ?? 0) + spend);
    if (weekWindow.has(date)) acc.week += spend;
    if (priorWindow.has(date)) acc.prior += spend;
  };

  for (const r of data ?? []) {
    const date = r.date as string;
    const spend = Number(r.spend_minor_units);
    const id = r.campaign_id as string;
    const c =
      camp.get(id) ??
      ({
        name: (r.campaign_name as string) || id,
        baseline: new Map(),
        yesterday: 0,
        today: 0,
        week: 0,
        prior: 0,
      } as Acc);
    add(c, date, spend);
    camp.set(id, c);
    add(account, date, spend);
  }

  // Turn the day-baseline map into a full 14-length array (missing days = 0).
  const baselineArray = (acc: Acc): number[] =>
    Array.from(dayBaseline).map((day) => acc.baseline.get(day) ?? 0);

  const out: Anomaly[] = [];

  // --- Account ---
  const accBase = baselineArray(account);
  for (const [isToday, spend, label] of [
    [false, account.yesterday, "wczoraj"],
    [true, account.today, "dziś"],
  ] as const) {
    const hit = evaluateDay({
      idPrefix: "budget-account",
      scope: "client",
      label: "Całe konto",
      daySpend: spend,
      dayLabel: label,
      baseline: accBase,
      cap: config.accountCap,
      multiplier: config.multiplier,
      minAbs: MIN_ABS_ACCOUNT,
      newFloor: NEW_SPEND_FLOOR_ACCOUNT,
      isToday,
    });
    if (hit) out.push(hit);
  }
  const accWeek = evaluateWeek({
    idPrefix: "budget-account",
    scope: "client",
    label: "Całe konto",
    weekTotal: account.week,
    priorAvgPerDay: account.prior / PRIOR_WEEKS_DAYS,
    absFloor: WEEK_ABS_ACCOUNT,
  });
  if (accWeek) out.push(accWeek);

  // --- Per-campaign ---
  for (const [id, c] of camp) {
    const base = baselineArray(c);
    for (const [isToday, spend, label] of [
      [false, c.yesterday, "wczoraj"],
      [true, c.today, "dziś"],
    ] as const) {
      const hit = evaluateDay({
        idPrefix: `budget-camp-${id}`,
        scope: "campaign",
        label: c.name,
        daySpend: spend,
        dayLabel: label,
        baseline: base,
        cap: config.campaignCap,
        multiplier: config.multiplier,
        minAbs: MIN_ABS_CAMPAIGN,
        newFloor: NEW_SPEND_FLOOR_CAMPAIGN,
        isToday,
      });
      if (hit) out.push(hit);
    }
    const week = evaluateWeek({
      idPrefix: `budget-camp-${id}`,
      scope: "campaign",
      label: c.name,
      weekTotal: c.week,
      priorAvgPerDay: c.prior / PRIOR_WEEKS_DAYS,
      absFloor: WEEK_ABS_CAMPAIGN,
    });
    if (week) out.push(week);
  }

  // Critical (single-day) first, then by size of deviation.
  const rank = { critical: 0, high: 1, medium: 2 };
  return out
    .sort(
      (a, b) => rank[a.severity] - rank[b.severity] || b.changePct - a.changePct
    )
    .slice(0, 40);
}
