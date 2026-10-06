"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { differenceInCalendarDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { LineChart } from "lucide-react";

import {
  buildChartMarkers,
  buildDemoChartExtras,
  type ChartEvent,
  type ChartMarker,
} from "@/lib/dashboard/chart-events";
import type { TrendPoint } from "@/lib/dashboard/metrics";
import type { ClientEvent } from "@/lib/dashboard/overview";
import type { EngagementYoY, YoYPoint } from "@/lib/dashboard/yoy";
import { Card } from "@/components/ui/card";
import { SegmentedTrack, segmentedItem } from "@/components/ui/segmented";
import { cn, formatMoneyPLN, formatNumberPL, formatPlnWhole } from "@/lib/utils";

/** Metrics the chart can draw. The picker only offers the first four; the
 *  rest (ratios, shop metrics) are reachable when the parent selects the
 *  metric from outside, e.g. the overview's KPI tiles. */
export type ChartMetric =
  | "spend"
  | "sessions"
  | "clicks"
  | "conversions"
  | "cpc"
  | "impressions"
  | "revenue"
  | "orders"
  | "roas";
type MetricKey = ChartMetric;
type Lang = "pl" | "en";
type CompareMode = "prev" | "yoy" | "none";

const METRIC_KEYS: MetricKey[] = ["spend", "sessions", "clicks", "conversions"];
// Drawn and summed in złoty (valueOf divides minor units by 100).
const MONEY_METRICS: ReadonlySet<MetricKey> = new Set(["spend", "cpc", "revenue", "roas"]);
// Metrics where "more" is good news (tooltip diff green), less is good
// (cost per click) or neither (spend is a decision: neutral grey).
const BETTER: Record<MetricKey, 1 | -1 | 0> = {
  spend: 0,
  sessions: 1,
  clicks: 1,
  conversions: 1,
  impressions: 1,
  revenue: 1,
  orders: 1,
  roas: 1,
  cpc: -1,
};
// Additive daily metrics can be projected; ratios can't (avg of CPCs lies).
const FORECASTABLE: ReadonlySet<MetricKey> = new Set([
  "spend",
  "sessions",
  "clicks",
  "conversions",
  "impressions",
  "revenue",
  "orders",
]);
const FORECAST_DAYS = 7;
const EASE = "cubic-bezier(.2,.8,.2,1)";
// Stable fallbacks so memoised marker building doesn't rerun every render.
const NO_POINTS: TrendPoint[] = [];
const NO_EVENTS: ChartEvent[] = [];
const NO_YOY: YoYPoint[] = [];

