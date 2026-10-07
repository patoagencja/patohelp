// "Budżet sezonu": the agency's season ad budget spread over the days along
// last season's own spending curve (a flat line would call the Black Friday
// week an overspend and October an underspend), then compared with what was
// really spent and turned into "how much a day from here". Pure and
// import-free: the unit tests run it directly under Node's type stripping.

export interface BudgetMarketInput {
  code: string;
  /** This season per day through the last finished day (null = not yet). */
  spend: Array<number | null>;
  /** Last season per day (its own index). */
  prevSpend: number[];
}

export interface BudgetInput {
  /** Whole-season budget, grosze. */
  total: number;
  /** Date of each season day (index = SeasonDay.i). */
  dates: string[];
  /** Index of today (may be < 0 before the season or >= length after). */
  todayIdx: number;
  /** Last finished day compared (-1 = none yet). */
  asOfIdx: number;
  /** This season's spend per day (null = not happened). */
  spend: Array<number | null>;
  /** Today's spend so far (not part of the comparison). */
  todaySpend: number;
  /** Last season's spend per day on its own index; null = no data. */
  prevSpend: Array<number | null>;
  /** Last season's spend in campaigns without a market in the name. */
  prevUnmappedSpend: number;
  markets: BudgetMarketInput[];
}

export interface BudgetWeek {
  from: string;
  to: string;
  plan: number;
  /** Spent in the week's finished days; null = the week hasn't started. */
  actual: number | null;
  /** Plan for the same finished days (the fair comparison mid-week). */
  planSoFar: number;
  current: boolean;
}

export interface BudgetMarket {
  code: string;
  /** Share of the market budget (0..1) - last season's split. */
  share: number;
  budget: number;
  planToDate: number;
  spentToDate: number;
  /** spent / plan so far; null before the first finished day. */
  pace: number | null;
  /** What today should take to stay on plan from here. */
  todayPlan: number;
}

export interface SeasonBudget {
  total: number;
  /** "prev" = shaped like last season; "even" = no history, a flat plan. */
  curveSource: "prev" | "even";
  planToDate: number;
  spentToDate: number;
  pace: number | null;
  remaining: number;
  todaySpend: number;
  /** Today's share of what is left, along the curve. */
  todayPlan: number;
  /** Season total if spending keeps this pace along the curve. */
  projected: number | null;
  /** The next 7 days (from today) of the re-spread remainder. */
  next: Array<{ date: string; amount: number }>;
  /** Cumulative plan per day, actual through the last finished day. */
  cumulative: Array<{ date: string; plan: number; actual: number | null }>;
  weeks: BudgetWeek[];
  markets: BudgetMarket[];
  /** Budget left for campaigns without a market in their name. */
  unmappedBudget: number;
}

/**
 * Day weights from last season, normalised to sum 1 over `len` days: a
 * 3-day average (one quiet day must not get no budget), floored at a quarter
 * of the mean so no day is ever planned at zero. No history: an even split.
 */
export function spendCurve(prev: Array<number | null>, len: number): { weights: number[]; source: "prev" | "even" } {
  const raw = Array.from({ length: len }, (_, i) => Math.max(0, Number(prev[i] ?? 0)));
  const sum = raw.reduce((a, b) => a + b, 0);
  if (sum <= 0 || len === 0) return { weights: Array.from({ length: len }, () => (len ? 1 / len : 0)), source: "even" };
  const smooth = raw.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let j = i - 1; j <= i + 1; j++) {
      if (j >= 0 && j < len) {
        s += raw[j];
        n += 1;
      }
    }
    return s / n;
  });
  const mean = smooth.reduce((a, b) => a + b, 0) / len;
  const floored = smooth.map((v) => Math.max(v, mean * 0.25));
  const total = floored.reduce((a, b) => a + b, 0);
  return { weights: floored.map((v) => v / total), source: "prev" };
}

const sumTo = (list: Array<number | null>, to: number) => {
  let s = 0;
  for (let i = 0; i <= Math.min(to, list.length - 1); i++) s += Number(list[i] ?? 0);
  return s;
};

/** What today should take: the remainder spread over the days left along the curve. */
function todayShare(weights: number[], remaining: number, todayIdx: number): number {
  if (todayIdx < 0 || todayIdx >= weights.length || remaining <= 0) return 0;
  let rest = 0;
  for (let i = todayIdx; i < weights.length; i++) rest += weights[i];
  return rest > 0 ? (remaining * weights[todayIdx]) / rest : 0;
}

const weekdayMon0 = (iso: string) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;

