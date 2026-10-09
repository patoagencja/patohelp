import { cache } from "react";
import { differenceInCalendarDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

import { getPacing, type FlightMetric, type PacingFlight } from "@/lib/alerts/pacing";

/**
 * Goal tiles ("Cele kampanii" row on Alerty and the overview): the goals that
 * matter right now - running ones plus those that ended in the last few days -
 * with what a manager asks of each: how far, how far we should be, what pace
 * it takes from here, and a verdict. Built on the same pacing as the Alerty
 * goal cards, so the two never disagree.
 */

export type GoalTileStatus = "on_track" | "behind" | "at_risk" | "done" | "spent" | "over" | "ended";

/**
 * One set of words for a goal's state, on the overview tiles and the Alerty
 * cards alike (they used to say "zagrożony" and "Poniżej tempa" about the
 * same goal). A spend goal reaching 100% is a budget used up, not a win;
 * past it, an overspend.
 */
export const GOAL_STATUS_WORDS: Record<GoalTileStatus, string> = {
  on_track: "w planie",
  behind: "poniżej tempa",
  at_risk: "zagrożony",
  done: "cel osiągnięty",
  spent: "budżet wykorzystany",
  over: "budżet przekroczony",
  ended: "zakończony",
};

/** Over this share of a spend target the goal reads as overspent. */
export const OVERSPEND_RATIO = 1.05;

export interface GoalTile {
  id: string;
  campaignName: string;
  adsetName: string | null;
  provider: string | null;
  metric: FlightMetric;
  target: number;
  realized: number;
  /** Where the linear plan says we should be today (same unit as target). */
  expected: number;
  startDate: string;
  endDate: string;
  status: GoalTileStatus;
  realizedPct: number;
  expectedPct: number;
  /** Days left including today (0 once ended). */
  daysRemaining: number;
  /** Average delivered per elapsed day. */
  avgPerDay: number;
  /** What each remaining day must deliver to hit the target; null when moot. */
  neededPerDay: number | null;
  totalDays: number;
  /** Cumulative delivered value per elapsed day. */
  cumulative: number[];
  /** yyyy-MM-dd the target was crossed, if it was. */
  achievedOn: string | null;
}

/** Ended goals stay on the row this long, marked as finished. */
const ENDED_GRACE_DAYS = 3;
/** "zagrożony": the pace still needed is this many times the average so far. */
const AT_RISK_RATIO = 1.5;

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Pure: pacing rows -> the tiles to show today (running + recently ended). */
export function buildGoalTiles(flights: PacingFlight[], todayStr: string): GoalTile[] {
  const graceStart = addDays(todayStr, -ENDED_GRACE_DAYS);
  const today = new Date(`${todayStr}T00:00:00Z`);

  return flights
    .filter((f) => f.startDate <= todayStr && f.endDate >= graceStart)
    .map((f): GoalTile => {
      const ended = f.endDate < todayStr;
      const cumulative: number[] = [];
      let run = 0;
      let achievedOn: string | null = null;
      f.daily.forEach((v, i) => {
        run += v;
        cumulative.push(run);
        if (achievedOn === null && f.target > 0 && run >= f.target) {
          achievedOn = addDays(f.startDate, i);
        }
      });

      const daysRemaining = ended
        ? 0
        : differenceInCalendarDays(new Date(`${f.endDate}T00:00:00Z`), today) + 1;
      // Pace from finished days only: today's few synced hours divided in as
      // a whole day halved the "dotąd X dziennie" on day 2 and tipped goals on
      // plan into "zagrożony" every morning.
      const doneDays = ended ? f.elapsedDays : f.elapsedDays - 1;
      const todayPart = ended ? 0 : f.daily[f.elapsedDays - 1] ?? 0;
      const avgPerDay = doneDays > 0 ? (f.realized - todayPart) / doneDays : 0;
      const remaining = Math.max(f.target - f.realized, 0);
      const neededPerDay = !ended && remaining > 0 && daysRemaining > 0 ? remaining / daysRemaining : null;

      let status: GoalTileStatus;
      if (f.target > 0 && f.realized >= f.target) {
        status = f.metric !== "spend" ? "done" : f.realized > f.target * OVERSPEND_RATIO ? "over" : "spent";
      }
      else if (ended) status = "ended";
      // Day one is a partial day: judge the pace once there's a full day.
      else if (
        neededPerDay !== null &&
        f.elapsedDays >= 2 &&
        (avgPerDay <= 0 || neededPerDay > AT_RISK_RATIO * avgPerDay)
      )
        status = "at_risk";
      else if (f.paceRatio !== null && f.paceRatio < 0.9) status = "behind";
      else status = "on_track";

      return {
        id: f.id,
        campaignName: f.campaignName,
        adsetName: f.adsetName,
        provider: f.provider,
        metric: f.metric,
        target: f.target,
        realized: f.realized,
        expected: f.target * Math.min(f.expectedPct, 1),
        startDate: f.startDate,
        endDate: f.endDate,
        status,
        realizedPct: f.realizedPct,
        expectedPct: Math.min(f.expectedPct, 1),
        daysRemaining,
        avgPerDay,
        neededPerDay,
        totalDays: f.totalDays,
        cumulative,
        achievedOn,
      };
    })
    // Running goals first (soonest deadline first), recently ended last.
    .sort((a, b) => {
      const ae = a.endDate < todayStr ? 1 : 0;
      const be = b.endDate < todayStr ? 1 : 0;
      return ae - be || a.endDate.localeCompare(b.endDate);
    });
}

/**
 * Today's goal tiles for a client. Shares the request-cached pacing read with
 * the Alerty goal cards and the overview plan; a failed read hides the row
 * instead of failing the page.
 */
export const getActiveGoals = cache(async (clientId: string): Promise<GoalTile[]> => {
  try {
    const flights = await getPacing(clientId);
    const today = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");
    return buildGoalTiles(flights, today);
  } catch (err) {
    console.error("[campaign-goals] failed", (err as Error).message);
    return [];
  }
});