const COPY = {
  pl: {
    tab: { spend: "Wydatki", sessions: "Wizyty na stronie", clicks: "Kliknięcia", conversions: "Działania", cpc: "Koszt kliknięcia", impressions: "Wyświetlenia", revenue: "Sprzedaż", orders: "Zamówienia", roas: "Zwrot z reklam" },
    long: { spend: "Wydatki", sessions: "Wizyty na stronie", clicks: "Kliknięcia", conversions: "Działania na stronie", cpc: "Koszt kliknięcia", impressions: "Wyświetlenia reklam", revenue: "Sprzedaż w sklepie", orders: "Zamówienia", roas: "Zwrot z reklam" },
    current: "Ten okres",
    previous: "Poprzedni okres",
    yearAgo: "Rok wcześniej",
    compareWith: "Porównaj z:",
    compareOpts: { prev: "poprzednim okresem", yoy: "rokiem wcześniej", none: "bez porównania" },
    yoyPhrase: "rok temu",
    thinYoy: "rok temu było za mało danych, by porównać",
    noData: "brak danych",
    partial: "dzisiaj - dane niepełne",
    partialShort: "dzisiaj, dane niepełne",
    whatHappened: "Co się działo",
    showMore: (n: number) => `Pokaż więcej (${n})`,
    showLess: "Pokaż mniej",
    noPrev: "brak danych z poprzedniego okresu do porównania",
    prevDays: (n: number) => (n === 1 ? "w poprzednim dniu" : `w poprzednich ${n} dniach`),
    prevSpan: (a: string, b: string) => `w okresie ${a}–${b}`,
    delta: (abs: number, up: boolean, phrase: string) =>
      `o ${abs}% ${up ? "więcej" : "mniej"} niż ${phrase}`,
    same: (phrase: string) => `tyle samo co ${phrase}`,
    weekdays: ["niedz.", "pon.", "wt.", "śr.", "czw.", "pt.", "sob."],
    chartAria: "Wykres dzienny",
    thinPrev: "za mało danych do porównania - wróć za kilka dni",
    collectingSince: (d: string) =>
      `Dane zbieramy od ${d} - wykres wypełni się w kolejnych dniach.`,
    empty: {
      spend: "Wydatki pojawią się po pierwszej synchronizacji kont reklamowych.",
      clicks: "Kliknięcia pojawią się po pierwszej synchronizacji kont reklamowych.",
      sessions: "Dane z Google Analytics pojawią się po pierwszej synchronizacji.",
      conversions: "W tym okresie nie zarejestrowano działań na stronie.",
      cpc: "Koszt kliknięcia pojawi się po pierwszych kliknięciach w reklamy.",
      impressions: "Wyświetlenia pojawią się po pierwszej synchronizacji kont reklamowych.",
      revenue: "Sprzedaż pojawi się po pierwszej synchronizacji Google Analytics.",
      orders: "Zamówienia pojawią się po pierwszej synchronizacji Google Analytics.",
      roas: "Zwrot z reklam pojawi się, gdy będą i wydatki, i sprzedaż.",
    },
    emptyTail: "brak danych w tym okresie",
    dayByDay: "dzień po dniu",
    forecast: "Prognoza · 7 dni",
    forecastKick: "+ prognoza",
    forecastTip: (pm: number) => `prognoza · ±${pm}%`,
    forecastDay: "PROGNOZA",
    forecastNote: (v: string) => `Prognoza (średnia z 7 dni + trend): ok. ${v} dziennie.`,
    today: "DZIŚ",
    vs: (d: number, phrase: string) => `${d > 0 ? "+" : ""}${d}% vs ${phrase}`,
    vsPrev: "poprzedni okres",
    vsYoy: "rok temu",
    monthsShort: ["STY", "LUT", "MAR", "KWI", "MAJ", "CZE", "LIP", "SIE", "WRZ", "PAŹ", "LIS", "GRU"],
    eventAt: (d: string, txt: string) => `Zdarzenie ${d}: ${txt}`,
  },
  en: {
    tab: { spend: "Spend", sessions: "Sessions", clicks: "Clicks", conversions: "Conversions", cpc: "Cost per click", impressions: "Impressions", revenue: "Revenue", orders: "Orders", roas: "Return on ad spend" },
    long: { spend: "Spend", sessions: "Sessions", clicks: "Clicks", conversions: "Conversions", cpc: "Cost per click", impressions: "Ad impressions", revenue: "Revenue", orders: "Orders", roas: "Return on ad spend" },
    current: "This period",
    previous: "Previous period",
    yearAgo: "A year earlier",
    compareWith: "Compare with:",
    compareOpts: { prev: "previous period", yoy: "a year earlier", none: "no comparison" },
    yoyPhrase: "a year ago",
    thinYoy: "too little data a year ago to compare",
    noData: "no data",
    partial: "today - incomplete data",
    partialShort: "today, incomplete",
    whatHappened: "What happened",
    showMore: (n: number) => `Show more (${n})`,
    showLess: "Show less",
    noPrev: "no previous-period data to compare",
    prevDays: (n: number) => (n === 1 ? "the previous day" : `the previous ${n} days`),
    prevSpan: (a: string, b: string) => `${a}–${b}`,
    delta: (abs: number, up: boolean, phrase: string) =>
      `${abs}% ${up ? "higher" : "lower"} than ${phrase}`,
    same: (phrase: string) => `about the same as ${phrase}`,
    weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    chartAria: "Daily chart",
    thinPrev: "not enough data to compare yet - check back in a few days",
    collectingSince: (d: string) =>
      `Data collected since ${d} - the chart fills in over the next days.`,
    empty: {
      spend: "Spend appears after the first ad account sync.",
      clicks: "Clicks appear after the first ad account sync.",
      sessions: "Google Analytics data appears after the first sync.",
      conversions: "No key actions were recorded in this period.",
      cpc: "Cost per click appears after the first ad clicks.",
      impressions: "Impressions appear after the first ad account sync.",
      revenue: "Revenue appears after the first Google Analytics sync.",
      orders: "Orders appear after the first Google Analytics sync.",
      roas: "Return on ad spend appears once there is both spend and revenue.",
    },
    emptyTail: "no data in this period",
    dayByDay: "day by day",
    forecast: "Forecast · 7 days",
    forecastKick: "+ forecast",
    forecastTip: (pm: number) => `forecast · ±${pm}%`,
    forecastDay: "FORECAST",
    forecastNote: (v: string) => `Forecast (7-day average + trend): about ${v} a day.`,
    today: "TODAY",
    vs: (d: number, phrase: string) => `${d > 0 ? "+" : ""}${d}% vs ${phrase}`,
    vsPrev: "previous period",
    vsYoy: "a year ago",
    monthsShort: ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"],
    eventAt: (d: string, txt: string) => `Event ${d}: ${txt}`,
  },
} as const;

// Previous-period totals below these make a % change noise (+400% on 6
// clicks). Spend is in złoty here (valueOf divides by 100).
const MIN_PREV_TOTAL: Record<MetricKey, number> = {
  spend: 100,
  sessions: 50,
  clicks: 50,
  conversions: 10,
  impressions: 1_000,
  revenue: 100,
  orders: 10,
  // Ratios are judged on their base instead (see baseTotal).
  cpc: 50,
  roas: 100,
};

const hasAnyData = (p: TrendPoint) =>
  p.spendMinorUnits > 0 || p.sessions > 0 || p.clicks > 0 || p.impressions > 0;

function valueOf(p: TrendPoint, metric: MetricKey): number {
  switch (metric) {
    case "spend":
      return p.spendMinorUnits / 100;
    case "sessions":
      return p.sessions;
    case "clicks":
      return p.clicks;
    case "impressions":
      return p.impressions;
    case "revenue":
      return p.revenueMinorUnits / 100;
    case "orders":
      return p.transactions;
    case "cpc":
      return p.clicks > 0 ? p.spendMinorUnits / 100 / p.clicks : 0;
    case "roas":
      return p.spendMinorUnits > 0 ? p.revenueMinorUnits / p.spendMinorUnits : 0;
    default:
      return p.conversions;
  }
}

/**
 * Period total on the same basis as the KPI tiles: ratios are the ratio of
 * the sums (a 30-day CPC is not the sum of 30 daily CPCs).
 */
function totalOf(points: TrendPoint[], metric: MetricKey): number {
  if (metric === "cpc" || metric === "roas") {
    let spend = 0;
    let clicks = 0;
    let revenue = 0;
    for (const p of points) {
      spend += p.spendMinorUnits;
      clicks += p.clicks;
      revenue += p.revenueMinorUnits;
    }
    if (metric === "cpc") return clicks > 0 ? spend / 100 / clicks : 0;
    return spend > 0 ? revenue / spend : 0;
  }
  return points.reduce((a, p) => a + valueOf(p, metric), 0);
}

/** What the thin-base check looks at: ratios swing on their denominator. */
function baseTotal(points: TrendPoint[], metric: MetricKey): number {
  if (metric === "cpc") return totalOf(points, "clicks");
  if (metric === "roas") return totalOf(points, "spend");
  return totalOf(points, metric);
}

