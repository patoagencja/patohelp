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

import { cn } from "@/lib/utils";

/**
 * Small daily line chart in the overview's main-chart style (v2 skin): the
 * current series as a chart-1 line over a soft lime gradient, an optional
 * comparison series dashed in chart-muted, faint dashed guides, a dark
 * rounded tooltip and a crosshair with a halo. Shared by "Sprzedaż dzień po
 * dniu" and "Wizyty na stronie dzień po dniu" so both read like the overview.
 *
 * Keyboard: the plot is focusable; arrows step days, Home/End jump. The
 * focused day is announced through a polite live region.
 */

export interface TrendLinePoint {
  /** YYYY-MM-DD (already in Warsaw days). */
  date: string;
  value: number;
  /** Comparison value for the same day (e.g. last year); null = no data. */
  compare?: number | null;
}

const WEEKDAY = ["niedz.", "pon.", "wt.", "śr.", "czw.", "pt.", "sob."];
const WEEKDAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LEGEND_CHIP = "inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1";
const TIP_W = 184;

const ddmm = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}.${m}`;
};

// "Nice" axis step (1/2/2.5/5 x 10^n) so guides land on round numbers.
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/**
 * Monotone cubic (Fritsch-Carlson) through the points: smooth like the old
 * Tremor curve, but it never overshoots - a smoothed dip below zero or above
 * the best day would invent a value the data doesn't have.
 */
function monotonePath(pts: Array<{ x: number; y: number }>): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${pts[0].x},${pts[0].y}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x);
    m.push(dx[i] === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx[i]);
  }
  const t: number[] = new Array(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      t[i] = tau * a * m[i];
      t[i + 1] = tau * b * m[i];
    }
  }
  let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${(pts[i].x + h).toFixed(2)},${(pts[i].y + t[i] * h).toFixed(2)} ${(
      pts[i + 1].x - h
    ).toFixed(2)},${(pts[i + 1].y - t[i + 1] * h).toFixed(2)} ${pts[i + 1].x.toFixed(2)},${pts[
      i + 1
    ].y.toFixed(2)}`;
  }
  return d;
}

