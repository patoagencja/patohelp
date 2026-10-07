import { computeSeasonBudget, type SeasonBudget } from "./budget";
import { diffDaysIso, type SeasonBudgetConfig } from "./config";
import type { SeasonView } from "./load";

/**
 * The budget for the season on screen. Null before the season starts: the
 * plan is spread along a season that hasn't begun, and "pre" shows last
 * season's numbers (SeasonState.current), not this one's.
 */
export function budgetForView(view: SeasonView, cfg: SeasonBudgetConfig): SeasonBudget | null {
  const { state } = view;
  if (state.phase === "pre") return null;
  const len = view.days.length;
  const running = state.phase === "in";
  const todayIdx = running ? diffDaysIso(state.current.start, view.today) : len;
  // Day 1 has no finished day: asOf is today, half-synced (load.ts).
  const asOfIdx = running
    ? view.asOf === view.today
      ? -1
      : diffDaysIso(state.current.start, view.asOf)
    : len - 1;
  const markets = Object.entries(view.marketDays).map(([code, m]) => ({
    code,
    spend: m.spend,
    prevSpend: m.prevSpend,
  }));
  const prevMapped = markets.reduce((a, m) => a + m.prevSpend.reduce((x, y) => x + y, 0), 0);
  return computeSeasonBudget({
    total: cfg.total,
    dates: view.days.map((d) => d.date),
    todayIdx,
    asOfIdx,
    spend: view.days.map((d, i) => (i <= asOfIdx ? d.spend : null)),
    todaySpend: view.todayTotals?.spend ?? 0,
    prevSpend: view.days.map((d) => d.prevSpend),
    prevUnmappedSpend: Math.max(0, view.prevFull.spend - prevMapped),
    markets,
  });
}
