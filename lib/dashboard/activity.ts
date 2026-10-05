import { createAdminClient } from "@/lib/supabase/admin";

// "Kiedy Twoi klienci są aktywni": the day x hour heatmap plus the few
// derived facts a non-technical client can act on (when to post / push ads).
// Everything is computed here, server-side, so the client component only
// renders.

export type DayGroup = "weekdays" | "weekend" | "all";

export interface ActivityHeatmap {
  snapshotDate: string | null;
  /** Monday-first rows (0 = poniedziałek .. 6 = niedziela) x 24 hours. */
  matrix: number[][];
  total: number;
  peak: { day: number; hour: number; sessions: number };
  /** Best contiguous 3-hour window within the dominant day group. */
  bestWindow: { group: DayGroup; startHour: number; endHour: number; share: number };
  /** Share of all sessions on Mon-Fri / Sat-Sun (raw, sums to 1). */
  weekdayShare: number;
  weekendShare: number;
  /** Monday-first indices of the two busiest days. */
  topDays: number[];
  takeaway: string;
}

const WINDOW_HOURS = 3;
// A day group "wins" only if its per-day average beats the other by 15% -
// otherwise "przez cały tydzień" is the honest answer.
const GROUP_MARGIN = 1.15;
// Below this many sessions in 28 days the pattern is mostly noise.
const MIN_SESSIONS_FOR_ADVICE = 100;

const DAYS_ON = [
  "w poniedziałki",
  "we wtorki",
  "w środy",
  "w czwartki",
  "w piątki",
  "w soboty",
  "w niedziele",
];

function partOfDay(startHour: number): string {
  const mid = startHour + (WINDOW_HOURS - 1) / 2;
  if (mid < 5) return "w nocy";
  if (mid < 10) return "rano";
  if (mid < 13) return "przed południem";
  if (mid < 17) return "po południu";
  if (mid < 22) return "wieczorem";
  return "późnym wieczorem";
}

function emptyMatrix(): number[][] {
  return Array.from({ length: 7 }, () => Array<number>(24).fill(0));
}

/**
 * Derives insights from a Monday-first 7x24 sessions matrix. Exported so the
 * demo page can feed inline data through the same logic. Returns null when
 * there is no traffic at all.
 */
export function buildActivityHeatmap(
  input: number[][],
  snapshotDate: string | null = null
): ActivityHeatmap | null {
  const matrix = emptyMatrix();
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const v = Number(input[d]?.[h] ?? 0);
      matrix[d][h] = Number.isFinite(v) && v > 0 ? v : 0;
    }
  }

  const dayTotals = matrix.map((row) => row.reduce((a, v) => a + v, 0));
  const total = dayTotals.reduce((a, v) => a + v, 0);
  if (total <= 0) return null;

  let peak = { day: 0, hour: 0, sessions: -1 };
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      if (matrix[d][h] > peak.sessions) peak = { day: d, hour: h, sessions: matrix[d][h] };
    }
  }

  const weekdaySum = dayTotals.slice(0, 5).reduce((a, v) => a + v, 0);
  const weekendSum = dayTotals[5] + dayTotals[6];
  // Per-day averages: 5 weekdays would "win" raw totals by sheer count.
  const weekdayAvg = weekdaySum / 5;
  const weekendAvg = weekendSum / 2;
  const group: DayGroup =
    weekdayAvg >= weekendAvg * GROUP_MARGIN
      ? "weekdays"
      : weekendAvg >= weekdayAvg * GROUP_MARGIN
        ? "weekend"
        : "all";
  const groupDays = group === "weekdays" ? [0, 1, 2, 3, 4] : group === "weekend" ? [5, 6] : [0, 1, 2, 3, 4, 5, 6];

  const hourly = Array<number>(24).fill(0);
  for (const d of groupDays) for (let h = 0; h < 24; h++) hourly[h] += matrix[d][h];
  const groupTotal = hourly.reduce((a, v) => a + v, 0);

  // No wrap past midnight: "22-1" is not a slot anyone schedules posts for.
  let bestStart = 0;
  let bestSum = -1;
  for (let s = 0; s <= 24 - WINDOW_HOURS; s++) {
    let sum = 0;
    for (let h = s; h < s + WINDOW_HOURS; h++) sum += hourly[h];
    if (sum > bestSum) {
      bestSum = sum;
      bestStart = s;
    }
  }

  const topDays = dayTotals
    .map((v, d) => ({ v, d }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 2)
    .map((x) => x.d)
    .sort((a, b) => a - b);

  const start = bestStart;
  const end = bestStart + WINDOW_HOURS;
  const when = `${partOfDay(start)}, ${start}-${end}`;
  const advice = "to dobry czas na posty i mocniejsze reklamy.";
  let takeaway: string;
  if (total < MIN_SESSIONS_FOR_ADVICE) {
    takeaway =
      "Wizyt jest jeszcze za mało, żeby wskazać pewne godziny - wyraźny wzór pojawi się, gdy ruch urośnie.";
  } else if (group === "weekdays") {
    takeaway = `Najwięcej osób odwiedza stronę w dni robocze ${when} - ${advice}`;
  } else if (group === "weekend") {
    takeaway = `Najwięcej osób odwiedza stronę w weekendy ${when} - ${advice}`;
  } else {
    takeaway = `Ruch rozkłada się na cały tydzień, najmocniej ${DAYS_ON[topDays[0]]} i ${DAYS_ON[topDays[1]]} ${when} - ${advice}`;
  }

  return {
    snapshotDate,
    matrix,
    total,
    peak,
    bestWindow: {
      group,
      startHour: start,
      endHour: end,
      share: groupTotal > 0 ? bestSum / groupTotal : 0,
    },
    weekdayShare: weekdaySum / total,
    weekendShare: weekendSum / total,
    topDays,
    takeaway,
  };
}

/**
 * Latest day x hour snapshot for a client. Uses the admin client: the caller
 * has already resolved an authorized client id.
 *
 * Returns null on any error, including the table not existing yet (migration
 * 0024 not run) - this card is a nice-to-have and must never break the page.
 */
export async function getActivityHeatmap(clientId: string): Promise<ActivityHeatmap | null> {
  try {
    const admin = createAdminClient();
    const latest = await admin
      .from("ga4_activity_heatmap")
      .select("snapshot_date")
      .eq("client_id", clientId)
      .order("snapshot_date", { ascending: false })
      .limit(1);
    if (latest.error || !latest.data?.length) return null;
    const snapshotDate = latest.data[0].snapshot_date as string;

    // 168 rows max - well under the PostgREST page cap.
    const { data, error } = await admin
      .from("ga4_activity_heatmap")
      .select("day_of_week, hour, sessions")
      .eq("client_id", clientId)
      .eq("snapshot_date", snapshotDate);
    if (error || !data) return null;

    const matrix = emptyMatrix();
    for (const r of data as Array<Record<string, unknown>>) {
      const gaDay = Number(r.day_of_week);
      const hour = Number(r.hour);
      if (!(gaDay >= 0 && gaDay <= 6 && hour >= 0 && hour <= 23)) continue;
      // GA4 counts from Sunday = 0; Polish calendars start on Monday.
      matrix[(gaDay + 6) % 7][hour] += Number(r.sessions ?? 0);
    }
    return buildActivityHeatmap(matrix, snapshotDate);
  } catch (err) {
    console.error("[activity] read failed", (err as Error)?.message ?? err);
    return null;
  }
}
