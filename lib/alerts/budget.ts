import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import type { Anomaly } from "@/lib/alerts/anomalies";
import { formatMoneyPLN } from "@/lib/utils";

const WARSAW_TZ = "Europe/Warsaw";
const fmtDate = (d: Date) => formatInTimeZone(d, WARSAW_TZ, "yyyy-MM-dd");

// How many complete days form the "normal daily spend" baseline.
const BASELINE_DAYS = 14;

// Defaults (grosze). Tunable per client via notification_settings.
const DEFAULT_MULTIPLIER = 3; // a day >= 3x the normal daily average is a spike
const MIN_ABS_CAMPAIGN = 30_000; // 300 zl - ignore spikes smaller than this
const MIN_ABS_ACCOUNT = 100_000; // 1 000 zl - account-level noise floor
// A previously-dormant/near-zero campaign suddenly spending big can't be caught
// by a multiplier (avg ~= 0), so flag on an absolute jump instead.
const NEW_SPEND_FLOOR_CAMPAIGN = 200_000; // 2 000 zl
const NEW_SPEND_FLOOR_ACCOUNT = 500_000; // 5 000 zl

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

interface DayRow {
  date: string;
  campaign_id: string;
  campaign_name: string;
  spend: number;
}

// One tested day's outcome for a single spender (campaign or the whole account).
function evaluate(params: {
  idPrefix: string;
  scope: "campaign" | "client";
  label: string;
  daySpend: number;
  dayLabel: string; // "wczoraj" | "dziś"
  baselineAvg: number;
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
    baselineAvg,
    cap,
    multiplier,
    minAbs,
    newFloor,
    isToday,
  } = params;

  if (daySpend <= 0) return null;

  const overCap = cap != null && cap > 0 && daySpend >= cap;
  const hasBaseline = baselineAvg >= minAbs;
  const overMultiple = hasBaseline && daySpend >= baselineAvg * multiplier;
  // Dormant -> big: no meaningful baseline but a large absolute jump.
  const dormantJump = !hasBaseline && daySpend >= newFloor;

  if (!overCap && !overMultiple && !dormantJump) return null;
  // Multiplier/dormant spikes still need to clear the absolute noise floor.
  if (!overCap && daySpend < minAbs) return null;

  const changePct =
    baselineAvg > 0 ? ((daySpend - baselineAvg) / baselineAvg) * 100 : 0;

  const reason = overCap
    ? `przekroczono limit dzienny (${formatMoneyPLN(cap!)})`
    : hasBaseline
      ? `to ${(daySpend / baselineAvg).toFixed(1)}x średniej dziennej (${formatMoneyPLN(
          Math.round(baselineAvg)
        )})`
      : `nagły wydatek przy braku historii`;

  const scopeWord = scope === "client" ? "Całe konto" : label;

  return {
    id: `${idPrefix}-${isToday ? "today" : "yesterday"}`,
    severity: "critical",
    scope,
    scopeLabel: scopeWord,
    metric: "Wydatki",
    direction: "up",
    changePct,
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

/**
 * Budget-spike detection focused on catching a single-day overspend FAST.
 * Unlike the 3-day-average anomaly engine, this looks at individual days
 * (yesterday, complete; and today, partial) per campaign and for the whole
 * account, comparing each against the trailing daily-spend baseline and any
 * configured hard caps. All hits are `critical` so the notifier bypasses
 * quiet hours. Reads live from ads_daily (admin client for cron / RLS-free).
 */
export async function detectBudgetSpikes(
  clientId: string,
  client?: SupabaseClient,
  config: BudgetConfig = DEFAULT_BUDGET_CONFIG
): Promise<Anomaly[]> {
  const supabase = client ?? createClient();
  const todayStr = fmtDate(new Date());
  const today = new Date(`${todayStr}T00:00:00`);
  const yesterdayStr = fmtDate(subDays(today, 1));
  // Baseline spans the 14 complete days before yesterday.
  const baselineStart = fmtDate(subDays(today, 1 + BASELINE_DAYS));
  const baselineEnd = fmtDate(subDays(today, 2));

  const { data } = await supabase
    .from("ads_daily")
    .select("date, campaign_id, campaign_name, spend_minor_units")
    .eq("client_id", clientId)
    .gte("date", baselineStart)
    .lte("date", todayStr);

  const rows: DayRow[] = (data ?? []).map((r) => ({
    date: r.date as string,
    campaign_id: r.campaign_id as string,
    campaign_name: (r.campaign_name as string) || (r.campaign_id as string),
    spend: Number(r.spend_minor_units),
  }));

  // Per-campaign accumulation.
  const camp = new Map<
    string,
    { name: string; baselineTotal: number; yesterday: number; today: number }
  >();
  // Account totals keyed by date bucket.
  let accBaselineTotal = 0;
  let accYesterday = 0;
  let accToday = 0;

  for (const r of rows) {
    const c =
      camp.get(r.campaign_id) ??
      { name: r.campaign_name, baselineTotal: 0, yesterday: 0, today: 0 };
    if (r.date === todayStr) {
      c.today += r.spend;
      accToday += r.spend;
    } else if (r.date === yesterdayStr) {
      c.yesterday += r.spend;
      accYesterday += r.spend;
    } else if (r.date >= baselineStart && r.date <= baselineEnd) {
      c.baselineTotal += r.spend;
      accBaselineTotal += r.spend;
    }
    camp.set(r.campaign_id, c);
  }

  const out: Anomaly[] = [];

  // --- Account-level (fires even if no single campaign trips) ---
  const accAvg = accBaselineTotal / BASELINE_DAYS;
  for (const [isToday, spend, label] of [
    [false, accYesterday, "wczoraj"],
    [true, accToday, "dziś"],
  ] as const) {
    const hit = evaluate({
      idPrefix: "budget-account",
      scope: "client",
      label: "Całe konto",
      daySpend: spend,
      dayLabel: label,
      baselineAvg: accAvg,
      cap: config.accountCap,
      multiplier: config.multiplier,
      minAbs: MIN_ABS_ACCOUNT,
      newFloor: NEW_SPEND_FLOOR_ACCOUNT,
      isToday,
    });
    if (hit) out.push(hit);
  }

  // --- Per-campaign ---
  for (const [id, c] of camp) {
    const avg = c.baselineTotal / BASELINE_DAYS;
    for (const [isToday, spend, label] of [
      [false, c.yesterday, "wczoraj"],
      [true, c.today, "dziś"],
    ] as const) {
      const hit = evaluate({
        idPrefix: `budget-camp-${id}`,
        scope: "campaign",
        label: c.name,
        daySpend: spend,
        dayLabel: label,
        baselineAvg: avg,
        cap: config.campaignCap,
        multiplier: config.multiplier,
        minAbs: MIN_ABS_CAMPAIGN,
        newFloor: NEW_SPEND_FLOOR_CAMPAIGN,
        isToday,
      });
      if (hit) out.push(hit);
    }
  }

  // Biggest overspend first.
  return out.sort((a, b) => b.changePct - a.changePct).slice(0, 30);
}