/** Same as valueOf for last year's points; null = nothing synced that day. */
function yoyValueOf(p: YoYPoint, metric: MetricKey): number | null {
  switch (metric) {
    case "spend":
      return p.spendMinorUnits === null ? null : p.spendMinorUnits / 100;
    case "sessions":
      return p.sessions;
    case "clicks":
      return p.clicks;
    case "impressions":
      return p.impressions;
    case "conversions":
      return p.conversions;
    case "cpc":
      return p.spendMinorUnits !== null && p.clicks ? p.spendMinorUnits / 100 / p.clicks : null;
    default:
      // Last year's shop numbers aren't part of the engagement YoY read.
      return null;
  }
}

function yoyTotalOf(points: YoYPoint[], metric: MetricKey): number {
  if (metric === "cpc") {
    let spend = 0;
    let clicks = 0;
    for (const p of points) {
      if (p.spendMinorUnits === null || p.clicks === null) continue;
      spend += p.spendMinorUnits;
      clicks += p.clicks;
    }
    return clicks > 0 ? spend / 100 / clicks : 0;
  }
  return points.reduce<number>((a, p) => a + (yoyValueOf(p, metric) ?? 0), 0);
}

const ddmm = (date: string) => {
  const [, m, d] = date.split("-");
  return `${d}.${m}`;
};

// Compact axis labels so wide amounts ("140 000,00 zł") don't get clipped.
function compact(v: number, money: boolean): string {
  const unit = money ? " zł" : "";
  const abs = Math.abs(v);
  // Cost per click and return on ads live around 0-10 zł: "1 zł" on every
  // gridline would hide the whole story.
  if (abs < 10 && v !== Math.round(v))
    return `${v.toLocaleString("pl-PL", { maximumFractionDigits: 2 })}${unit}`;
  if (abs >= 1_000_000)
    return `${(v / 1_000_000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} mln${unit}`;
  if (abs >= 1_000)
    return `${(v / 1_000).toLocaleString("pl-PL", { maximumFractionDigits: abs >= 10_000 ? 0 : 1 })} tys.${unit}`;
  return `${Math.round(v)}${unit}`;
}

function full(v: number, money: boolean, lang: Lang): string {
  // Polish goes through the shared formatters: Intl pl-PL leaves 4-digit
  // numbers ungrouped, so the takeaway read "Kliknięcia: 9868" while the KPI
  // card above showed "9 868" for the same total.
  if (lang === "pl") {
    if (!money) return formatNumberPL(v);
    return Math.abs(v) < 100 ? formatMoneyPLN(v * 100) : formatPlnWhole(v * 100);
  }
  const locale = "en-GB";
  if (money)
    return v.toLocaleString(locale, {
      style: "currency",
      currency: "PLN",
      maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0,
    });
  return Math.round(v).toLocaleString(locale);
}

// "Nice" y-axis step (1/2/2.5/5 × 10^n) so gridlines land on round numbers.
function niceScale(max: number, ticks = 4): { max: number; step: number } {
  if (!(max > 0)) return { max: 1, step: 0.25 };
  const raw = max / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  return { max: Math.ceil(max / step) * step, step };
}

