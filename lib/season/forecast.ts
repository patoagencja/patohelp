// Where the season will end, from where it stands now and the shape of the
// previous season. Pure; shared by the ad numbers and the shop's own sales.
//
// The naive "so far / last season's share by now" swings wildly early on (at
// 5% in, every 10 000 zł today moves the end by 200 000 zł) and projects
// October's pace onto December. Instead:
// - the rest of the season is last season's rest × the growth of the most
//   recent two weeks (what is happening now, not in early October);
// - that growth is pulled towards "same as last year" while little of the
//   season has happened (w = share / (share + 0.15)), so a lucky first week
//   doesn't promise a record;
// - the result carries a range that narrows as the season fills in, and is
//   marked preliminary below 15% of last season's sales.

export interface SeasonForecast {
  value: number;
  low: number;
  high: number;
  /** Under 15% of the previous season had happened by now. */
  preliminary: boolean;
}

/** Below this share of the previous season, no forecast at all. */
const MIN_SHARE = 0.03;
const PRELIMINARY_SHARE = 0.15;
/** ± spread of the projected remainder at the very start (shrinks to 0). */
const SPREAD = 0.25;

export function projectSeason(input: {
  /** This season so far (through the comparison day). */
  soFar: number;
  /** Previous season through the same day. */
  prevSoFar: number;
  /** Previous season in full. */
  prevFull: number;
  /** This season's last ~14 finished days, and the same days a year earlier. */
  recent: number;
  prevRecent: number;
}): SeasonForecast | null {
  const { soFar, prevSoFar, prevFull, recent, prevRecent } = input;
  if (!(prevFull > 0) || !(prevSoFar > 0) || !(soFar > 0)) return null;
  const share = prevSoFar / prevFull;
  if (share < MIN_SHARE) return null;

  const growthSoFar = soFar / prevSoFar;
  const growthRecent = prevRecent > 0 && recent > 0 ? recent / prevRecent : growthSoFar;
  const w = share / (share + 0.15);
  const growth = w * growthRecent + (1 - w) * 1;
  const rest = Math.max(0, prevFull - prevSoFar) * growth;
  const spread = rest * SPREAD * (1 - share);
  return {
    value: Math.round(soFar + rest),
    low: Math.round(soFar + rest - spread),
    high: Math.round(soFar + rest + spread),
    preliminary: share < PRELIMINARY_SHARE,
  };
}
