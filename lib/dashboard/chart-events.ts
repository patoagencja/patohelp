import { addDays, differenceInCalendarDays, format } from "date-fns";

import type { TrendPoint } from "@/lib/dashboard/metrics";
import type { ClientEvent } from "@/lib/dashboard/overview";
import { AD_PROVIDER_LABEL, type AdProvider } from "@/lib/types";

// Pure, isomorphic helpers (no Supabase, no Node APIs): detection runs on the
// server inside getDashboardData, merging/capping runs in the chart component.

export type ChartEventKind =
  | "manual"
  | "start"
  | "stop"
  | "budget_up"
  | "budget_down";

export interface ChartEvent {
  id: string;
  date: string; // yyyy-MM-dd
  kind: ChartEventKind;
  text: string;
  /** Category label for manual events (e.g. "Okres promocji"). */
  tag?: string | null;
  /** Relative importance, only used to decide which events survive the cap. */
  weight: number;
}

/** One chart marker = one day; several same-day events share it. */
export interface ChartMarker {
  date: string;
  number: number;
  events: ChartEvent[];
}

export interface CampaignSpendRow {
  provider: AdProvider;
  campaignId: string;
  campaignName: string | null;
  date: string;
  spendMinorUnits: number;
}

type Lang = "pl" | "en";

// A campaign must be dark this long before a "start" / after a "stop" counts;
// shorter gaps are usually weekend dayparting or a one-day billing hiccup.
const ZERO_RUN_DAYS = 3;
// Small campaigns switching on/off don't explain the account-level curve.
const MIN_SHARE = 0.05;
const TOP_N = 10;
const TOP_N_MIN_SHARE = 0.01;
// Budget change: 3-day average vs the 7 days before it.
const BUDGET_CUR_DAYS = 3;
const BUDGET_BASE_DAYS = 7;
const BUDGET_RATIO = 0.5; // ±50%
// Absolute floors (grosze/day) so a 10 zł -> 20 zł wobble isn't "+100%".
const BUDGET_MIN_BASE = 2_000;
const BUDGET_MIN_DELTA = 3_000;
const BUDGET_COOLDOWN_DAYS = 7;
// Importance is judged on the range plus this many days before it.
const NEAR_DAYS = 7;

/**
 * How many days before the range detection ever looks at: the budget check's
 * baseline (BUDGET_BASE_DAYS before a BUDGET_CUR_DAYS window that starts on
 * the range's first day) reaches furthest; the zero runs (ZERO_RUN_DAYS), a
 * stop's magnitude (the 7 days before it) and the importance window
 * (NEAR_DAYS) stay inside it. Older rows and known days never change the
 * result - except through a campaign's latest name and its first
 * appearance (the tie-break between campaigns of equal importance).
 */
export const EVENT_LOOKBACK_DAYS = BUDGET_CUR_DAYS - 1 + BUDGET_BASE_DAYS;
/** The importance window reaches this many days before the range. */
export const EVENT_NEAR_DAYS = NEAR_DAYS;

/**
 * The campaigns detectCampaignEvents may pick as meaningful, from each
 * campaign's spend over the importance window (the range plus the
 * EVENT_NEAR_DAYS before it - the same sums it ranks by): a share of at least
 * MIN_SHARE, or a place in the top TOP_N, ties at the cut included. Every
 * other campaign can only rank below all of these, so it counts through the
 * window's total alone, never with its own days.
 */
export function eventCandidates(nearSpend: ReadonlyMap<string, number>): Set<string> {
  let total = 0;
  const positive: number[] = [];
  for (const v of nearSpend.values()) {
    total += v;
    if (v > 0) positive.push(v);
  }
  const out = new Set<string>();
  if (total <= 0) return out;
  positive.sort((a, b) => b - a);
  const cut = positive.length > TOP_N ? positive[TOP_N - 1] : 0;
  nearSpend.forEach((v, key) => {
    if (v > 0 && (v >= cut || v / total >= MIN_SHARE)) out.add(key);
  });
  return out;
}

export const MAX_CHART_MARKERS = 8;

const MANUAL_TAG: Record<Lang, Record<string, string>> = {
  pl: {
    campaign_launch: "Start kampanii",
    budget_change: "Zmiana budżetu",
    sale_period: "Okres promocji",
    strategy_change: "Zmiana strategii",
    other: "Inne",
  },
  en: {
    campaign_launch: "Campaign launch",
    budget_change: "Budget change",
    sale_period: "Promotion",
    strategy_change: "Strategy change",
    other: "Other",
  },
};