export function TrendLineChart({
  points,
  valueLabel,
  compareLabel,
  formatValue,
  formatAxis,
  ariaLabel,
  lang = "pl",
  className,
}: {
  points: TrendLinePoint[];
  /** Legend / tooltip name of the main series ("Sprzedaż"). */
  valueLabel: string;
  /** Legend / tooltip name of the comparison ("Rok temu"); omit for none. */
  compareLabel?: string;
  /** Full value for the tooltip ("12 345 zł"). */
  formatValue: (v: number) => string;
  /** Short value for the y axis ("12 tys. zł"). */
  formatAxis: (v: number) => string;
  /** The chart's takeaway for screen readers. */
  ariaLabel: string;
  lang?: "pl" | "en";
  /** Height of the plot box, e.g. "h-64 sm:h-72". */
  className?: string;
}) {
  const gradId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const n = points.length;
  const hasCompare =
    Boolean(compareLabel) && points.some((p) => p.compare !== null && p.compare !== undefined);

  const { ticks, top } = useMemo(() => {
    const vals = points.flatMap((p) =>
      hasCompare && p.compare != null ? [p.value, p.compare] : [p.value]
    );
    const max = Math.max(0, ...vals);
    const step = niceStep((max || 1) / 4);
    const t = Math.max(step, Math.ceil((max * 1.04) / step) * step);
    const out: number[] = [];
    for (let v = 0; v <= t + step / 2; v += step) out.push(v);
    return { ticks: out, top: t };
  }, [points, hasCompare]);

  const { w: width, h: H } = size;
  // Left gutter sized to the longest axis label (no measuring pass needed:
  // 11px tabular digits are ~6.3px wide).
  const longest = Math.max(...ticks.map((v) => formatAxis(v).length));
  const pad = { top: 12, right: 12, bottom: 26, left: Math.round(longest * 6.3 + 14) };
  const plotW = Math.max(1, width - pad.left - pad.right);
  const plotH = Math.max(1, H - pad.top - pad.bottom);
  const x = (i: number) => pad.left + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (v: number) => pad.top + plotH * (1 - v / top);

  const curPts = points.map((p, i) => ({ x: x(i), y: y(p.value) }));
  const line = monotonePath(curPts);
  const area =
    n > 1
      ? `${line}L${x(n - 1).toFixed(2)},${pad.top + plotH}L${x(0).toFixed(2)},${pad.top + plotH}Z`
      : "";
  // Comparison may have holes (days without last-year data): one run each.
  const cmpRuns: string[] = [];
  if (hasCompare) {
    let run: Array<{ x: number; y: number }> = [];
    points.forEach((p, i) => {
      if (p.compare != null) run.push({ x: x(i), y: y(p.compare) });
      else if (run.length) {
        cmpRuns.push(monotonePath(run));
        run = [];
      }
    });
    if (run.length > 1) cmpRuns.push(monotonePath(run));
  }

  const labelStep = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 58))));

  const pick = (clientX: number, rect: DOMRect) => {
    if (n === 0) return;
    const rel = (clientX - rect.left - pad.left) / plotW;
    setActive(Math.min(n - 1, Math.max(0, Math.round(rel * (n - 1)))));
  };
  const onPointer = (e: PointerEvent<SVGRectElement>) => {
    const svg = e.currentTarget.ownerSVGElement;
    if (svg) pick(e.clientX, svg.getBoundingClientRect());
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (n === 0) return;
    const cur = active ?? n - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = Math.min(n - 1, active === null ? n - 1 : cur + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, active === null ? n - 1 : cur - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else if (e.key === "Escape") return setActive(null);
    if (next !== null) {
      e.preventDefault();
      setActive(next);
    }
  };

  const weekday = (iso: string) =>
    (lang === "en" ? WEEKDAY_EN : WEEKDAY)[new Date(`${iso}T12:00:00Z`).getUTCDay()];
  const ap = active !== null ? points[active] : null;
  const activeX = active !== null ? x(active) : 0;
  const tipLeft =
    activeX + 14 + TIP_W <= width ? activeX + 14 : Math.max(0, activeX - 14 - TIP_W);

  return (
    <div>
      {hasCompare ? (
        <div className="mb-2 flex flex-wrap items-center justify-end gap-1.5 text-xs text-muted-foreground">
          <span className={LEGEND_CHIP}>
            <svg width="14" height="8" aria-hidden className="text-chart-1">
              <line x1="1" y1="4" x2="13" y2="4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            {valueLabel}
          </span>
          <span className={LEGEND_CHIP}>
            <svg width="14" height="8" aria-hidden className="text-chart-muted">
              <line x1="1" y1="4" x2="13" y2="4" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2.5" />
            </svg>
            {compareLabel}
          </span>
        </div>
      ) : null}
      <div ref={boxRef} className={cn("relative w-full", className ?? "h-64 sm:h-72")}>
        {width > 0 && H > 0 ? (
          <svg
            width={width}
            height={H}
            role="img"
            aria-label={ariaLabel}
            tabIndex={0}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
            className="block touch-pan-y select-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            <defs>
              {/* currentColor resolves where the gradient is defined: the
                  vivid lime fills, the deeper chart-1 draws the line. */}
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1" className="text-lime">
                <stop offset="0%" stopColor="currentColor" stopOpacity={0.42} />
                <stop offset="70%" stopColor="currentColor" stopOpacity={0.08} />
                <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
              </linearGradient>
            </defs>

            {ticks.map((v) => (
              <g key={v}>
                <line
                  x1={pad.left}
                  x2={width - pad.right}
                  y1={y(v)}
                  y2={y(v)}
                  className="stroke-border"
                  strokeWidth={1}
                  strokeDasharray={v === 0 ? undefined : "2 5"}
                />
                <text
                  x={pad.left - 8}
                  y={y(v)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-muted-foreground text-[11px] tabular-nums"
                >
                  {formatAxis(v)}
                </text>
              </g>
            ))}

            {points.map((p, i) =>
              i % labelStep === 0 ? (
                <text
                  key={p.date}
                  x={x(i)}
                  y={H - 6}
                  textAnchor={
                    x(i) + 18 > width ? "end" : x(i) - 18 < pad.left - 8 ? "start" : "middle"
                  }
                  className={cn(
                    "text-[11px] tabular-nums",
                    active === i ? "fill-foreground font-medium" : "fill-muted-foreground"
                  )}
                >
                  {ddmm(p.date)}
                </text>
              ) : null
            )}

            {cmpRuns.map((d, i) => (
              <path
                key={i}
                d={d}
                fill="none"
                strokeWidth={1.75}
                strokeDasharray="4 4"
                strokeLinejoin="round"
                strokeLinecap="round"
                className="stroke-chart-muted"
              />
            ))}

            <g className="text-chart-1">
              {area ? <path d={area} fill={`url(#${gradId})`} /> : null}
              <path
                d={line}
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {n <= 3
                ? curPts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3.5} fill="currentColor" />)
                : null}
            </g>

            {ap && active !== null ? (
              <g pointerEvents="none">
                <line
                  x1={activeX}
                  x2={activeX}
                  y1={pad.top}
                  y2={pad.top + plotH}
                  className="stroke-foreground"
                  strokeOpacity={0.25}
                  strokeDasharray="2 3"
                />
                {hasCompare && ap.compare != null ? (
                  <circle
                    cx={activeX}
                    cy={y(ap.compare)}
                    r={4}
                    className="fill-chart-muted stroke-card"
                    strokeWidth={2}
                  />
                ) : null}
                <circle cx={activeX} cy={y(ap.value)} r={11} className="fill-lime/30" />
                <circle
                  cx={activeX}
                  cy={y(ap.value)}
                  r={5.5}
                  className="fill-chart-1 stroke-card"
                  strokeWidth={2.5}
                />
              </g>
            ) : null}

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

        <p className="sr-only" aria-live="polite">
          {ap
            ? `${weekday(ap.date)} ${ddmm(ap.date)}: ${valueLabel} ${formatValue(ap.value)}${
                hasCompare && ap.compare != null ? `, ${compareLabel} ${formatValue(ap.compare)}` : ""
              }`
            : ""}
        </p>
        {ap && width > 0 ? (
          // Dark rounded tooltip card (benchmarks 3 / 4) in both themes.
          <div
            aria-hidden
            className="pointer-events-none absolute z-10 rounded-2xl bg-tooltip p-3 text-xs text-tooltip-foreground shadow-raised"
            style={{ left: tipLeft, top: pad.top, width: TIP_W }}
          >
            <p className="font-medium tabular-nums text-tooltip-foreground/70">
              {weekday(ap.date)} {ddmm(ap.date)}
            </p>
            <div className="mt-1.5 space-y-1 tabular-nums">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-tooltip-foreground/70">
                  <span className="h-2 w-2 rounded-full bg-lime" />
                  {valueLabel}
                </span>
                <span className="text-sm font-semibold">{formatValue(ap.value)}</span>
              </div>
              {hasCompare ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5 text-tooltip-foreground/70">
                    <span className="h-2 w-2 rounded-full border border-current" />
                    {compareLabel}
                  </span>
                  <span>{ap.compare != null ? formatValue(ap.compare) : "-"}</span>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
