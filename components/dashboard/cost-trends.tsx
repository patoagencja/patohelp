"use client";

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { InfoTip } from "@/components/dashboard/info-tip";
import { GLOSSARY, describeChange } from "@/lib/dashboard/glossary";
import type { CostTrendPoint } from "@/lib/dashboard/metrics";
import { cn, formatMoneyPLN } from "@/lib/utils";

// Inline-SVG dual line chart. Deliberately NOT Tremor's LineChart -
// Recharts-based charts repeatedly fail to render in this app; pure SVG
// always paints. The plot is a stretchy 0-100 viewBox; axis labels, the
// crosshair dots and the tooltip are HTML positioned in % on top of it, so
// they stay crisp and undistorted at phone width. Client-side only for the
// hover/keyboard tooltip - the lines themselves need no state.

type Lang = "pl" | "en";

interface Series {
  name: string;
  /** text-chart-* class; strokes, fills and dots use currentColor. Same
   *  colour as the platform's dot in the campaign list and budget bars. */
  color: string;
  points: Array<{ i: number; value: number }>;
}

const LEGEND_CHIP = "inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1";

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Fewer days than this on either end and a "cheaper/pricier" claim is noise.
const MIN_EDGE_DAYS = 3;

/**
 * Change between the first and the last week of the period (or thirds, for
 * short ranges). Comparing edges rather than two single days keeps one odd
 * day from flipping the story.
 */
function edgeChange(values: number[]): number | null {
  const edge = Math.min(7, Math.floor(values.length / 3));
  if (edge < MIN_EDGE_DAYS) return null;
  const start = mean(values.slice(0, edge));
  const end = mean(values.slice(-edge));
  if (start <= 0) return null;
  return ((end - start) / start) * 100;
}

/**
 * The sentence above the chart: which platform's click is cheaper, by how
 * much, and whether clicks got cheaper or pricier over the period. Averages
 * are plain means of daily CPC - "średnio" is honest about that.
 */
function takeaway(series: Series[], lang: Lang): string {
  const en = lang === "en";
  const stats = series.map((s) => {
    const values = s.points.map((p) => p.value);
    return { name: s.name, avg: mean(values), change: edgeChange(values) };
  });

  const trendPart = (st: (typeof stats)[number]) =>
    `${st.name} ${describeChange(st.change, "cost", { lang })}`;
  // describeChange's "no previous data" wording doesn't fit here; drop it.
  const trends = stats.filter((st) => st.change !== null).map(trendPart);
  const trendSentence = trends.length
    ? en
      ? ` By the end of the period: ${trends.join("; ")}.`
      : ` Pod koniec okresu: ${trends.join("; ")}.`
    : "";

  if (stats.length === 1) {
    const [only] = stats;
    return en
      ? `A click on ${only.name} costs ${formatMoneyPLN(Math.round(only.avg))} on average.${trendSentence}`
      : `Kliknięcie w reklamę ${only.name} kosztuje średnio ${formatMoneyPLN(Math.round(only.avg))}.${trendSentence}`;
  }

  const [cheap, dear] = [...stats].sort((a, b) => a.avg - b.avg);
  const ratio = cheap.avg > 0 ? dear.avg / cheap.avg : 1;
  const prices = `${formatMoneyPLN(Math.round(cheap.avg))} vs ${formatMoneyPLN(Math.round(dear.avg))}`;
  let lead: string;
  if (ratio < 1.1) {
    lead = en
      ? `A click costs about the same on ${cheap.name} and ${dear.name} (${prices}).`
      : `Kliknięcie kosztuje podobnie w ${cheap.name} i ${dear.name} (${prices}).`;
  } else if (ratio >= 1.8) {
    const times = ratio.toLocaleString(en ? "en-GB" : "pl-PL", { maximumFractionDigits: 1 });
    lead = en
      ? `A click on ${cheap.name} is about ${times}× cheaper than on ${dear.name} (${prices}).`
      : `Kliknięcie w ${cheap.name} jest ok. ${times}× tańsze niż w ${dear.name} (${prices}).`;
  } else {
    const pct = Math.round((1 - cheap.avg / dear.avg) * 100);
    lead = en
      ? `A click on ${cheap.name} is about ${pct}% cheaper than on ${dear.name} (${prices}).`
      : `Kliknięcie w ${cheap.name} jest ok. ${pct}% tańsze niż w ${dear.name} (${prices}).`;
  }
  return lead + trendSentence;
}

