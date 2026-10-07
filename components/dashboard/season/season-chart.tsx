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

import { monotonePath, niceStep } from "@/components/dashboard/trend-line-chart";
import type { SeasonDay } from "@/lib/season/load";
import { compactCount, compactPln } from "@/lib/season/format";
import { cn, formatNumberPL, formatPlnWhole } from "@/lib/utils";

const MONTH = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"];
const EASE = "cubic-bezier(.2,.8,.2,1)";

const dayMonth = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH[m - 1]}`;
};

type Mode = "cum" | "daily";

/**
 * The whole season on one axis: this season (lime, drawn up to today) over
 * the previous one (dashed, the full length), so "are we ahead and where is
 * this going" reads at a glance. "Narastająco" (running total) is the
 * default - daily sales of a gift business are spiky, the running total is
 * the honest comparison. The sales moments (Black Friday, Mikołajki,
 * Wigilia) are marked, since that is where seasons are won.
 */
export function SeasonChart({
  days: allDays,
  moments: allMoments,
  todayIdx,
  metric,
  seasonLabel,
  prevLabel,
}: {
  days: SeasonDay[];
  moments: Array<{ key: string; label: string; short: string; i: number }>;
  /** Today's position while the season runs. */
  todayIdx: number | null;
  /** What the lines show: sales from ads, or clicks for non-shop clients. */
  metric: "value" | "clicks";
  seasonLabel: string;
  prevLabel: string;
}) {
  const [mode, setMode] = useState<Mode>("cum");
  // Early in a season the whole-season scale squashes this season into a
  // flat line in the corner; "do dziś" zooms to the days that happened
  // (plus a week ahead of last season's line). Default follows progress.
  const [span, setSpan] = useState<"season" | "toDate">(() =>
    todayIdx !== null && todayIdx < allDays.length * 0.5 ? "toDate" : "season"
  );
  const visible =
    span === "toDate" && todayIdx !== null ? Math.min(allDays.length, todayIdx + 8) : allDays.length;
  const days = useMemo(() => allDays.slice(0, visible), [allDays, visible]);
  const moments = allMoments.filter((m) => m.i < visible);
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

  const pick = (d: SeasonDay, prev: boolean) =>
    metric === "value" ? (prev ? d.prevValue : d.value) : prev ? d.prevClicks : d.clicks;

  const { cur, prev } = useMemo(() => {
    const run = (prevSeries: boolean) => {
      let sum = 0;
      return days.map((d) => {
        const v = pick(d, prevSeries);
        if (v == null) return null;
        sum += v;
        return mode === "cum" ? sum : v;
      });
    };
    return { cur: run(false), prev: run(true) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, mode, metric]);

  const hasPrev = prev.some((v) => v != null && v > 0);
  const fmt = (v: number) => (metric === "value" ? formatPlnWhole(v) : formatNumberPL(v));
  const fmtAxis = (v: number) => (metric === "value" ? compactPln(v) : compactCount(v));

  const n = days.length;
  const { ticks, top } = useMemo(() => {
    const vals = [...cur, ...(hasPrev ? prev : [])].filter((v): v is number => v != null);
    const max = Math.max(0, ...vals);
    const step = niceStep((max || 1) / 4);
    const t = Math.max(step, Math.ceil((max * 1.04) / step) * step);
    const out: number[] = [];
    for (let v = 0; v <= t + step / 2; v += step) out.push(v);
    return { ticks: out, top: t };
  }, [cur, prev, hasPrev]);

  const { w: width, h: H } = size;
  const longest = Math.max(...ticks.map((v) => fmtAxis(v).length));
  const pad = { top: 30, right: 14, bottom: 28, left: Math.round(longest * 6.7 + 16) };
  const plotW = Math.max(1, width - pad.left - pad.right);
  const plotH = Math.max(1, H - pad.top - pad.bottom);
  const x = (i: number) => pad.left + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (v: number) => pad.top + plotH * (1 - v / top);

  const curPts = cur.flatMap((v, i) => (v == null ? [] : [{ x: x(i), y: y(v) }]));
  const lastCur = curPts.length - 1;
  const line = monotonePath(curPts);
  const area =
    curPts.length > 1
      ? `${line}L${curPts[lastCur].x.toFixed(2)},${pad.top + plotH}L${curPts[0].x.toFixed(2)},${pad.top + plotH}Z`
      : "";
  const prevLine = hasPrev
    ? monotonePath(prev.flatMap((v, i) => (v == null ? [] : [{ x: x(i), y: y(v) }])))
    : "";

  // Month starts as x labels ("1 paź"), thinned on narrow plots.
  // A zoomed (short) range gets weekly labels too, or it shows one label.
  const monthStarts = days
    .filter((d) => d.date.endsWith("-01") || d.i === 0 || (days.length <= 45 && d.i % 7 === 0))
    .map((d) => d.i);
  const minGap = 54;
  const xLabels = monthStarts.filter(
    (i, k) => k === 0 || x(i) - x(monthStarts[k - 1]) >= minGap
  );

  const onPointer = (e: PointerEvent<SVGRectElement>) => {
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg || n === 0) return;
    const rect = svg.getBoundingClientRect();
    const rel = (e.clientX - rect.left - pad.left) / plotW;
    setActive(Math.min(n - 1, Math.max(0, Math.round(rel * (n - 1)))));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (n === 0) return;
    const start = todayIdx ?? n - 1;
    const cur0 = active ?? start;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = Math.min(n - 1, active === null ? start : cur0 + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, active === null ? start : cur0 - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else if (e.key === "Escape") return setActive(null);
    if (next !== null) {
      e.preventDefault();
      setActive(next);
    }
  };

  const ad = active !== null ? days[active] : null;
  const av = active !== null ? cur[active] : null;
  const pv = active !== null ? prev[active] : null;
  const dotY = av != null ? y(av) : pv != null ? y(pv) : pad.top + plotH;
  const dotX = active !== null ? x(active) : 0;
  const xPct = width > 0 ? dotX / width : 0.5;
  const tipTransform =
    xPct > 0.72
      ? "translate(calc(-100% - 18px), -50%)"
      : xPct < 0.2
        ? "translate(18px, -50%)"
        : dotY < 110
          ? "translate(-50%, 22px)"
          : "translate(-50%, calc(-100% - 22px))";
  const move = { transition: `left .2s ${EASE}, top .2s ${EASE}` };
  const lead =
    av != null && pv != null && pv > 0 ? Math.round((av / pv - 1) * 100) : null;

  const unitWord = metric === "value" ? "Sprzedaż z reklam" : "Kliknięcia";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-3">
        <div role="radiogroup" aria-label="Widok wykresu" className="flex rounded-full bg-chip p-1 text-[13px]">
          {(
            [
              ["cum", "Narastająco"],
              ["daily", "Dzień po dniu"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={mode === key}
              onClick={() => setMode(key)}
              className={cn(
                "min-h-9 rounded-full px-3.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                mode === key ? "bg-anchor text-anchor-foreground" : "text-ink-2 hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {todayIdx !== null ? (
          <div role="radiogroup" aria-label="Zakres wykresu" className="flex rounded-full bg-chip p-1 text-[13px]">
            {(
              [
                ["toDate", "Do dziś"],
                ["season", "Cały sezon"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={span === key}
                onClick={() => {
                  setSpan(key);
                  setActive(null);
                }}
                className={cn(
                  "min-h-9 rounded-full px-3.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  span === key ? "bg-anchor text-anchor-foreground" : "text-ink-2 hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-ink-2 sm:ml-auto">
          <span className="inline-flex items-center gap-2">
            <i
              aria-hidden
              className="h-[3px] w-[18px] rounded-sm bg-[hsl(var(--lime-line))] shadow-[0_0_8px_var(--lime-glow)]"
            />
            {seasonLabel}
          </span>
          {hasPrev ? (
            <span className="inline-flex items-center gap-2">
              <i aria-hidden className="w-[18px] border-t-2 border-dashed border-[color:var(--prev)]" />
              {prevLabel}
            </span>
          ) : null}
        </div>
      </div>

      <div ref={boxRef} className="relative h-72 w-full cursor-crosshair sm:h-80">
        {width > 0 && H > 0 ? (
          <svg
            width={width}
            height={H}
            role="img"
            aria-label={`${unitWord} ${mode === "cum" ? "narastająco" : "dzień po dniu"}: ${seasonLabel} na tle ${prevLabel}`}
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
                <line x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} stroke="var(--line)" />
                <text
                  x={pad.left - 10}
                  y={y(v)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-[var(--ink-3)] font-mono text-[11px] tabular-nums"
                >
                  {fmtAxis(v)}
                </text>
              </g>
            ))}

            {xLabels.map((i) => (
              <text
                key={i}
                x={x(i)}
                y={H - 6}
                textAnchor={i === 0 ? "start" : "middle"}
                className="fill-[var(--ink-3)] font-mono text-[11px] tabular-nums"
              >
                {dayMonth(days[i].date)}
              </text>
            ))}

            {/* Sales moments: a hairline and a short tag above the plot. */}
            {moments.map((m, k) => (
              <g key={m.key}>
                <line
                  x1={x(m.i)}
                  x2={x(m.i)}
                  y1={pad.top - 4}
                  y2={pad.top + plotH}
                  stroke="var(--ink-3)"
                  strokeOpacity={0.45}
                  strokeDasharray="2 4"
                />
                <text
                  x={x(m.i)}
                  y={pad.top - 10}
                  // Moments a few days apart (BF / CM) share one tag on narrow plots.
                  visibility={k > 0 && x(m.i) - x(moments[k - 1].i) < 30 ? "hidden" : undefined}
                  textAnchor={x(m.i) > width - 40 ? "end" : "middle"}
                  className="fill-[var(--ink-2)] font-mono text-[10.5px] tracking-[0.04em]"
                >
                  <title>{m.label}</title>
                  {m.short}
                </text>
              </g>
            ))}

            {area ? (
              <path d={area} fill={`url(#${gradId})`} className="animate-fade" style={{ "--d": ".5s" } as CSSProperties} />
            ) : null}
            {prevLine ? (
              <path
                d={prevLine}
                fill="none"
                stroke="var(--prev)"
                strokeWidth={1.6}
                strokeDasharray="3 5"
                strokeLinecap="round"
                className="animate-fade"
                style={{ "--d": ".8s" } as CSSProperties}
              />
            ) : null}
            {line ? (
              <path
                key={`${mode}-${span}`}
                d={line}
                pathLength={1}
                fill="none"
                stroke="hsl(var(--lime-line))"
                strokeWidth={2.6}
                strokeLinejoin="round"
                strokeLinecap="round"
                className="draw-path animate-draw"
                style={{ "--d": ".2s", filter: "drop-shadow(0 4px 10px var(--lime-glow))" } as CSSProperties}
              />
            ) : null}

            {todayIdx !== null && todayIdx >= 0 && todayIdx < n ? (
              <g>
                <line
                  x1={x(todayIdx)}
                  x2={x(todayIdx)}
                  y1={pad.top}
                  y2={pad.top + plotH}
                  stroke="hsl(var(--lime-line))"
                  strokeOpacity={0.5}
                />
                {lastCur >= 0 && active === null ? (
                  <circle
                    cx={curPts[lastCur].x}
                    cy={curPts[lastCur].y}
                    r={5}
                    fill="hsl(var(--lime-line))"
                    className="stroke-card"
                    strokeWidth={2}
                  />
                ) : null}
              </g>
            ) : null}

            {active !== null && pv != null ? (
              <circle cx={x(active)} cy={y(pv)} r={4} fill="var(--prev)" className="stroke-card" strokeWidth={2} />
            ) : null}
            {active !== null && av != null ? (
              <circle cx={x(active)} cy={y(av)} r={5} fill="hsl(var(--lime-line))" className="stroke-card" strokeWidth={2} />
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

        {ad && width > 0 ? (
          <>
            <span
              aria-hidden
              className="pointer-events-none absolute w-px bg-[linear-gradient(180deg,transparent,var(--ink-3)_30%,var(--ink-3)_70%,transparent)] motion-reduce:!transition-none"
              style={{ left: dotX, top: pad.top, bottom: pad.bottom, ...move }}
            />
            <div
              aria-hidden
              className="glass-tip pointer-events-none absolute z-10 flex max-w-[17rem] flex-col gap-1 rounded-[18px] px-3.5 py-3 text-[12.5px] motion-reduce:!transition-none print:hidden"
              style={{ left: dotX, top: dotY, transform: tipTransform, ...move }}
            >
              <span className="whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
                {dayMonth(ad.date)} · dzień {ad.i + 1}
                {mode === "cum" ? " · łącznie" : ""}
              </span>
              <b className="whitespace-nowrap text-lg font-medium tracking-[-0.02em] tabular-nums">
                {av != null ? fmt(av) : "jeszcze przed nami"}
              </b>
              {hasPrev ? (
                <span className="whitespace-nowrap text-ink-3 tabular-nums">
                  {prevLabel.toLowerCase()}: {pv != null ? fmt(pv) : "-"}
                </span>
              ) : null}
              {lead !== null ? (
                <span className={cn("font-medium tabular-nums", lead >= 0 ? "text-positive" : "text-negative")}>
                  {lead >= 0 ? `${lead}% więcej` : `${Math.abs(lead)}% mniej`} niż wtedy
                </span>
              ) : null}
            </div>
          </>
        ) : null}

        <p className="sr-only" aria-live="polite">
          {ad
            ? `${dayMonth(ad.date)}: ${seasonLabel} ${av != null ? fmt(av) : "brak danych"}${
                hasPrev && pv != null ? `, ${prevLabel} ${fmt(pv)}` : ""
              }`
            : ""}
        </p>
      </div>
    </div>
  );
}
