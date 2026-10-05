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
import { Card, Title } from "@tremor/react";
import { differenceInCalendarDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

import {
  buildChartMarkers,
  buildDemoChartExtras,
  type ChartEvent,
  type ChartMarker,
} from "@/lib/dashboard/chart-events";
import type { TrendPoint } from "@/lib/dashboard/metrics";
import type { ClientEvent } from "@/lib/dashboard/overview";
import { cn } from "@/lib/utils";

type MetricKey = "spend" | "sessions" | "clicks" | "conversions";
type Lang = "pl" | "en";

const METRIC_KEYS: MetricKey[] = ["spend", "sessions", "clicks", "conversions"];
const LIST_VISIBLE = 5;
// Stable fallbacks so memoised marker building doesn't rerun every render.
const NO_POINTS: TrendPoint[] = [];
const NO_EVENTS: ChartEvent[] = [];

const COPY = {
  pl: {
    tab: { spend: "Wydatki", sessions: "Wizyty na stronie", clicks: "Kliknięcia", conversions: "Działania" },
    long: { spend: "Wydatki", sessions: "Wizyty na stronie", clicks: "Kliknięcia", conversions: "Działania na stronie" },
    current: "Ten okres",
    previous: "Poprzedni okres",
    compare: "Porównaj z poprzednim okresem",
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
  },
  en: {
    tab: { spend: "Spend", sessions: "Sessions", clicks: "Clicks", conversions: "Conversions" },
    long: { spend: "Spend", sessions: "Sessions", clicks: "Clicks", conversions: "Conversions" },
    current: "This period",
    previous: "Previous period",
    compare: "Compare with previous period",
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
  },
} as const;

function valueOf(p: TrendPoint, metric: MetricKey): number {
  if (metric === "spend") return p.spendMinorUnits / 100;
  if (metric === "sessions") return p.sessions;
  if (metric === "clicks") return p.clicks;
  return p.conversions;
}

const ddmm = (date: string) => {
  const [, m, d] = date.split("-");
  return `${d}.${m}`;
};

// Compact axis labels so wide amounts ("140 000,00 zł") don't get clipped.
function compact(v: number, money: boolean): string {
  const unit = money ? " zł" : "";
  const abs = Math.abs(v);
  if (abs >= 1_000_000)
    return `${(v / 1_000_000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} mln${unit}`;
  if (abs >= 1_000)
    return `${(v / 1_000).toLocaleString("pl-PL", { maximumFractionDigits: abs >= 10_000 ? 0 : 1 })} tys.${unit}`;
  return `${Math.round(v)}${unit}`;
}

function full(v: number, money: boolean, lang: Lang): string {
  const locale = lang === "en" ? "en-GB" : "pl-PL";
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
  trend,
  prevTrend,
  events,
  autoEvents,
  label,
  lang = "pl",
  demo = false,
}: {
  trend: TrendPoint[];
  /** Comparison period, aligned to `trend` by day index. */
  prevTrend?: TrendPoint[];
  /** Manual annotations (client_events). */
  events: ClientEvent[];
  /** Auto-detected campaign starts/pauses/budget changes. */
  autoEvents?: ChartEvent[];
  label?: string;
  lang?: Lang;
  /** Public demo pages: synthesize comparison + annotations from `trend`. */
  demo?: boolean;
}) {
  const t = COPY[lang];
  const [metric, setMetric] = useState<MetricKey>("spend");
  const [compare, setCompare] = useState(true);
  const [active, setActive] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const width = size.w;
  // Resolved after mount: server and browser can disagree around midnight,
  // and the SVG only renders client-side anyway (it needs a measured width).
  const [today, setToday] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const gradId = useId();

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
    () => (demo ? buildDemoChartExtras(trend, lang) : null),
    [demo, trend, lang]
  );
  const prev = prevTrend ?? demoExtras?.prevTrend ?? NO_POINTS;
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

  const isMoney = metric === "spend";
  const cur = trend.map((p) => valueOf(p, metric));
  const prv = prev.slice(0, n).map((p) => valueOf(p, metric));
  const hasPrev = prev.length > 0;
  const showPrev = compare && hasPrev;
  const partialIdx = today && trend[n - 1]?.date === today ? n - 1 : -1;

  // --- Takeaway line (full-period totals, same basis as the KPI cards) ---
  const total = cur.reduce((a, v) => a + v, 0);
  const prevTotal = prev.reduce((a, p) => a + valueOf(p, metric), 0);
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
  if (!hasPrev || prevTotal <= 0) {
    takeawayTail = t.noPrev;
  } else {
    const pct = ((total - prevTotal) / prevTotal) * 100;
    const abs = Math.round(Math.abs(pct));
    takeawayTail = abs < 1 ? t.same(prevPhrase) : t.delta(abs, pct > 0, prevPhrase);
  }
  const takeaway = `${t.long[metric]}: ${full(total, isMoney, lang)} - ${takeawayTail}`;

  // --- Geometry ---
  const compactW = width > 0 && width < 480;
  // Height comes from CSS (h-60 / sm:h-72) so the SSR placeholder doesn't jump.
  const H = size.h || 288;
  const yMaxRaw = Math.max(0, ...cur, ...(showPrev ? prv : []));
  const { max: yMax, step: yStep } = niceScale(yMaxRaw);
  const yTicks: number[] = [];
  for (let v = 0; v <= yMax + yStep / 2; v += yStep) yTicks.push(v);
  const yLabelW = Math.max(
    28,
    ...yTicks.map((v) => compact(v, isMoney).length * (compactW ? 6 : 6.5))
  );
  const pad = { left: yLabelW + 8, right: 16, top: markers.length > 0 ? 28 : 12, bottom: 24 };
  const plotW = Math.max(1, width - pad.left - pad.right);
  const plotH = H - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (v: number) => pad.top + plotH - (v / yMax) * plotH;
  const stepX = n <= 1 ? plotW : plotW / (n - 1);

  const linePath = (vals: number[], from = 0, to = vals.length - 1) =>
    vals
      .slice(from, to + 1)
      .map((v, k) => `${k === 0 ? "M" : "L"}${x(from + k).toFixed(1)},${y(v).toFixed(1)}`)
      .join("");
  // Today's incomplete point gets a dashed connector instead of the solid line,
  // so a "drop" on the last day reads as unfinished, not as a collapse.
  const solidTo = partialIdx > 0 ? n - 2 : n - 1;
  const areaPath =
    n > 0
      ? `${linePath(cur, 0, solidTo)}L${x(solidTo).toFixed(1)},${(pad.top + plotH).toFixed(1)}L${x(0).toFixed(1)},${(pad.top + plotH).toFixed(1)}Z`
      : "";

  const maxLabels = Math.max(2, Math.floor(plotW / 52));
  const labelStep = Math.max(1, Math.ceil(n / maxLabels));

  const pick = (clientX: number, rect: DOMRect) => {
    if (n === 0) return;
    const i = Math.round((clientX - rect.left - pad.left) / stepX);
    setActive(Math.min(n - 1, Math.max(0, i)));
  };
  const onPointer = (e: PointerEvent<SVGRectElement>) =>
    pick(e.clientX, (e.currentTarget.ownerSVGElement ?? e.currentTarget).getBoundingClientRect());
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (n === 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const d = e.key === "ArrowRight" ? 1 : -1;
      setActive((a) => Math.min(n - 1, Math.max(0, (a ?? (d > 0 ? -1 : n)) + d)));
    } else if (e.key === "Escape") {
      setActive(null);
    }
  };

  const flatEvents = markers.flatMap((m) =>
    m.events.map((ev) => ({ marker: m, ev }))
  );
  const visibleEvents = showAll ? flatEvents : flatEvents.slice(0, LIST_VISIBLE);

  const tipW = 224;
  const activeX = active != null ? x(active) : 0;
  const tipLeft =
    active == null
      ? 0
      : Math.min(
          Math.max(0, activeX > width / 2 ? activeX - tipW - 12 : activeX + 12),
          Math.max(0, width - tipW)
        );
  const weekday = (date: string) =>
    t.weekdays[new Date(`${date}T12:00:00`).getDay()];

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Title>
          {t.long[metric]}
          {label ? ` - ${label}` : ""}
        </Title>
        <div
          role="tablist"
          className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 sm:flex"
        >
          {METRIC_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={metric === k}
              onClick={() => setMetric(k)}
              className={cn(
                "whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:py-1",
                metric === k
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.tab[k]}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-3 text-sm text-foreground tabular-nums">
        <span className="font-semibold">
          {t.long[metric]}: {full(total, isMoney, lang)}
        </span>
        <span className="text-muted-foreground"> - {takeawayTail}</span>
      </p>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <svg width="16" height="8" aria-hidden className="text-indigo-500 dark:text-indigo-400">
              <line x1="0" y1="4" x2="16" y2="4" stroke="currentColor" strokeWidth="2" />
            </svg>
            {t.current}
          </span>
          {showPrev ? (
            <span className="inline-flex items-center gap-1.5">
              <svg width="16" height="8" aria-hidden className="text-slate-400 dark:text-slate-500">
                <line x1="0" y1="4" x2="16" y2="4" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
              </svg>
              {t.previous}
            </span>
          ) : null}
          {partialIdx >= 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <svg width="10" height="10" aria-hidden className="text-indigo-500 dark:text-indigo-400">
                <circle cx="5" cy="5" r="3.5" className="fill-card" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              {t.partial}
            </span>
          ) : null}
        </div>
        {hasPrev ? (
          <button
            type="button"
            role="switch"
            aria-checked={compare}
            onClick={() => setCompare((c) => !c)}
            className="inline-flex items-center gap-2 rounded-md py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <span
              aria-hidden
              className={cn(
                "relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors",
                compare ? "bg-primary" : "bg-muted ring-1 ring-inset ring-border"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-3 w-3 rounded-full bg-card shadow-sm transition-transform",
                  compare ? "translate-x-3.5" : "translate-x-0.5"
                )}
              />
            </span>
            {t.compare}
          </button>
        ) : null}
      </div>

      <div ref={boxRef} className="relative mt-2 h-60 w-full sm:h-72">
        {width > 0 && n > 0 ? (
          <svg
            width={width}
            height={H}
            role="img"
            aria-label={`${t.chartAria}. ${takeaway}`}
            tabIndex={0}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
            className="block touch-pan-y select-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            <defs>
              <linearGradient
                id={gradId}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
                // currentColor in a gradient resolves where the gradient is
                // defined, not where it is used - colour it here.
                className="text-indigo-500 dark:text-indigo-400"
              >
                <stop offset="0%" stopColor="currentColor" stopOpacity={0.22} />
                <stop offset="100%" stopColor="currentColor" stopOpacity={0.02} />
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
                  className="stroke-border"
                  strokeWidth={1}
                />
                <text
                  x={pad.left - 8}
                  y={y(v)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-muted-foreground text-[11px] tabular-nums"
                >
                  {compact(v, isMoney)}
                </text>
              </g>
            ))}

            {/* X labels */}
            {trend.map((p, i) =>
              i % labelStep === 0 ? (
                <text
                  key={p.date}
                  x={x(i)}
                  y={H - 6}
                  textAnchor={x(i) + 18 > width ? "end" : x(i) - 18 < pad.left - 8 ? "start" : "middle"}
                  className="fill-muted-foreground text-[11px] tabular-nums"
                >
                  {ddmm(p.date)}
                </text>
              ) : null
            )}

            {/* Event markers: dashed rule + numbered flag */}
            {Array.from(markerByIndex.entries()).map(([i, m]) => (
              <g key={m.date} className={active === i ? "text-foreground" : "text-muted-foreground"}>
                <line
                  x1={x(i)}
                  x2={x(i)}
                  y1={pad.top - 6}
                  y2={pad.top + plotH}
                  stroke="currentColor"
                  strokeOpacity={active === i ? 0.8 : 0.45}
                  strokeDasharray="3 3"
                />
                <circle cx={x(i)} cy={pad.top - 15} r={8} className="fill-primary" />
                <text
                  x={x(i)}
                  y={pad.top - 15}
                  dy="0.35em"
                  textAnchor="middle"
                  className="fill-primary-foreground text-[10px] font-semibold tabular-nums"
                >
                  {m.number}
                </text>
              </g>
            ))}

            {/* Previous period: dashed, muted, behind the current line */}
            {showPrev && prv.length > 0 ? (
              <path
                d={linePath(prv)}
                fill="none"
                strokeWidth={1.75}
                strokeDasharray="5 4"
                strokeLinejoin="round"
                className="stroke-slate-400 dark:stroke-slate-500"
              />
            ) : null}

            {/* Current period */}
            <g className="text-indigo-500 dark:text-indigo-400">
              <path d={areaPath} fill={`url(#${gradId})`} />
              <path
                d={linePath(cur, 0, solidTo)}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {partialIdx > 0 ? (
                <>
                  <path
                    d={linePath(cur, n - 2, n - 1)}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeDasharray="2 3"
                  />
                  <circle
                    cx={x(n - 1)}
                    cy={y(cur[n - 1])}
                    r={4}
                    className="fill-card"
                    stroke="currentColor"
                    strokeWidth={2}
                  />
                </>
              ) : null}
            </g>

            {/* Crosshair */}
            {active != null ? (
              <g pointerEvents="none">
                <line
                  x1={activeX}
                  x2={activeX}
                  y1={pad.top}
                  y2={pad.top + plotH}
                  className="stroke-muted-foreground"
                  strokeOpacity={0.5}
                />
                {showPrev && active < prv.length ? (
                  <circle
                    cx={activeX}
                    cy={y(prv[active])}
                    r={4}
                    className="fill-slate-400 stroke-card dark:fill-slate-500"
                    strokeWidth={2}
                  />
                ) : null}
                <circle
                  cx={activeX}
                  cy={y(cur[active])}
                  r={5}
                  className={cn(
                    "stroke-card",
                    active === partialIdx
                      ? "fill-card stroke-indigo-500 dark:stroke-indigo-400"
                      : "fill-indigo-500 dark:fill-indigo-400"
                  )}
                  strokeWidth={2}
                />
              </g>
            ) : null}

            {/* Hit area: whole chart, so taps on flags or near a day all work */}
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
        ) : null}

        {active != null && width > 0 && trend[active] ? (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-border bg-popover p-2.5 text-xs text-popover-foreground shadow-md"
            style={{ left: tipLeft, top: pad.top, width: tipW }}
          >
            <p className="font-medium tabular-nums">
              {weekday(trend[active].date)} {ddmm(trend[active].date)}
              {active === partialIdx ? (
                <span className="font-normal text-muted-foreground"> · {t.partialShort}</span>
              ) : null}
            </p>
            <div className="mt-1.5 space-y-1 tabular-nums">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <span className="h-0.5 w-3 rounded-full bg-indigo-500 dark:bg-indigo-400" />
                  {t.current}
                </span>
                <span className="font-semibold">{full(cur[active], isMoney, lang)}</span>
              </div>
              {showPrev && active < prv.length ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <span className="h-0.5 w-3 rounded-full bg-slate-400 dark:bg-slate-500" />
                    {t.previous} ({ddmm(prev[active].date)})
                  </span>
                  <span>{full(prv[active], isMoney, lang)}</span>
                </div>
              ) : null}
            </div>
            {markerByIndex.get(active) ? (
              <ul className="mt-2 space-y-1 border-t border-border pt-2">
                {markerByIndex.get(active)!.events.map((ev) => (
                  <li key={ev.id} className="flex gap-1.5">
                    <span className="mt-px inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums">
                      {markerByIndex.get(active)!.number}
                    </span>
                    <span>{ev.text}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      {flatEvents.length > 0 ? (
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t.whatHappened}
          </p>
          <ul className="space-y-1">
            {visibleEvents.map(({ marker, ev }) => {
              const i = trend.findIndex((p) => p.date === marker.date);
              return (
                <li key={ev.id}>
                  <button
                    type="button"
                    onClick={() => setActive(i >= 0 ? i : null)}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-sm transition-colors hover:bg-muted",
                      active === i && "bg-muted"
                    )}
                  >
                    <span className="mt-0.5 inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums">
                      {marker.number}
                    </span>
                    <span className="w-11 shrink-0 font-medium tabular-nums">
                      {ddmm(marker.date)}
                    </span>
                    <span className="min-w-0 flex-1 break-words">
                      {ev.text}
                      {ev.tag ? (
                        <span className="ml-2 whitespace-nowrap rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">
                          {ev.tag}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {flatEvents.length > LIST_VISIBLE ? (
            <button
              type="button"
              onClick={() => setShowAll((s) => !s)}
              className="mt-2 px-1.5 text-xs font-medium text-primary hover:underline"
            >
              {showAll ? t.showLess : t.showMore(flatEvents.length - LIST_VISIBLE)}
            </button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