export function CostTrends({
  costTrend: raw,
  lang = "pl",
  className,
}: {
  costTrend: CostTrendPoint[];
  lang?: Lang;
  className?: string;
}) {
  const en = lang === "en";
  const cpc = GLOSSARY.cpc;
  // Trim leading/trailing days with no data at all, so a range that starts
  // before the data does (e.g. before the backfill horizon) doesn't squash
  // the lines into a corner of an empty axis.
  const hasData = (p: CostTrendPoint) =>
    p.metaCpcMinorUnits != null || p.googleCpcMinorUnits != null;
  const first = raw.findIndex(hasData);
  const last = raw.length - 1 - [...raw].reverse().findIndex(hasData);
  const costTrend = first === -1 ? [] : raw.slice(first, last + 1);
  const n = costTrend.length;

  const series: Series[] = [
    {
      name: "Meta",
      color: "text-chart-1",
      points: costTrend
        .map((p, i) => ({ i, value: p.metaCpcMinorUnits }))
        .filter((p): p is { i: number; value: number } => p.value != null),
    },
    {
      name: "Google",
      color: "text-chart-2",
      points: costTrend
        .map((p, i) => ({ i, value: p.googleCpcMinorUnits }))
        .filter((p): p is { i: number; value: number } => p.value != null),
    },
  ].filter((s) => s.points.length > 0);

  const allValues = series.flatMap((s) => s.points.map((p) => p.value));
  const max = allValues.length ? Math.max(...allValues) : 0;
  const min = 0; // CPC axis starts at zero for honest proportions
  const span = max - min || 1;

  // Plot coordinates in % of the plot box (top = 0). A little headroom
  // keeps the highest day off the top edge.
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 50);
  const y = (v: number) => 100 - ((v - min) / (span * 1.08)) * 100;

  // 3 gridlines with PLN labels: 0, half, top.
  const ticks = [0, 0.5, 1].map((f) => min + f * span);

  // ~6 x-axis date labels (every other one hides on phones).
  const labelEvery = Math.max(1, Math.ceil(n / 6));
  const xLabels = costTrend
    .map((p, i) => ({ i, date: p.date }))
    .filter(({ i }) => i % labelEvery === 0 && i < n - Math.ceil(labelEvery / 2));

  const path = (s: Series) =>
    s.points
      .map((p, idx) => `${idx === 0 ? "M" : "L"}${x(p.i).toFixed(2)},${y(p.value).toFixed(2)}`)
      .join(" ");

  const empty = series.length === 0 || n < 2;

  // Area under a line, closed along the zero axis (y = 100).
  const area = (s: Series) => {
    const pts = s.points;
    if (pts.length < 2) return "";
    return `${path(s)} L${x(pts[pts.length - 1].i).toFixed(2)},100 L${x(pts[0].i).toFixed(2)},100 Z`;
  };

  const valueAt = (s: Series, i: number) => s.points.find((p) => p.i === i)?.value ?? null;
  const ddmm = (date: string) => {
    const [, month, day] = date.split("-");
    return `${Number(day)}.${month}`;
  };

  return (
    <section className={cn("surface p-5 sm:p-6", className)}>
      {/* ⓘ sits beside the heading, not inside it, so the heading's
          accessible name stays just the title. */}
      <div className="flex items-center gap-1.5">
        <h2 className="text-section-title text-foreground">
          {en ? "What one click costs" : "Ile kosztuje jedno kliknięcie"}
        </h2>
        <InfoTip
          label={en ? cpc.en.name : cpc.name}
          text={en ? cpc.en.explain : cpc.explain}
          lang={lang}
        />
      </div>
      {empty ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {series.length === 0
            ? en
              ? "No click cost data in this period - it appears once the ads get their first clicks."
              : "Brak danych o koszcie kliknięcia w tym okresie - pojawią się, gdy reklamy zbiorą pierwsze kliknięcia."
            : en
              ? `${takeaway(series, lang)} A trend needs a few more days of data.`
              : `${takeaway(series, lang)} Na wykres trendu potrzeba jeszcze kilku dni danych.`}
        </p>
      ) : (
        <>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground tabular-nums">
            {takeaway(series, lang)}
          </p>
          {/* Legend as small chips (like the overview chart); every line is
              also named at its right end, so colour is never the only cue. */}
          <ul
            className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
            aria-label={en ? "Legend" : "Legenda"}
          >
            {series.map((s) => (
              <li key={s.name} className={LEGEND_CHIP}>
                <svg width="14" height="8" aria-hidden className={s.color}>
                  <line x1="1" y1="4" x2="13" y2="4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
                {s.name}
              </li>
            ))}
          </ul>
          <CostPlot
            series={series}
            n={n}
            dates={costTrend.map((p) => p.date)}
            ticks={ticks}
            min={min}
            x={x}
            y={y}
            path={path}
            area={area}
            valueAt={valueAt}
            ddmm={ddmm}
            xLabels={xLabels}
            ariaLabel={`${en ? "Daily cost per click" : "Dzienny koszt kliknięcia"}. ${takeaway(series, lang)}`}
            lang={lang}
          />
        </>
      )}
    </section>
  );
}