export function computeSeasonBudget(input: BudgetInput): SeasonBudget {
  const { total, dates, todayIdx, asOfIdx } = input;
  const len = dates.length;
  const { weights, source } = spendCurve(input.prevSpend, len);
  const cum: number[] = [];
  weights.reduce((acc, w, i) => (cum[i] = acc + w), 0);

  const spentToDate = sumTo(input.spend, asOfIdx);
  const planToDate = asOfIdx >= 0 ? Math.round(total * cum[Math.min(asOfIdx, len - 1)]) : 0;
  const remaining = Math.max(0, total - spentToDate);
  const todayPlan = Math.round(todayShare(weights, remaining, todayIdx));
  const projected =
    asOfIdx >= 0 && cum[Math.min(asOfIdx, len - 1)] > 0
      ? Math.round(spentToDate / cum[Math.min(asOfIdx, len - 1)])
      : null;

  // The remainder re-spread from today on: the daily targets that land on
  // the budget exactly, whatever happened so far.
  const next: SeasonBudget["next"] = [];
  if (todayIdx >= 0 && todayIdx < len && remaining > 0) {
    let rest = 0;
    for (let i = todayIdx; i < len; i++) rest += weights[i];
    for (let i = todayIdx; i < Math.min(len, todayIdx + 7); i++) {
      next.push({ date: dates[i], amount: rest > 0 ? Math.round((remaining * weights[i]) / rest) : 0 });
    }
  }

  let running = 0;
  const cumulative = dates.map((date, i) => {
    if (i <= asOfIdx) running += Number(input.spend[i] ?? 0);
    return { date, plan: Math.round(total * cum[i]), actual: i <= asOfIdx ? running : null };
  });

  // Monday-to-Sunday weeks, clipped to the season.
  const weeks: BudgetWeek[] = [];
  for (let i = 0; i < len; i++) {
    if (i === 0 || weekdayMon0(dates[i]) === 0) {
      weeks.push({ from: dates[i], to: dates[i], plan: 0, actual: null, planSoFar: 0, current: false });
    }
    const w = weeks[weeks.length - 1];
    w.to = dates[i];
    w.plan += total * weights[i];
    if (i <= asOfIdx) {
      w.actual = (w.actual ?? 0) + Number(input.spend[i] ?? 0);
      w.planSoFar += total * weights[i];
    }
    if (i === todayIdx) w.current = true;
  }
  for (const w of weeks) {
    w.plan = Math.round(w.plan);
    w.planSoFar = Math.round(w.planSoFar);
  }

  // Markets: last season's split of the spend that carried a market, each
  // with its own curve (Italy peaks for Befana, not for Wigilia).
  const prevByMarket = input.markets.map((m) => m.prevSpend.reduce((a, b) => a + b, 0));
  const prevMapped = prevByMarket.reduce((a, b) => a + b, 0);
  const curByMarket = input.markets.map((m) => sumTo(m.spend, asOfIdx));
  const curMapped = curByMarket.reduce((a, b) => a + b, 0);
  const useShares = prevMapped > 0 ? prevByMarket : curByMarket;
  const sharesTotal = prevMapped > 0 ? prevMapped : curMapped;
  const mappedFraction =
    prevMapped > 0 ? prevMapped / (prevMapped + Math.max(0, input.prevUnmappedSpend)) : 1;
  const marketBudgetTotal = Math.round(total * mappedFraction);
  const markets: BudgetMarket[] =
    sharesTotal > 0
      ? input.markets
          .map((m, k) => {
            const share = useShares[k] / sharesTotal;
            const budget = Math.round(marketBudgetTotal * share);
            const curve = spendCurve(prevMapped > 0 ? m.prevSpend : [], len).weights;
            let c = 0;
            for (let i = 0; i <= Math.min(asOfIdx, len - 1); i++) c += curve[i];
            const plan = asOfIdx >= 0 ? Math.round(budget * c) : 0;
            const spent = curByMarket[k];
            return {
              code: m.code,
              share,
              budget,
              planToDate: plan,
              spentToDate: spent,
              pace: plan > 0 ? spent / plan : null,
              todayPlan: Math.round(todayShare(curve, Math.max(0, budget - spent), todayIdx)),
            };
          })
          .filter((m) => m.budget > 0 || m.spentToDate > 0)
          .sort((a, b) => b.budget - a.budget)
      : [];

  return {
    total,
    curveSource: source,
    planToDate,
    spentToDate,
    pace: planToDate > 0 ? spentToDate / planToDate : null,
    remaining,
    todaySpend: input.todaySpend,
    todayPlan,
    projected,
    next,
    cumulative,
    weeks,
    markets,
    unmappedBudget: markets.length ? total - marketBudgetTotal : 0,
  };
}