const toDate = (d: string) => new Date(`${d}T00:00:00`);
const fmt = (d: Date) => format(d, "yyyy-MM-dd");

function describe(
  kind: Exclude<ChartEventKind, "manual">,
  name: string,
  provider: AdProvider,
  pct: number,
  lang: Lang
): string {
  const prov = AD_PROVIDER_LABEL[provider] ?? provider;
  const signed = `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;
  if (lang === "en") {
    if (kind === "start") return `Campaign started: ${name} (${prov})`;
    if (kind === "stop") return `Paused: ${name} (${prov})`;
    if (kind === "budget_up") return `Budget increased: ${name} (${prov}, ${signed})`;
    return `Budget decreased: ${name} (${prov}, ${signed})`;
  }
  if (kind === "start") return `Start kampanii: ${name} (${prov})`;
  if (kind === "stop") return `Wstrzymano: ${name} (${prov})`;
  if (kind === "budget_up") return `Zwiększono budżet: ${name} (${prov}, ${signed})`;
  return `Zmniejszono budżet: ${name} (${prov}, ${signed})`;
}

/**
 * Derive "why did the curve move" annotations from ads_daily rows the
 * dashboard already fetched (previous period + current range), so no extra
 * query or table is needed: campaign starts, pauses and big budget changes.
 *
 * `dataStart` is the first date the rows cover; anything earlier is unknown,
 * not zero. `today` (Europe/Warsaw) is excluded from zero/average windows
 * because its spend is still syncing.
 */
export function detectCampaignEvents({
  rows,
  dataStart,
  rangeStart,
  rangeEnd,
  today,
  knownDates,
  lang = "pl",
}: {
  rows: CampaignSpendRow[];
  dataStart: string;
  rangeStart: string;
  rangeEnd: string;
  today?: string;
  /**
   * Days that have ads_daily rows even where `rows` leaves them out - for
   * callers that pass day-by-day rows only for the campaigns that can matter
   * (eventCandidates) and the rest as totals.
   */
  knownDates?: Iterable<string>;
  lang?: Lang;
}): ChartEvent[] {
  const origin = toDate(dataStart);
  const idx = (d: string) => differenceInCalendarDays(toDate(d), origin);
  const nDays = idx(rangeEnd) + 1;
  const rStart = idx(rangeStart);
  if (nDays <= 0 || rStart < 0 || rStart >= nDays) return [];
  const todayIdx = today ? idx(today) : Number.POSITIVE_INFINITY;

  // A day with no ads_daily rows at all is a sync gap, not every campaign
  // pausing at once - treat it as unknown so it can't fake a stop/start.
  const known = new Array<boolean>(nDays).fill(false);
  if (knownDates) {
    for (const d of knownDates) {
      const i = idx(d);
      if (i >= 0 && i < nDays) known[i] = true;
    }
  }

  interface Camp {
    key: string;
    provider: AdProvider;
    name: string;
    spend: number[];
    nearSpend: number;
  }
  const camps = new Map<string, Camp>();
  let rangeTotal = 0;
  // Importance is judged on the range plus the week before it, so a big
  // campaign paused on day 2 of the range still qualifies for a "stop".
  const nearFrom = rStart - NEAR_DAYS;
  let nearTotal = 0;

  for (const row of rows) {
    const i = idx(row.date);
    if (i < 0 || i >= nDays) continue;
    known[i] = true;
    const key = `${row.provider}:${row.campaignId}`;
    let c = camps.get(key);
    if (!c) {
      c = {
        key,
        provider: row.provider,
        name: row.campaignName || row.campaignId,
        spend: new Array<number>(nDays).fill(0),
        nearSpend: 0,
      };
      camps.set(key, c);
    }
    if (row.campaignName) c.name = row.campaignName; // latest name wins
    c.spend[i] += row.spendMinorUnits;
    if (i >= rStart) rangeTotal += row.spendMinorUnits;
    if (i >= nearFrom) {
      c.nearSpend += row.spendMinorUnits;
      nearTotal += row.spendMinorUnits;
    }
  }
  if (rangeTotal <= 0 || nearTotal <= 0) return [];

  const rangeDays = Math.min(nDays, todayIdx + 1) - rStart;
  const accountDaily = rangeTotal / Math.max(1, rangeDays);

  const ranked = Array.from(camps.values())
    .filter((c) => c.nearSpend > 0)
    .sort((a, b) => b.nearSpend - a.nearSpend);
  const meaningful = ranked.filter((c, k) => {
    const share = c.nearSpend / nearTotal;
    return share >= MIN_SHARE || (k < TOP_N && share >= TOP_N_MIN_SHARE);
  });

  const usable = (i: number) => i >= 0 && i < nDays && i < todayIdx && known[i];
  const mean = (arr: number[], from: number, to: number) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, from); j <= Math.min(to, nDays - 1); j++) {
      if (!usable(j)) continue;
      sum += arr[j];
      n++;
    }
    return n > 0 ? sum / n : 0;
  };

  const out: ChartEvent[] = [];
  const dateOf = (i: number) => fmt(addDays(origin, i));

  for (const c of meaningful) {
    const s = c.spend;
    const isZero = (i: number) => usable(i) && s[i] === 0;
    const zeroRun = (from: number) => {
      for (let k = 0; k < ZERO_RUN_DAYS; k++) if (!isZero(from + k)) return false;
      return true;
    };

    for (let i = rStart; i < nDays; i++) {
      // Start: spend today after a dark stretch.
      if (s[i] > 0 && zeroRun(i - ZERO_RUN_DAYS)) {
        const mag = mean(s, i, i + 6) / accountDaily;
        out.push({
          id: `auto:start:${c.key}:${i}`,
          date: dateOf(i),
          kind: "start",
          text: describe("start", c.name, c.provider, 0, lang),
          weight: 0.2 + mag,
        });
      }
      // Stop: marked on the first dark day - that's where the curve drops.
      if (i >= 1 && s[i - 1] > 0 && zeroRun(i)) {
        const mag = mean(s, i - 7, i - 1) / accountDaily;
        out.push({
          id: `auto:stop:${c.key}:${i}`,
          date: dateOf(i),
          kind: "stop",
          text: describe("stop", c.name, c.provider, 0, lang),
          weight: 0.2 + mag,
        });
      }
    }

    // Budget changes: running campaign whose recent average moved ≥50%.
    let cooldownUntil = -1;
    for (let i = rStart; i < nDays; i++) {
      if (i <= cooldownUntil) continue;
      const curFrom = i - BUDGET_CUR_DAYS + 1;
      const baseFrom = curFrom - BUDGET_BASE_DAYS;
      if (baseFrom < 0) continue;

      let ok = true;
      for (let j = curFrom; j <= i; j++) {
        // Every recent day must have spend, otherwise it's a pause, not a cut.
        if (!usable(j) || s[j] <= 0) ok = false;
      }
      if (!ok) continue;
      let baseActive = 0;
      for (let j = baseFrom; j < curFrom; j++) if (usable(j) && s[j] > 0) baseActive++;
      // A mostly-dark baseline means a fresh start, already covered above.
      if (baseActive < BUDGET_BASE_DAYS - 2) continue;

      const base = mean(s, baseFrom, curFrom - 1);
      const cur = mean(s, curFrom, i);
      if (base < BUDGET_MIN_BASE) continue;
      const ratio = cur / base;
      const up = ratio >= 1 + BUDGET_RATIO && cur - base >= BUDGET_MIN_DELTA;
      const down = ratio <= 1 - BUDGET_RATIO && base - cur >= BUDGET_MIN_DELTA;
      if (!up && !down) continue;

      // The 3-day average crosses the threshold a day or two after the actual
      // change; back-date to the first day that already moved noticeably.
      let at = curFrom;
      for (let j = curFrom; j <= i; j++) {
        const r = s[j] / base;
        if (up ? r >= 1.25 : r <= 0.75) {
          at = j;
          break;
        }
      }
      cooldownUntil = i + BUDGET_COOLDOWN_DAYS;
      if (at < rStart) continue;

      // Report the size of the change from its start, not the blended 3-day
      // average that only crossed the threshold.
      const post = mean(s, at, at + BUDGET_CUR_DAYS - 1) || cur;
      const pct = Math.round((post / base - 1) * 100);
      const kind = up ? "budget_up" : "budget_down";
      out.push({
        id: `auto:${kind}:${c.key}:${at}`,
        date: dateOf(at),
        kind,
        text: describe(kind, c.name, c.provider, pct, lang),
        weight: Math.abs(cur - base) / accountDaily,
      });
    }
  }

  return out;
}

/**
 * Merge manual client_events with auto-detected ones into at most `max`
 * day-markers (most important days win), numbered left-to-right.
 */
export function buildChartMarkers({
  manual,
  auto,
  rangeStart,
  rangeEnd,
  max = MAX_CHART_MARKERS,
  lang = "pl",
}: {
  manual: ClientEvent[];
  auto: ChartEvent[];
  rangeStart: string;
  rangeEnd: string;
  max?: number;
  lang?: Lang;
}): ChartMarker[] {
  const all: ChartEvent[] = [
    // Someone typed these in on purpose - they always outrank heuristics.
    ...manual.map((e) => ({
      id: `manual:${e.id}`,
      date: e.eventDate,
      kind: "manual" as const,
      text: e.title,
      tag: e.eventType ? MANUAL_TAG[lang][e.eventType] ?? e.eventType : null,
      weight: 1_000,
    })),
    ...auto,
  ].filter((e) => e.date >= rangeStart && e.date <= rangeEnd);

  const byDate = new Map<string, ChartEvent[]>();
  for (const e of all) {
    const list = byDate.get(e.date) ?? [];
    if (!list.some((x) => x.text === e.text)) list.push(e);
    byDate.set(e.date, list);
  }

  return Array.from(byDate.entries())
    .map(([date, events]) => {
      events.sort((a, b) => b.weight - a.weight);
      return { date, events, weight: events[0]?.weight ?? 0 };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, max)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((m, i) => ({ date: m.date, number: i + 1, events: m.events }));
}

/**
 * Plausible previous-period trend + annotations for the public demo pages,
 * shaped to agree with the demo KPI deltas (lib/demo/data.ts).
 */
export function buildDemoChartExtras(
  trend: TrendPoint[],
  lang: Lang = "pl"
): { prevTrend: TrendPoint[]; autoEvents: ChartEvent[] } {
  const n = trend.length;
  const first = trend[0]?.date;
  if (!first) return { prevTrend: [], autoEvents: [] };
  const prevStart = addDays(toDate(first), -n);

  // Deterministic wobble so the dashed line doesn't look like a scaled copy.
  const wobble = (i: number) => 1 + 0.08 * Math.sin(i * 1.7) + 0.05 * Math.cos(i * 0.6);
  // Older period ran flatter (no upward drift), hence the index ramp.
  const shape = trend.map((_, i) => wobble(i) * (1 - (i / Math.max(1, n - 1)) * 0.12));
  const shapeSum = shape.reduce((a, v) => a + v, 0) || 1;
  // Each series totals exactly `ratio` x the current total - the same ratios
  // the demo KPI tiles use as "previous" (lib/demo/data.ts) - so the chart's
  // "o X% więcej niż wcześniej" can't contradict the tile above it.
  const series = (pick: (p: TrendPoint) => number, ratio: number) => {
    const total = trend.reduce((a, p) => a + pick(p), 0) * ratio;
    return shape.map((s) => Math.round((total * s) / shapeSum));
  };
  const spend = series((p) => p.spendMinorUnits, 0.9);
  const sessions = series((p) => p.sessions, 0.83);
  const clicks = series((p) => p.clicks, 0.86);
  const impressions = series((p) => p.impressions, 0.95);
  const conversions = series((p) => p.conversions, 0.88);
  const prevTrend: TrendPoint[] = trend.map((_, i) => ({
    date: fmt(addDays(prevStart, i)),
    spendMinorUnits: spend[i],
    sessions: sessions[i],
    clicks: clicks[i],
    impressions: impressions[i],
    conversions: conversions[i],
    revenueMinorUnits: 0,
    transactions: 0,
  }));

  const at = (frac: number) => trend[Math.min(n - 1, Math.round((n - 1) * frac))].date;
  const en = lang === "en";
  const autoEvents: ChartEvent[] = [
    {
      id: "demo:start",
      date: at(0.25),
      kind: "start",
      text: describe("start", en ? "PMAX | Veg shop" : "PMAX | Sklep z warzywami", "google_ads", 0, lang),
      weight: 1,
    },
    {
      id: "demo:up",
      date: at(0.55),
      kind: "budget_up",
      text: describe(
        "budget_up",
        en ? "SALES | Veg boxes" : "SPRZEDAŻ | Skrzynki warzyw",
        "meta_ads",
        60,
        lang
      ),
      weight: 0.8,
    },
    {
      id: "demo:stop",
      date: at(0.8),
      kind: "stop",
      text: describe(
        "stop",
        en ? "REMARKETING | Summer" : "REMARKETING | Lato",
        "meta_ads",
        0,
        lang
      ),
      weight: 0.6,
    },
  ];
  return { prevTrend, autoEvents };
}