const WEEKDAY: Record<Lang, string[]> = {
  pl: ["nd.", "pon.", "wt.", "śr.", "czw.", "pt.", "sob."],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};

function CostPlot({
  series,
  n,
  dates,
  ticks,
  min,
  x,
  y,
  path,
  area,
  valueAt,
  ddmm,
  xLabels,
  ariaLabel,
  lang,
}: {
  series: Series[];
  n: number;
  dates: string[];
  ticks: number[];
  min: number;
  x: (i: number) => number;
  y: (v: number) => number;
  path: (s: Series) => string;
  area: (s: Series) => string;
  valueAt: (s: Series, i: number) => number | null;
  ddmm: (date: string) => string;
  xLabels: Array<{ i: number; date: string }>;
  ariaLabel: string;
  lang: Lang;
}) {
  const en = lang === "en";
  const uid = useId().replace(/:/g, "");
  const boxRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);

  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return;
    const f = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    setActive(Math.round(f * (n - 1)));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      setActive((a) => Math.min(n - 1, Math.max(0, (a ?? (step > 0 ? -1 : n)) + step)));
    } else if (e.key === "Escape") {
      setActive(null);
    }
  };
  const weekday = (date: string) => WEEKDAY[lang][new Date(`${date}T12:00:00Z`).getUTCDay()];
  const rows =
    active == null
      ? []
      : series.map((s) => ({ s, v: valueAt(s, active) }));
  const announce =
    active == null
      ? ""
      : `${weekday(dates[active])} ${ddmm(dates[active])}: ${rows
          .map((r) => `${r.s.name} ${r.v != null ? formatMoneyPLN(Math.round(r.v)) : en ? "no data" : "brak danych"}`)
          .join(", ")}`;
  // Flip the tooltip to the left of the crosshair past the middle.
  const tipLeft = active != null ? x(active) : 0;
  const flip = tipLeft > 55;

  return (
    <div className="relative mt-4 h-52 pb-6 pl-14 pr-1 sm:h-64 sm:pr-20">
      <div
        ref={boxRef}
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setActive(null);
        }}
        className="relative h-full w-full touch-pan-y select-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-card"
      >
        {ticks.map((t) => (
          <span
            key={t}
            aria-hidden
            className="absolute -left-14 w-12 -translate-y-1/2 text-right text-[11px] tabular-nums text-muted-foreground"
            style={{ top: `${y(t)}%` }}
          >
            {formatMoneyPLN(Math.round(t))}
          </span>
        ))}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
          className="absolute inset-0 h-full w-full overflow-visible"
        >
          <defs>
            {series.map((s, k) => (
              // currentColor resolves where the gradient is defined: the
              // first (green) series takes the vivid lime wash like the
              // overview chart; the second only a whisper of its own colour
              // so two areas never muddy each other.
              <linearGradient
                key={s.name}
                id={`${uid}-g${k}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
                className={k === 0 ? "text-lime" : s.color}
              >
                <stop offset="0%" stopColor="currentColor" stopOpacity={k === 0 ? 0.38 : 0.12} />
                <stop offset="75%" stopColor="currentColor" stopOpacity={k === 0 ? 0.06 : 0.02} />
                <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          {ticks.map((t) => (
            <line
              key={t}
              x1={0}
              x2={100}
              y1={y(t)}
              y2={y(t)}
              className="stroke-border"
              strokeWidth="1"
              strokeDasharray={t === min ? undefined : "2 5"}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {/* Areas behind every line; the second series' area first. */}
          {[...series].reverse().map((s) => (
            <path
              key={`a-${s.name}`}
              d={area(s)}
              fill={`url(#${uid}-g${series.indexOf(s)})`}
            />
          ))}
          {series.map((s) => (
            <path
              key={s.name}
              d={path(s)}
              fill="none"
              stroke="currentColor"
              className={s.color}
              strokeWidth={2.25}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {active != null ? (
            <line
              x1={x(active)}
              x2={x(active)}
              y1={0}
              y2={100}
              className="stroke-foreground"
              strokeOpacity={0.25}
              strokeDasharray="2 3"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>

        {/* Direct labels at each line's end. Desktop: in the right gutter;
            phones have no room for a gutter, so they sit just above the
            line's last point inside the plot. */}
        {series.map((s) => {
          const last = s.points[s.points.length - 1];
          return (
            <span
              key={`end-${s.name}`}
              aria-hidden
              className="absolute right-0 flex -translate-y-[calc(100%+5px)] items-center gap-1 whitespace-nowrap rounded-full bg-card/85 px-1 text-[11px] font-medium leading-none text-foreground sm:left-full sm:right-auto sm:ml-2 sm:-translate-y-1/2 sm:bg-transparent sm:px-0"
              style={{ top: `${y(last.value)}%` }}
            >
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full bg-current", s.color)} />
              {s.name}
            </span>
          );
        })}

        {/* Hover dots (HTML, so they stay round in the stretched plot). */}
        {rows.map(({ s, v }) =>
          v != null && active != null ? (
            <span
              key={`dot-${s.name}`}
              aria-hidden
              className={cn(
                "pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current ring-[3px] ring-card",
                s.color
              )}
              style={{ left: `${x(active)}%`, top: `${y(v)}%` }}
            />
          ) : null
        )}

        {xLabels.map(({ i, date }, k) => (
          <span
            key={date}
            aria-hidden
            className={cn(
              "absolute top-full mt-1.5 -translate-x-1/2 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground",
              k % 2 === 1 && "hidden sm:block",
              i === 0 && "translate-x-0"
            )}
            style={{ left: `${x(i)}%` }}
          >
            {ddmm(date)}
          </span>
        ))}

        {active != null ? (
          // Dark rounded tooltip card, same as the overview chart.
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute top-0 z-10 w-40 rounded-2xl bg-tooltip p-3 text-xs text-tooltip-foreground shadow-raised",
              flip ? "-translate-x-[calc(100%+0.75rem)]" : "translate-x-3"
            )}
            style={{ left: `${tipLeft}%` }}
          >
            <p className="font-medium tabular-nums text-tooltip-foreground/70">
              {weekday(dates[active])} {ddmm(dates[active])}
            </p>
            <div className="mt-1.5 space-y-1 tabular-nums">
              {rows.map(({ s, v }) => (
                <div key={s.name} className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5 text-tooltip-foreground/70">
                    {/* Lime stands in for the deep chart-1 green, which is
                        too dark to see on the dark card. */}
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        s.color === "text-chart-1" ? "bg-lime" : "border border-current"
                      )}
                    />
                    {s.name}
                  </span>
                  <span className="text-sm font-semibold">
                    {v != null ? formatMoneyPLN(Math.round(v)) : "-"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}
