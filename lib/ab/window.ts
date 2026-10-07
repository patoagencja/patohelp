import { seasonMoments, seasonState, seasonWindow, type SeasonConfig } from "@/lib/season/config";

import { addDaysIso, fixedWindow, type SalesMoment } from "./stats";
import type { AbWindowKey } from "./types";

// Period and sales-moment resolution for "Testy kreacji", shared by the live
// loader (lib/ab/load.ts), the reaction alerts and the demo, so all three
// judge exactly the same days. Pure: no database, no request.

export interface AbWindow {
  /** The period actually used ("season" falls back to "30d" for non-seasonal clients). */
  key: AbWindowKey;
  start: string;
  end: string;
}

/**
 * Period days, Warsaw calendar. Fixed periods are finished days ending
 * yesterday ("today" is the preview). "season" = the running season's
 * finished days (on its first day: today, as a preview), or the last
 * finished season in full when outside it; without a season config it is
 * the 30-day period.
 */
export function resolveAbWindow(
  key: AbWindowKey,
  today: string,
  season: SeasonConfig | null
): AbWindow {
  if (key === "season") {
    if (!season) return { key: "30d", ...fixedWindow("30d", today) };
    const state = seasonState(season, today);
    const cur = state.current;
    if (state.phase !== "in") return { key, start: cur.start, end: cur.end };
    const yesterday = addDaysIso(today, -1);
    return { key, start: cur.start, end: cur.start <= yesterday ? yesterday : today };
  }
  return { key, ...fixedWindow(key, today) };
}

/** Without a season config: the shopping days every Polish shop feels. */
const FIXED_MOMENTS = new Set(["bf", "mikolajki", "wigilia"]);

/**
 * Known sales moments around `today` (this year and last, so a look-back
 * across New Year still sees Wigilia): the client's season moments when it
 * has a season (lib/season/config seasonMoments), else Black Friday,
 * Mikołajki and Wigilia. Fatigue is not judged across them - the days after
 * a peak always "fall".
 */
export function salesMomentsFor(season: SeasonConfig | null, today: string): SalesMoment[] {
  const year = Number(today.slice(0, 4));
  const out: SalesMoment[] = [];
  for (const y of [year - 1, year]) {
    const moments = season
      ? seasonMoments(seasonWindow(season, y))
      : seasonMoments({ start: `${y}-01-01`, end: `${y}-12-31`, year: y }).filter((m) => FIXED_MOMENTS.has(m.key));
    for (const m of moments) out.push({ date: m.date, label: m.label });
  }
  return out;
}
