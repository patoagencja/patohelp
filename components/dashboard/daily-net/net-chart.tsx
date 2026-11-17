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
import type { CumulativePoint } from "@/lib/daily-net/calc";
import { compactPln } from "@/lib/season/format";
import { cn, formatPlnWhole } from "@/lib/utils";

const MONTH = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"];
const EASE = "cubic-bezier(.2,.8,.2,1)";
const dayMonth = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTH[Number(iso.slice(5, 7)) - 1]}`;
const MOMENT_SHORT: Record<string, string> = { "black-friday": "BF", "cyber-monday": "CM" };

/**
 * "Zostaje po reklamach" running total: this period (lime, up to the last
 * finished day) over last year's matched days (dashed, the whole axis), in
 * the season chart's look. Unlike sales, the net can dip below zero (a day
 * of heavy spend before the orders come in), so the axis spans negatives
 * and zero gets its own stronger line.
 */
export function NetCumulativeChart({
  points,
  curLabel,
  lyLabel,
}: {
  points: CumulativePoint[];
  /** "Sezon 2026" / "Ten okres". */
  curLabel: string;
  /** "Sezon 2025" / "Rok temu". */
  lyLabel: string;
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
  const hasLy = points.some((p) => p.ly !== null);
  const lastCurIdx = points.reduce((at, p, i) => (p.cur !== null ? i : at), -1);

  const { ticks, lo, hi } = useMemo(() => {
    const vals = points.flatMap((p) => [p.cur, p.ly]).filter((v): v is number => v !== null);
    const max = Math.max(0, ...vals);
    const min = Math.min(0, ...vals);
    const step = niceStep(Math.max(1, max - min) / 4);
    const top = Math.max(step, Math.ceil((max * 1.04) / step) * step);
    const bottom = min < 0 ? Math.floor((min * 1.04) / step) * step : 0;
    const out: number[] = [];
    for (let v = bottom; v <= top + step / 2; v += step) out.push(Math.round(v));
    return { ticks: out, lo: bottom, hi: top };
  }, [points]);

  const { w: width, h: H } = size;
  const narrow = width > 0 && width < 520;
  // On a phone "zł" on every tick eats a third of the plot; the card says the unit.
  const fmtAxis = (v: number) => (narrow ? compactPln(v).replace(/\s?zł$/, "") : compactPln(v));
  const longest = Math.max(...ticks.map((v) => fmtAxis(v).length));
  const pad = { top: 26, right: 14, bottom: 28, left: Math.round(longest * 6.7 + 16) };
  const plotW = Math.max(1, width - pad.left - pad.right);
  const plotH = Math.max(1, H - pad.top - pad.bottom);
  const x = (i: number) => pad.left + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (v: number) => pad.top + plotH * (1 - (v - lo) / (hi - lo || 1));

  const curPts = points.flatMap((p, i) => (p.cur === null ? [] : [{ x: x(i), y: y(p.cur) }]));
  const line = monotonePath(curPts);
  const zeroY = y(0);
  const area =
    curPts.length > 1
      ? `${line}L${curPts[curPts.length - 1].x.toFixed(2)},${zeroY.toFixed(2)}L${curPts[0].x.toFixed(2)},${zeroY.toFixed(2)}Z`
      : "";
  const lyLine = hasLy ? monotonePath(points.flatMap((p, i) => (p.ly === null ? [] : [{ x: x(i), y: y(p.ly) }]))) : "";

  const labelIdx = points
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => i === 0 || p.date.endsWith("-01") || (n <= 45 && i % 7 === 0))
    .map(({ i }) => i)
    .filter((i, k, all) => k === 0 || x(i) - x(all[k - 1]) >= 54);
  const moments = points
    .map((p, i) => ({ i, short: p.moment ? MOMENT_SHORT[p.moment] : undefined }))
    .filter((m): m is { i: number; short: string } => Boolean(m.short));

  const onPointer = (e: PointerEvent<SVGRectElement>) => {
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg || n === 0) return;
    const rect = svg.getBoundingClientRect();
    const rel = (e.clientX - rect.left - pad.left) / plotW;
    setActive(Math.min(n - 1, Math.max(0, Math.round(rel * (n - 1)))));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (n === 0) return;
    const start = lastCurIdx >= 0 ? lastCurIdx : n - 1;
    const at = active ?? start;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = Math.min(n - 1, active === null ? start : at + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, active === null ? start : at - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else if (e.key === "Escape") return setActive(null);
    if (next !== null) {
      e.preventDefault();
      setActive(next);
    }
  };

  const ap = active !== null ? points[active] : null;
  const dotX = active !== null ? x(active) : 0;
  const dotY = ap ? y(ap.cur ?? ap.ly ?? 0) : 0;
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
  const diff = ap && ap.cur !== null && ap.ly !== null ? ap.cur - ap.ly : null;
  const last = lastCurIdx >= 0 ? points[lastCurIdx] : null;
  const summary = last
    ? `${curLabel}: ${formatPlnWhole(last.cur ?? 0)} zostało po reklamach do ${dayMonth(last.date)}${
        hasLy && last.ly !== null ? `, ${lyLabel.toLowerCase()}: ${formatPlnWhole(last.ly)}` : ""
      }.`
    : "Brak zakończonych dni w tym okresie.";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-ink-2">
        <span className="inline-flex items-center gap-2">
          <i aria-hidden className="h-[3px] w-[18px] rounded-sm bg-[hsl(var(--lime-line))] shadow-[0_0_8px_var(--lime-glow)]" />
          {curLabel}
        </span>
        {hasLy ? (
          <span className="inline-flex items-center gap-2">
            <i aria-hidden className="w-[18px] border-t-2 border-dashed border-[color:var(--prev)]" />
            {lyLabel}
          </span>
        ) : (
          <span className="text-ink-3">brak zeszłego roku w panelu</span>
        )}
      </div>

      <div ref={boxRef} className="relative h-64 w-full cursor-crosshair sm:h-72">
        {width > 0 && H > 0 ? (
          <svg
            width={width}
            height={H}
            role="img"
            aria-label={`Zostaje po reklamach narastająco. ${summary}`}
            tabIndex={0}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
            className="relative block touch-pan-y select-none overflow-visible outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-card"
          >
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--lime-hex)" stopOpacity={0.3} />
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
                  stroke={v === 0 ? "var(--ink-3)" : "var(--line)"}
                  strokeOpacity={v === 0 ? 0.6 : 1}
                />
                <text x={pad.left - 10} y={y(v)} dy="0.32em" textAnchor="end" className="fill-[var(--ink-3)] font-mono text-[11px] tabular-nums">
                  {fmtAxis(v)}
                </text>
              </g>
            ))}

            {labelIdx.map((i) => (
              <text
                key={i}
                x={x(i)}
                y={H - 6}
                textAnchor={i === 0 ? "start" : "middle"}
                className="fill-[var(--ink-3)] font-mono text-[11px] tabular-nums"
              >
                {dayMonth(points[i].date)}
              </text>
            ))}

            {moments.map((m, k) => (
              <g key={m.i}>
                <line x1={x(m.i)} x2={x(m.i)} y1={pad.top - 4} y2={pad.top + plotH} stroke="var(--ink-3)" strokeOpacity={0.45} strokeDasharray="2 4" />
                <text
                  x={x(m.i)}
                  y={pad.top - 10}
                  visibility={k > 0 && x(m.i) - x(moments[k - 1].i) < 30 ? "hidden" : undefined}
                  textAnchor={x(m.i) > width - 40 ? "end" : "middle"}
                  className="fill-[var(--ink-2)] font-mono text-[10.5px] tracking-[0.04em]"
                >
                  {m.short}
                </text>
              </g>
            ))}

            {area ? <path d={area} fill={`url(#${gradId})`} className="animate-fade" style={{ "--d": ".5s" } as CSSProperties} /> : null}
            {lyLine ? (
              <path
                d={lyLine}
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
            {lastCurIdx >= 0 && active === null && points[lastCurIdx].cur !== null ? (
              <circle
                cx={x(lastCurIdx)}
                cy={y(points[lastCurIdx].cur ?? 0)}
                r={5}
                fill="hsl(var(--lime-line))"
                className="stroke-card"
                strokeWidth={2}
              />
            ) : null}
            {ap && ap.ly !== null ? <circle cx={dotX} cy={y(ap.ly)} r={4} fill="var(--prev)" className="stroke-card" strokeWidth={2} /> : null}
            {ap && ap.cur !== null ? (
              <circle cx={dotX} cy={y(ap.cur)} r={5} fill="hsl(var(--lime-line))" className="stroke-card" strokeWidth={2} />
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

        {ap && width > 0 ? (
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
                {dayMonth(ap.date)} · łącznie
              </span>
              <b className="whitespace-nowrap text-lg font-medium tracking-[-0.02em] tabular-nums">
                {ap.cur !== null ? formatPlnWhole(ap.cur) : "jeszcze przed nami"}
              </b>
              {hasLy ? (
                <span className="whitespace-nowrap text-ink-3 tabular-nums">
                  {lyLabel.toLowerCase()} ({dayMonth(ap.lyDate)}): {ap.ly !== null ? formatPlnWhole(ap.ly) : "-"}
                </span>
              ) : null}
              {diff !== null ? (
                <span className={cn("font-medium tabular-nums", diff >= 0 ? "text-positive" : "text-negative")}>
                  {diff >= 0 ? "+" : "-"}
                  {formatPlnWhole(Math.abs(diff))} {diff >= 0 ? "więcej" : "mniej"} niż wtedy
                </span>
              ) : null}
            </div>
          </>
        ) : null}

        <p className="sr-only" aria-live="polite">
          {ap
            ? `${dayMonth(ap.date)}: ${curLabel} ${ap.cur !== null ? formatPlnWhole(ap.cur) : "brak danych"}${
                hasLy && ap.ly !== null ? `, ${lyLabel} ${formatPlnWhole(ap.ly)}` : ""
              }`
            : ""}
        </p>
      </div>
    </div>
  );
}