export function MainChart({
  trend: rawTrend,
  prevTrend,
  events,
  autoEvents,
  yoy,
  label,
  lang = "pl",
  demo = false,
  metric: metricProp,
  hidePicker = false,
  hideCompare = false,
  forecast: forecastProp = false,
  className,
}: {
  trend: TrendPoint[];
  /** Comparison period, aligned to `trend` by day index. */
  prevTrend?: TrendPoint[];
  /** Manual annotations (client_events). */
  events: ClientEvent[];
  /** Auto-detected campaign starts/pauses/budget changes. */
  autoEvents?: ChartEvent[];
  /** Same window 364 days earlier (getEngagementYoY); null hides that option. */
  yoy?: EngagementYoY | null;
  label?: string;
  lang?: Lang;
  /** Public demo pages: synthesize comparison + annotations from `trend`. */
  demo?: boolean;
  /**
   * Controlled metric: the parent picks what is drawn (the overview's KPI
   * tiles act as the chart's tabs). Omit to use the built-in picker.
   */
  metric?: ChartMetric;
  /** Hide the built-in metric buttons (use with `metric`). */
  hidePicker?: boolean;
  /** Hide "Porównaj z:" - the chart then always shows the previous period. */
  hideCompare?: boolean;
  /**
   * 7-day projection after the last day (dotted line + band + hatched
   * future zone): the last 7 complete days' average plus their trend vs the
   * 7 before. Plain arithmetic, no model; only for additive metrics, ranges
   * that end today/yesterday and with 14+ days of data.
   */
  forecast?: boolean;
  className?: string;
}) {
  const t = COPY[lang];
  // Open on a tab that has something to show: a GA4-only client (no ads
  // connected yet) shouldn't land on an empty "Wydatki" chart.
  const [ownMetric, setMetric] = useState<MetricKey>(() =>
    rawTrend.some((p) => p.spendMinorUnits > 0) ||
    !rawTrend.some((p) => p.sessions > 0)
      ? "spend"
      : "sessions"
  );
  const metric: MetricKey = metricProp ?? ownMetric;
  const [compare, setCompare] = useState<CompareMode>("prev");
  const [active, setActive] = useState<number | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const width = size.w;
  // Resolved after mount: server and browser can disagree around midnight,
  // and the SVG only renders client-side anyway (it needs a measured width).
  const [today, setToday] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const gradId = useId();
  const bandId = useId();

  useEffect(() => {
    setToday(formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd"));
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (s.w === r.width && s.h === r.height ? s : { w: r.width, h: r.height }));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const demoExtras = useMemo(
    () => (demo ? buildDemoChartExtras(rawTrend, lang) : null),
    [demo, rawTrend, lang]
  );
  const prevRaw = prevTrend ?? demoExtras?.prevTrend ?? NO_POINTS;
  // A brand-new client has a 30-day axis with 27 empty days and a spike at
  // the end - which reads as explosive growth. With no history to compare
  // against, start the axis on the first day that has any data instead.
  const prevHasData = prevRaw.some(hasAnyData);
  const firstDataIdx = rawTrend.findIndex(hasAnyData);
  const trimFrom = !prevHasData && firstDataIdx > 0 ? firstDataIdx : 0;
  const trend = useMemo(
    () => (trimFrom > 0 ? rawTrend.slice(trimFrom) : rawTrend),
    [rawTrend, trimFrom]
  );
  const prev = prevRaw;
  const auto = autoEvents ?? demoExtras?.autoEvents ?? NO_EVENTS;

  const n = trend.length;
  const rangeStart = trend[0]?.date ?? "";
  const rangeEnd = trend[n - 1]?.date ?? "";

  const markers = useMemo<ChartMarker[]>(
    () =>
      n === 0
        ? []
        : buildChartMarkers({ manual: events, auto, rangeStart, rangeEnd, lang }),
    [events, auto, rangeStart, rangeEnd, lang, n]
  );
  const markerByIndex = useMemo(() => {
    const map = new Map<number, ChartMarker>();
    for (const m of markers) {
      const i = trend.findIndex((p) => p.date === m.date);
      if (i >= 0) map.set(i, m);
    }
    return map;
  }, [markers, trend]);

  const isMoney = MONEY_METRICS.has(metric);
  const cur = trend.map((p) => valueOf(p, metric));
  const prv = prev.slice(0, n).map((p) => valueOf(p, metric));
  // --- Takeaway line (full-period totals, same basis as the KPI cards) ---
  const total = totalOf(trend, metric);
  const prevTotal = totalOf(prev, metric);
  // A zero-filled comparison period is no comparison: no dashed line at 0,
  // no toggle for it.
  const hasPrev = prev.length > 0 && prevTotal > 0;
  // Last year: kept aligned with the (possibly trimmed) axis. Ads metrics and
  // sessions pass the 80% coverage rule separately, so availability is per tab.
  const yoyPts = useMemo(
    () => (trimFrom > 0 ? (yoy?.series ?? NO_YOY).slice(trimFrom) : (yoy?.series ?? NO_YOY)),
    [yoy, trimFrom]
  );
  const yoyCovered =
    yoy != null &&
    metric !== "revenue" &&
    metric !== "orders" &&
    metric !== "roas" &&
    (metric === "sessions" ? yoy.sessions !== null : yoy.spendMinorUnits !== null);
  const yoyVals = yoyPts.slice(0, n).map((p) => yoyValueOf(p, metric));
  const yoyTotal = yoyTotalOf(yoyPts.slice(0, n), metric);
  const hasYoy = yoyCovered && yoyTotal > 0;
  // A "year earlier" choice made on another tab falls back to the default
  // here rather than silently showing nothing.
  const mode: CompareMode = hideCompare
    ? "prev"
    : compare === "yoy" && !hasYoy
      ? "prev"
      : compare;
  const showPrev = mode === "prev" && hasPrev;
  const showYoy = mode === "yoy";
  const cmp: (number | null)[] = showPrev ? prv : showYoy ? yoyVals : [];
  const cmpLabel = showYoy ? t.yearAgo : t.previous;
  const compareModes: CompareMode[] = hasYoy ? ["prev", "yoy", "none"] : ["prev", "none"];
  const partialIdx = today && trend[n - 1]?.date === today ? n - 1 : -1;
  const isEmpty = n === 0 || total <= 0;
  // % vs a baseline as per-day rates over finished days, the same basis as
  // the KPI tiles (metrics.ts kpiRate): today's partial day read as a drop
  // every morning, and a 28-day February "lost" to a 31-day January.
  const doneTrend = partialIdx >= 0 ? trend.slice(0, partialIdx) : trend;
  const pctVs = (baseTotalV: number, baseDays: number): number | null => {
    if (doneTrend.length === 0 || baseDays <= 0 || baseTotalV <= 0) return null;
    const doneTotal = totalOf(doneTrend, metric);
    if (metric === "cpc" || metric === "roas") return ((doneTotal - baseTotalV) / baseTotalV) * 100;
    return ((doneTotal / doneTrend.length) / (baseTotalV / baseDays) - 1) * 100;
  };
  const prevPhrase = (() => {
    if (!hasPrev) return "";
    const contiguous =
      prev.length === n &&
      differenceInCalendarDays(
        new Date(`${rangeStart}T00:00:00`),
        new Date(`${prev[prev.length - 1].date}T00:00:00`)
      ) === 1;
    return contiguous
      ? t.prevDays(n)
      : t.prevSpan(ddmm(prev[0].date), ddmm(prev[prev.length - 1].date));
  })();
  let takeawayTail: string;
  if (isEmpty) {
    takeawayTail = t.emptyTail;
  } else if (mode === "none") {
    takeawayTail = "";
  } else if (mode === "yoy") {
    const yoyBase =
      metric === "cpc" ? yoyTotalOf(yoyPts.slice(0, n), "clicks") : yoyTotal;
    if (yoyBase < MIN_PREV_TOTAL[metric]) {
      takeawayTail = t.thinYoy;
    } else {
      const pct = pctVs(yoyTotal, Math.min(n, yoyPts.length));
      const abs = pct === null ? 0 : Math.round(Math.abs(pct));
      takeawayTail =
        pct === null ? t.thinYoy : abs < 1 ? t.same(t.yoyPhrase) : t.delta(abs, pct > 0, t.yoyPhrase);
    }
  } else if (!hasPrev) {
    takeawayTail = t.noPrev;
  } else if (baseTotal(prev, metric) < MIN_PREV_TOTAL[metric]) {
    takeawayTail = t.thinPrev;
  } else {
    const pct = pctVs(prevTotal, prev.length);
    const abs = pct === null ? 0 : Math.round(Math.abs(pct));
    takeawayTail =
      pct === null ? t.thinPrev : abs < 1 ? t.same(prevPhrase) : t.delta(abs, pct > 0, prevPhrase);
  }

  // --- Forecast (7 days, arithmetic) ---
  // Today's point is incomplete: project from the last complete day.
  const solidTo = partialIdx > 0 ? n - 2 : n - 1;
  const lastIsRecent =
    !!today &&
    n > 0 &&
    differenceInCalendarDays(new Date(`${today}T00:00:00`), new Date(`${rangeEnd}T00:00:00`)) <= 1;
  const fc = useMemo(() => {
    if (!forecastProp || !lastIsRecent || !FORECASTABLE.has(metric) || solidTo < 13 || isEmpty)
      return null;
    const avg = (from: number, to: number) => {
      let sum = 0;
      for (let i = from; i <= to; i++) sum += cur[i];
      return sum / (to - from + 1);
    };
    const last7 = avg(solidTo - 6, solidTo);
    const prev7 = avg(solidTo - 13, solidTo - 7);
    // Half the weekly drift per day: a gentle trend, not an extrapolated spike.
    const slope = ((last7 - prev7) / 7) * 0.5;
    const days = n - 1 - solidTo + FORECAST_DAYS;
    const vals = Array.from({ length: days }, (_, k) => Math.max(0, last7 + slope * (k + 1)));
    return { vals, from: solidTo, avg: vals.reduce((a, v) => a + v, 0) / vals.length };
    // cur is derived from trend + metric.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forecastProp, lastIsRecent, metric, solidTo, isEmpty, trend]);
  const N = fc ? fc.from + 1 + fc.vals.length : n;
  const fcAt = (i: number) => (fc && i > fc.from ? fc.vals[i - fc.from - 1] : null);
  const bandPm = (i: number) => (fc ? 0.03 + 0.012 * (i - fc.from) : 0);

  // --- Geometry ---
  const compactW = width > 0 && width < 480;
  // Height comes from CSS (h-64 / sm:h-[300px]) so the SSR placeholder doesn't jump.
  const H = size.h || 300;
  const fcMax = fc ? Math.max(...fc.vals.map((v, k) => v * (1 + bandPm(fc.from + 1 + k)))) : 0;
  const yMaxRaw = Math.max(0, ...cur, ...cmp.map((v) => v ?? 0), fcMax);
  const { max: yMax, step: yStep } = niceScale(yMaxRaw);
  const yTicks: number[] = [];
  for (let v = 0; v <= yMax + yStep / 2; v += yStep) yTicks.push(v);
  const yLabelW = Math.max(
    28,
    ...yTicks.map((v) => compact(v, isMoney).length * (compactW ? 6.4 : 7))
  );
  const showToday = partialIdx >= 0 || !!fc;
  // Where "today" sits on the axis: the partial last day, or the first
  // forecast day when the range ends yesterday.
  const todayIdx =
    partialIdx >= 0
      ? partialIdx
      : today && rangeEnd
        ? Math.min(N - 1, n - 1 + differenceInCalendarDays(new Date(`${today}T00:00:00`), new Date(`${rangeEnd}T00:00:00`)))
        : n - 1;
  const pad = { left: yLabelW + 10, right: 8, top: showToday ? 26 : 10, bottom: 28 };
  const plotW = Math.max(1, width - pad.left - pad.right);
  const plotH = H - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (N <= 1 ? plotW / 2 : (i * plotW) / (N - 1));
  const y = (v: number) => pad.top + plotH - (v / yMax) * plotH;
  const stepX = N <= 1 ? plotW : plotW / (N - 1);

  const linePath = (vals: number[], from = 0, to = vals.length - 1) =>
    vals
      .slice(from, to + 1)
      .map((v, k) => `${k === 0 ? "M" : "L"}${x(from + k).toFixed(1)},${y(v).toFixed(1)}`)
      .join("");
  // Comparison line: last year can have unsynced days - leave a gap there
  // instead of diving to zero, which would read as a real collapse.
  const gapPath = (vals: (number | null)[]) => {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const areaPath =
    n > 0
      ? `${linePath(cur, 0, solidTo)}L${x(solidTo).toFixed(1)},${(pad.top + plotH).toFixed(1)}L${x(0).toFixed(1)},${(pad.top + plotH).toFixed(1)}Z`
      : "";
  const fcLine = fc
    ? `M${x(fc.from).toFixed(1)},${y(cur[fc.from]).toFixed(1)}` +
      fc.vals.map((v, k) => `L${x(fc.from + 1 + k).toFixed(1)},${y(v).toFixed(1)}`).join("")
    : "";
  const fcBand = fc
    ? (() => {
        const idx = fc.vals.map((_, k) => fc.from + 1 + k);
        const up = idx.map((i, k) => `${k === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(fc.vals[k] * (1 + bandPm(i))).toFixed(1)}`);
        const lo = idx
          .map((i, k) => `L${x(i).toFixed(1)},${y(fc.vals[k] * (1 - bandPm(i))).toFixed(1)}`)
          .reverse();
        return `M${x(fc.from).toFixed(1)},${y(cur[fc.from]).toFixed(1)}${up.join("").replace(/^M/, "L")}${lo.join("")}Z`;
      })()
    : "";

  const maxLabels = Math.max(2, Math.floor(plotW / (compactW ? 48 : 60)));
  const labelStep = Math.max(1, Math.ceil(N / maxLabels));
  const dateAt = (i: number): string => {
    if (i < n) return trend[i].date;
    const d = new Date(`${rangeEnd}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + (i - (n - 1)));
    return d.toISOString().slice(0, 10);
  };

  const pick = (clientX: number, rect: DOMRect) => {
    if (n === 0) return;
    const i = Math.round((clientX - rect.left - pad.left) / stepX);
    setActive(Math.min(N - 1, Math.max(0, i)));
  };
  const onPointer = (e: PointerEvent<SVGRectElement>) =>
    pick(e.clientX, (e.currentTarget.ownerSVGElement ?? e.currentTarget).getBoundingClientRect());
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (n === 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const d = e.key === "ArrowRight" ? 1 : -1;
      setActive((a) => Math.min(N - 1, Math.max(0, (a ?? (d > 0 ? -1 : N)) + d)));
    } else if (e.key === "Escape") {
      setActive(null);
    }
  };

  // Value + comparison at the hovered day (or forecast day).
  const isFc = active != null && active >= n;
  const activeVal = active == null ? null : isFc ? fcAt(active) : cur[active];
  const activeX = active != null ? x(active) : 0;
  const activeY = activeVal != null ? y(activeVal) : 0;
  let tipDiff = "";
  let tipTone: "good" | "bad" | "flat" | "fc" = "flat";
  if (active != null && activeVal != null) {
    if (isFc) {
      tipDiff = t.forecastTip(Math.round(bandPm(active) * 100));
      tipTone = "fc";
    } else {
      const c = cmp[active];
      if (c != null && c > 0) {
        const d = Math.round((activeVal / c - 1) * 100);
        tipDiff = t.vs(d, showYoy ? t.vsYoy : t.vsPrev);
        const better = BETTER[metric];
        tipTone = better === 0 || d === 0 ? "flat" : (better > 0) === d > 0 ? "good" : "bad";
      }
    }
  }
  const tipDate = (i: number) => {
    const iso = dateAt(i);
    const [, m, d] = iso.split("-").map(Number);
    const wd = t.weekdays[new Date(`${iso}T12:00:00`).getDay()].replace(".", "").toUpperCase();
    return `${d} ${t.monthsShort[m - 1]} · ${wd}${i === partialIdx ? ` · ${t.partialShort.toUpperCase()}` : ""}${i >= n ? ` · ${t.forecastDay}` : ""}`;
  };
  const xPct = active != null && width > 0 ? activeX / width : 0.5;
  const tipTransform =
    xPct > 0.78
      ? "translate(calc(-100% - 18px), -50%)"
      : xPct < 0.12
        ? "translate(18px, -50%)"
        : activeY < 110
          ? "translate(-50%, 22px)"
          : "translate(-50%, calc(-100% - 22px))";
  const activeMarker = active != null && active < n ? markerByIndex.get(active) : undefined;

  // Event chips under the axis: full text where there is room, the number
  // alone where chips would collide (the tooltip carries the text).
  const chips = useMemo(() => {
    if (width <= 0) return [];
    const list = Array.from(markerByIndex.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([i, m]) => ({
        i,
        m,
        text: m.events[0].text + (m.events.length > 1 ? ` +${m.events.length - 1}` : ""),
        cx: x(i),
      }));
    // Greedy: a chip keeps its text when it clears the previous chip and
    // still leaves room for the next one's number; otherwise number only,
    // nudged right so neighbours never overlap.
    let lastRight = -Infinity;
    return list.map((c, k) => {
      const next = list[k + 1];
      const wFull = Math.min(220, 40 + c.text.length * 6.4);
      const lFull = Math.min(Math.max(0, c.cx - wFull / 2), width - wFull);
      const fits =
        lFull >= lastRight + 8 && (!next || lFull + wFull + 8 <= next.cx - 15);
      const w = fits ? wFull : 30;
      let left = fits ? lFull : Math.min(Math.max(0, c.cx - 15), width - 30);
      if (!fits) left = Math.min(Math.max(left, lastRight + 4), width - w);
      lastRight = left + w;
      return { ...c, left, w, short: !fits };
    });
    // x() depends on the measured geometry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markerByIndex, width, N, pad.left]);

  const tone = {
    good: "text-positive",
    bad: "text-negative",
    flat: "text-ink-3",
    fc: "text-ai",
  }[tipTone];
  const move = { transition: `left .25s ${EASE}, top .25s ${EASE}` };

  return (
    <Card className={cn("rounded-glass p-6 sm:p-[28px_30px]", className)}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-10">
        <div className="min-w-0">
          <p className="kick">
            {t.long[metric]}
            {label ? ` · ${label}` : ""}
            {fc ? ` ${t.forecastKick}` : ""}
          </p>
          <h2 className="mt-2 text-[22px] font-medium tracking-[-0.03em]">
            {t.long[metric]} {t.dayByDay}
          </h2>
          <p className="mt-1.5 text-sm text-ink-3 tabular-nums">
            {/* "0,00 zł" next to "no data" contradicts itself - a dash says it. */}
            <span className="font-medium text-foreground">{isEmpty ? "-" : full(total, isMoney, lang)}</span>
            {takeawayTail ? ` · ${takeawayTail}.` : ""}
            {fc ? ` ${t.forecastNote(full(fc.avg, isMoney, lang))}` : ""}
          </p>
        </div>
        {/* Legend: the glyph repeats the line style, so series are told
            apart without colour too. */}
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-[13px] text-ink-2">
          <span className={cn("inline-flex items-center gap-2", isEmpty && "invisible")}>
            <i aria-hidden className="h-[3px] w-[18px] rounded-sm bg-[hsl(var(--lime-line))] shadow-[0_0_8px_var(--lime-glow)]" />
            {t.current}
          </span>
          {showPrev || showYoy ? (
            <span className="inline-flex items-center gap-2">
              <i aria-hidden className="w-[18px] border-t-2 border-dashed border-[color:var(--prev)]" />
              {cmpLabel}
            </span>
          ) : null}
          {fc ? (
            <span className="inline-flex items-center gap-2">
              <i aria-hidden className="w-[18px] border-t-2 border-dotted border-[hsl(var(--lime-line))]" />
              {t.forecast}
            </span>
          ) : null}
        </div>
      </div>

      {hidePicker && (hideCompare || !(hasPrev || hasYoy)) ? null : (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          {hidePicker ? (
            <span />
          ) : (
            // Toggle buttons, not ARIA tabs: one shared chart, no panels.
            <SegmentedTrack role="group" aria-label={t.long[metric]} className="inline-flex max-w-full overflow-x-auto rounded-full bg-chip p-1 [scrollbar-width:none]">
              {METRIC_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={metric === k}
                  onClick={() => setMetric(k)}
                  className={segmentedItem(metric === k, "min-h-9 justify-center px-3 text-xs")}
                >
                  {t.tab[k]}
                </button>
              ))}
            </SegmentedTrack>
          )}
          {!hideCompare && (hasPrev || hasYoy) ? (
            <div role="group" aria-label={t.compareWith} className="flex flex-wrap items-center gap-2 text-xs">
              <span aria-hidden className="text-ink-3">
                {t.compareWith}
              </span>
              <SegmentedTrack className="inline-flex max-w-full overflow-x-auto rounded-full bg-chip p-1 [scrollbar-width:none]">
                {compareModes.map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={mode === k}
                    onClick={() => setCompare(k)}
                    className={segmentedItem(mode === k, "min-h-9 justify-center px-3 text-xs")}
                  >
                    {t.compareOpts[k]}
                  </button>
                ))}
              </SegmentedTrack>
            </div>
          ) : null}
        </div>
      )}

      {trimFrom > 0 && !isEmpty ? (
        <p className="mb-2 text-xs text-ink-3">{t.collectingSince(ddmm(trend[0].date))}</p>
      ) : null}

      <div ref={boxRef} className="relative h-64 w-full cursor-crosshair sm:h-[300px]">
        {isEmpty ? (
          // Same box height as the chart so the page doesn't jump between tabs.
          <div className="relative flex h-full cursor-default flex-col items-center justify-center gap-3 rounded-[22px] bg-chip px-4 text-center">
            <div aria-hidden className="absolute inset-x-5 inset-y-6 flex flex-col justify-between">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="border-t border-dashed border-line" />
              ))}
            </div>
            <span
              aria-hidden
              className="relative flex h-11 w-11 items-center justify-center rounded-full bg-card text-muted-foreground shadow-card"
            >
              <LineChart className="h-5 w-5" />
            </span>
            <p className="relative max-w-xs text-balance text-sm leading-relaxed text-muted-foreground">
              {t.empty[metric]}
            </p>
          </div>
        ) : width > 0 && n > 0 ? (
          <>
            {/* Hatched future zone (forecast). */}
            {fc ? (
              <span
                aria-hidden
                className="hatch absolute rounded-r-2xl"
                style={{ left: x(todayIdx), right: pad.right, top: pad.top, bottom: pad.bottom }}
              />
            ) : null}
            <svg
              width={width}
              height={H}
              role="img"
              aria-label={`${t.chartAria}. ${t.long[metric]}: ${full(total, isMoney, lang)}${takeawayTail ? ` - ${takeawayTail}` : ""}`}
              tabIndex={0}
              onKeyDown={onKey}
              onBlur={() => setActive(null)}
              className="relative block touch-pan-y select-none overflow-visible outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-card"
            >
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="var(--lime-hex)" stopOpacity={0.34} />
                  <stop offset="0.6" stopColor="var(--lime-hex)" stopOpacity={0.06} />
                  <stop offset="1" stopColor="var(--lime-hex)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id={bandId} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="var(--violet-hex)" stopOpacity={0.1} />
                  <stop offset="1" stopColor="var(--violet-hex)" stopOpacity={0.32} />
                </linearGradient>
              </defs>

              {/* Recessive grid + y labels */}
              {yTicks.map((v) => (
                <g key={v}>
                  <line
                    x1={pad.left}
                    x2={width - pad.right}
                    y1={y(v)}
                    y2={y(v)}
                    stroke="var(--line)"
                    strokeWidth={1}
                  />
                  <text
                    x={pad.left - 10}
                    y={y(v)}
                    dy="0.32em"
                    textAnchor="end"
                    className="fill-[var(--ink-3)] font-mono text-[11px] tabular-nums"
                  >
                    {compact(v, isMoney)}
                  </text>
                </g>
              ))}

              {/* X labels */}
              {Array.from({ length: N }, (_, i) =>
                i % labelStep === 0 || i === N - 1 ? (
                  i !== N - 1 && x(N - 1) - x(i) < (compactW ? 40 : 48) ? null : (
                    <text
                      key={i}
                      x={x(i)}
                      y={H - 6}
                      textAnchor={x(i) + 20 > width ? "end" : x(i) - 20 < pad.left - 8 ? "start" : "middle"}
                      className="fill-[var(--ink-3)] font-mono text-[11px] tabular-nums"
                    >
                      {ddmm(dateAt(i))}
                    </text>
                  )
                ) : null
              )}

              {/* Event rules (chips sit under the axis) */}
              {Array.from(markerByIndex.keys()).map((i) => (
                <line
                  key={`ev-${i}`}
                  x1={x(i)}
                  x2={x(i)}
                  y1={pad.top}
                  y2={pad.top + plotH}
                  stroke={active === i ? "var(--ink-3)" : "var(--line)"}
                  strokeWidth={1}
                />
              ))}

              {fc ? (
                <path d={fcBand} fill={`url(#${bandId})`} className="animate-fade" style={{ "--d": "1.6s" } as React.CSSProperties} />
              ) : null}
              <path d={areaPath} fill={`url(#${gradId})`} className="animate-fade" style={{ "--d": ".9s" } as React.CSSProperties} />

              {/* Comparison (previous period or a year earlier): dashed, muted */}
              {cmp.length > 0 ? (
                <path
                  d={gapPath(cmp)}
                  fill="none"
                  stroke="var(--prev)"
                  strokeWidth={1.5}
                  strokeDasharray="3 5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  className="animate-fade"
                  style={{ "--d": "1.2s" } as React.CSSProperties}
                />
              ) : null}

              {/* Current period: lime with a soft glow, drawn in. */}
              <path
                key={`line-${metric}`}
                d={linePath(cur, 0, solidTo)}
                pathLength={1}
                fill="none"
                stroke="hsl(var(--lime-line))"
                strokeWidth={2.6}
                strokeLinejoin="round"
                strokeLinecap="round"
                className="draw-path animate-draw"
                style={{ "--d": ".4s", filter: "drop-shadow(0 4px 10px var(--lime-glow))" } as React.CSSProperties}
              />
              {/* With 1-3 days a bare line is easy to miss - mark every point. */}
              {n <= 3
                ? cur.map((v, i) =>
                    i === partialIdx && i > 0 ? null : (
                      <circle key={i} cx={x(i)} cy={y(v)} r={3.5} fill="hsl(var(--lime-line))" />
                    )
                  )
                : null}
              {partialIdx > 0 ? (
                // Today's incomplete point: dashed connector + hollow dot, so a
                // "drop" on the last day reads as unfinished, not a collapse.
                <>
                  <path
                    d={linePath(cur, n - 2, n - 1)}
                    fill="none"
                    stroke="hsl(var(--lime-line))"
                    strokeWidth={2}
                    strokeDasharray="2 3"
                  />
                  <circle cx={x(n - 1)} cy={y(cur[n - 1])} r={4} className="fill-card" stroke="hsl(var(--lime-line))" strokeWidth={2} />
                </>
              ) : null}
              {fc ? (
                <path
                  d={fcLine}
                  fill="none"
                  stroke="hsl(var(--lime-line))"
                  strokeWidth={2.2}
                  strokeDasharray="2 7"
                  strokeLinecap="round"
                  opacity={0.9}
                  className="animate-fade"
                  style={{ "--d": "1.8s" } as React.CSSProperties}
                />
              ) : null}

              {/* Hit area: whole chart, so taps near a day all work */}
              <rect
                x={0}
                y={0}
                width={width}
                height={H}
                fill="transparent"
                onPointerMove={onPointer}
                onPointerDown={onPointer}
                onPointerLeave={(e) => {
                  if (e.pointerType === "mouse") setActive(null);
                }}
              />
            </svg>

            {/* Today marker */}
            {showToday ? (
              <div
                aria-hidden
                className="pointer-events-none absolute border-l border-dashed border-[color:var(--ink-3)]"
                style={{ left: x(todayIdx), top: pad.top - 4, bottom: pad.bottom }}
              >
                <span className="absolute -top-5 left-0 -translate-x-1/2 font-mono text-[10.5px] tracking-[0.12em] text-ink-3">
                  {t.today}
                </span>
              </div>
            ) : null}

            {/* Crosshair, lime dot, glass tooltip */}
            {active != null && activeVal != null ? (
              <>
                <span
                  aria-hidden
                  className="pointer-events-none absolute w-px bg-[linear-gradient(180deg,transparent,var(--ink-3)_30%,var(--ink-3)_70%,transparent)] motion-reduce:!transition-none"
                  style={{ left: activeX, top: pad.top, bottom: pad.bottom, ...move }}
                />
                <span
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute -ml-2 -mt-2 h-4 w-4 rounded-full shadow-[0_0_0_5px_var(--lime-glow),0_6px_16px_-4px_rgb(40_36_28/0.25)] motion-reduce:!transition-none",
                    isFc || active === partialIdx ? "border-2 border-[hsl(var(--lime-line))] bg-card" : "bg-[hsl(var(--lime-line))]"
                  )}
                  style={{ left: activeX, top: activeY, ...move }}
                />
                <div
                  aria-hidden
                  className="glass-tip pointer-events-none absolute z-10 flex max-w-[16rem] flex-col gap-1 rounded-[18px] px-3.5 py-3 text-[12.5px] motion-reduce:!transition-none"
                  style={{ left: activeX, top: activeY, transform: tipTransform, ...move }}
                >
                  <span className="whitespace-nowrap font-mono text-[11px] tracking-[0.08em] text-ink-3">
                    {tipDate(active)}
                  </span>
                  <b className="text-lg font-medium tracking-[-0.02em] tabular-nums">
                    {full(activeVal, isMoney, lang)}
                  </b>
                  {tipDiff ? <span className={cn("whitespace-nowrap font-medium", tone)}>{tipDiff}</span> : null}
                  {activeMarker ? (
                    <ul className="mt-1 space-y-1 border-t border-line pt-1.5">
                      {activeMarker.events.map((ev) => (
                        <li key={ev.id} className="flex gap-1.5">
                          <span className="mt-px inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-anchor px-1 text-[10px] font-semibold text-anchor-foreground tabular-nums">
                            {activeMarker.number}
                          </span>
                          <span>{ev.text}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </>
            ) : null}
          </>
        ) : null}

        {/* Keyboard users step days with the arrow keys; announce the
            point the visual tooltip shows. */}
        <p className="sr-only" aria-live="polite">
          {active != null && activeVal != null && !isEmpty
            ? `${tipDate(active).toLowerCase()}: ${full(activeVal, isMoney, lang)}${tipDiff ? `, ${tipDiff}` : ""}`
            : ""}
        </p>
      </div>

      {/* Event chips under the axis (Przeglad-pastel `.evc`). */}
      {chips.length > 0 && !isEmpty ? (
        <ul className="relative mt-1 h-[46px]" aria-label={t.whatHappened}>
          {chips.map((c, k) => (
            <li
              key={c.m.date}
              className="absolute top-2 animate-fade"
              style={{ left: c.left, width: c.w, "--d": `${2 + k * 0.12}s` } as React.CSSProperties}
            >
              <button
                type="button"
                onClick={() => setActive((a) => (a === c.i ? null : c.i))}
                aria-label={t.eventAt(ddmm(c.m.date), c.m.events.map((e) => e.text).join("; "))}
                title={c.m.events.map((e) => e.text).join("\n")}
                className={cn(
                  "flex h-[30px] w-full items-center gap-1.5 rounded-full bg-chip text-xs text-ink-2 backdrop-blur-[10px] transition-colors hover:bg-[var(--chip-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  c.short ? "justify-center px-[5px]" : "pl-1.5 pr-[11px]",
                  active === c.i && "bg-[var(--chip-hover)] text-foreground"
                )}
              >
                <b className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-anchor text-[10.5px] font-semibold text-anchor-foreground">
                  {c.m.number}
                </b>
                {c.short ? null : <span className="min-w-0 truncate">{c.text}</span>}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
