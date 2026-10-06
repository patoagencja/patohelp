"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { cn } from "@/lib/utils";

/**
 * Small daily line chart in the overview's MainChart style (2026 pastel):
 * the series as a glowing lime line drawn in over a soft lime area, an
 * optional comparison dashed in --prev, hairline guides with mono labels, a
 * soft crosshair, a lime dot and a glass tooltip. An optional resting
 * marker ("najlepszy dzień") shows while nothing is hovered. Shared by
 * "Sprzedaż dzień po dniu" and "Wizyty na stronie dzień po dniu".
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
const MONTH_PL = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"];
const MONTH_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EASE = "cubic-bezier(.2,.8,.2,1)";

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
  highlightIndex,
  highlightNote,
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
  /** A point pinned while nothing is hovered (e.g. the best day). */
  highlightIndex?: number | null;
  /** Its tooltip tag ("najlepszy dzień"). */
  highlightNote?: string;
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
  // 11px mono digits are ~6.7px wide).
  const longest = Math.max(...ticks.map((v) => formatAxis(v).length));
  const pad = { top: 14, right: 14, bottom: 28, left: Math.round(longest * 6.7 + 16) };
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

  const labelStep = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 62))));

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
  const tipDate = (iso: string) => {
    const [, m, d] = iso.split("-").map(Number);
    return `${d} ${(lang === "en" ? MONTH_EN : MONTH_PL)[m - 1]} · ${weekday(iso).replace(".", "")}`.toUpperCase();
  };
  const resting =
    highlightIndex != null && highlightIndex >= 0 && highlightIndex < n ? highlightIndex : null;
  // Hover / keyboard wins; otherwise the pinned point (if any) shows.
  const shownIdx = active ?? resting;
  const ap = active !== null ? points[active] : null;
  const sp = shownIdx !== null ? points[shownIdx] : null;
  const spX = shownIdx !== null ? x(shownIdx) : 0;
  const spY = sp ? y(sp.value) : 0;
  const xPct = width > 0 ? spX / width : 0.5;
  // Tooltip beside the dot near the edges, above it (below when the dot is
  // near the top) elsewhere - the MainChart rule.
  const tipTransform =
    xPct > 0.78
      ? "translate(calc(-100% - 18px), -50%)"
      : xPct < 0.16
        ? "translate(18px, -50%)"
        : spY < 96
          ? "translate(-50%, 22px)"
          : "translate(-50%, calc(-100% - 22px))";
  const move = { transition: `left .25s ${EASE}, top .25s ${EASE}` };

  return (
    <div>
      {hasCompare ? (
        <div className="mb-3 flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-[13px] text-ink-2">
          <span className="inline-flex items-center gap-2">
            <i
              aria-hidden
              className="h-[3px] w-[18px] rounded-sm bg-[hsl(var(--lime-line))] shadow-[0_0_8px_var(--lime-glow)]"
            />
            {valueLabel}
          </span>
          <span className="inline-flex items-center gap-2">
            <i aria-hidden className="w-[18px] border-t-2 border-dashed border-[color:var(--prev)]" />
            {compareLabel}
          </span>
        </div>
      ) : null}
      <div ref={boxRef} className={cn("relative w-full cursor-crosshair", className ?? "h-64 sm:h-72")}>
        {width > 0 && H > 0 ? (
          <svg
            width={width}
            height={H}
            role="img"
            aria-label={ariaLabel}
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
            </defs>

            {ticks.map((v) => (
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
                    x(i) + 20 > width ? "end" : x(i) - 20 < pad.left - 8 ? "start" : "middle"
                  }
                  className={cn(
                    "font-mono text-[11px] tabular-nums",
                    active === i ? "fill-foreground" : "fill-[var(--ink-3)]"
                  )}
                >
                  {ddmm(p.date)}
                </text>
              ) : null
            )}

            {area ? (
              <path
                d={area}
                fill={`url(#${gradId})`}
                className="animate-fade"
                style={{ "--d": ".7s" } as CSSProperties}
              />
            ) : null}

            {cmpRuns.map((d, i) => (
              <path
                key={i}
                d={d}
                fill="none"
                stroke="var(--prev)"
                strokeWidth={1.5}
                strokeDasharray="3 5"
                strokeLinejoin="round"
                strokeLinecap="round"
                className="animate-fade"
                style={{ "--d": "1s" } as CSSProperties}
              />
            ))}

            <path
              d={line}
              pathLength={1}
              fill="none"
              stroke="hsl(var(--lime-line))"
              strokeWidth={2.6}
              strokeLinejoin="round"
              strokeLinecap="round"
              className="draw-path animate-draw"
              style={{ "--d": ".3s", filter: "drop-shadow(0 4px 10px var(--lime-glow))" } as CSSProperties}
            />
            {n <= 3
              ? curPts.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={3.5} fill="hsl(var(--lime-line))" />
                ))
              : null}

            {hasCompare && ap && active !== null && ap.compare != null ? (
              <circle
                cx={x(active)}
                cy={y(ap.compare)}
                r={4}
                fill="var(--prev)"
                className="stroke-card"
                strokeWidth={2}
                pointerEvents="none"
              />
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

        {sp && width > 0 ? (
          <>
            {active !== null ? (
              <span
                aria-hidden
                className="pointer-events-none absolute w-px bg-[linear-gradient(180deg,transparent,var(--ink-3)_30%,var(--ink-3)_70%,transparent)] motion-reduce:!transition-none"
                style={{ left: spX, top: pad.top, bottom: pad.bottom, ...move }}
              />
            ) : null}
            <span
              aria-hidden
              className="pointer-events-none absolute -ml-2 -mt-2 h-4 w-4 rounded-full bg-[hsl(var(--lime-line))] shadow-[0_0_0_5px_var(--lime-glow),0_6px_16px_-4px_rgb(40_36_28/0.25)] motion-reduce:!transition-none"
              style={{ left: spX, top: spY, ...move }}
            />
            <div
              aria-hidden
              className="glass-tip pointer-events-none absolute z-10 flex max-w-[16rem] flex-col gap-1 rounded-[18px] px-3.5 py-3 text-[12.5px] motion-reduce:!transition-none print:hidden"
              style={{ left: spX, top: spY, transform: tipTransform, ...move }}
            >
              <span className="whitespace-nowrap font-mono text-[11px] tracking-[0.08em] text-ink-3">
                {tipDate(sp.date)}
                {active === null && highlightNote ? ` · ${highlightNote.toUpperCase()}` : ""}
              </span>
              <b className="whitespace-nowrap text-lg font-medium tracking-[-0.02em] tabular-nums">
                {formatValue(sp.value)}
              </b>
              {hasCompare ? (
                <span className="whitespace-nowrap text-ink-3 tabular-nums">
                  {compareLabel?.toLowerCase()} {sp.compare != null ? formatValue(sp.compare) : "-"}
                </span>
              ) : null}
            </div>
          </>
        ) : null}

        <p className="sr-only" aria-live="polite">
          {ap
            ? `${weekday(ap.date)} ${ddmm(ap.date)}: ${valueLabel} ${formatValue(ap.value)}${
                hasCompare && ap.compare != null ? `, ${compareLabel} ${formatValue(ap.compare)}` : ""
              }`
            : ""}
        </p>
      </div>
    </div>
  );
}
