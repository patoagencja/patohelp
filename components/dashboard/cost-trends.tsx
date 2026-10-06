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
  /** Stroke colour (CSS value). Meta is the page's lime line with a glow,
   *  Google a calm slate ink (Reklamy board `--c-google`). */
  stroke: string;
  /** Background class for dots and the legend glyph (same colour). */
  dot: string;
  /** The hero line gets the lime glow + area wash; the other stays bare. */
  hero: boolean;
  points: Array<{ i: number; value: number }>;
}

const META_STROKE = "hsl(var(--lime-line))";
const GOOGLE_STROKE = "var(--ink-2)";

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
      stroke: META_STROKE,
      dot: "bg-[hsl(var(--lime-line))]",
      hero: true,
      points: costTrend
        .map((p, i) => ({ i, value: p.metaCpcMinorUnits }))
        .filter((p): p is { i: number; value: number } => p.value != null),
    },
    {
      name: "Google",
      stroke: GOOGLE_STROKE,
      dot: "bg-ink-2",
      hero: false,
      points: costTrend
        .map((p, i) => ({ i, value: p.googleCpcMinorUnits }))
        .filter((p): p is { i: number; value: number } => p.value != null),
    },
  ].filter((s) => s.points.length > 0);

  const allValues = series.flatMap((s) => s.points.map((p) => p.value));
  const max = allValues.length ? Math.max(...allValues) : 0;
  const min = 0; // CPC axis starts at zero for honest proportions
  // Round tick steps (0,40 zł, not 0,397 zł): the top line sits on the
  // first round value above the priciest day, so it never touches the edge.
  const step = niceStep((max * 1.04) / 4);
  const top = step * 4;

  // Plot coordinates in % of the plot box (top = 0).
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 50);
  const y = (v: number) => 100 - ((v - min) / top) * 100;

  // 5 hairlines (board): 0, quarters, top; every other one is labelled on
  // phones so the axis never crowds.
  const ticks = [0, 1, 2, 3, 4].map((k) => min + k * step);

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
    return `${day}.${month}`;
  };
  const story = series.length ? takeaway(series, lang) : "";

  return (
    <section
      aria-labelledby="cost-trends-heading"
      className={cn("glass min-w-0 rounded-glass p-6 sm:p-[28px_30px]", className)}
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="kick">
            {en ? "Cost per click" : "Koszt kliknięcia"}
            {series.length > 1 ? ` · ${series.map((s) => s.name).join(" vs ")}` : ""}
          </p>
          {/* ⓘ sits beside the heading, not inside it, so the heading's
              accessible name stays just the title. */}
          <div className="mt-2 flex items-center gap-1.5">
            <h2 id="cost-trends-heading" className="text-[22px] font-medium tracking-[-0.03em]">
              {en ? "What one click costs" : "Ile kosztuje jedno kliknięcie"}
            </h2>
            <InfoTip
              label={en ? cpc.en.name : cpc.name}
              text={en ? cpc.en.explain : cpc.explain}
              lang={lang}
            />
          </div>
        </div>
        {/* Legend: line glyphs (the hero line glows), and every line is also
            named at its end, so colour is never the only cue. */}
        {!empty ? (
          <ul
            className="flex flex-wrap gap-x-4 gap-y-2 text-[13px] text-ink-2"
            aria-label={en ? "Legend" : "Legenda"}
          >
            {series.map((s) => (
              <li key={s.name} className="inline-flex items-center gap-2">
                <i
                  aria-hidden
                  className={cn(
                    "h-[3px] w-[18px] rounded-sm",
                    s.dot,
                    s.hero && "shadow-[0_0_8px_var(--lime-glow)]"
                  )}
                />
                {s.name}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {empty ? (
        <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-ink-2">
          {series.length === 0
            ? en
              ? "No click cost data in this period - it appears once the ads get their first clicks."
              : "Brak danych o koszcie kliknięcia w tym okresie - pojawią się, gdy reklamy zbiorą pierwsze kliknięcia."
            : en
              ? `${story} A trend needs a few more days of data.`
              : `${story} Na wykres trendu potrzeba jeszcze kilku dni danych.`}
        </p>
      ) : (
        <>
          <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-ink-2 tabular-nums">
            {story}
          </p>
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
            ariaLabel={`${en ? "Daily cost per click" : "Dzienny koszt kliknięcia"}. ${story}`}
            lang={lang}
          />
        </>
      )}
    </section>
  );
}

/** 1 / 2 / 2.5 / 5 x 10^k grosze, at least 1 grosz. */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return Math.max(1, nice * mag);
}

const WEEKDAY: Record<Lang, string[]> = {
  pl: ["nd.", "pon.", "wt.", "śr.", "czw.", "pt.", "sob."],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};

const EASE = "cubic-bezier(.2,.8,.2,1)";

/**
 * End labels never overlap: walk them top to bottom and push each one at
 * least `gap` (% of the plot height) below the previous one.
 */
function spreadLabels(tops: number[], gap: number): number[] {
  const order = tops.map((t, k) => ({ t, k })).sort((a, b) => a.t - b.t);
  const out = [...tops];
  let prev = -Infinity;
  for (const { t, k } of order) {
    const v = Math.max(t, prev + gap);
    out[k] = v;
    prev = v;
  }
  return out;
}

function CostPlot({
  series,
  n,
  dates,
  ticks,
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
  const ends = series.map((s) => s.points[s.points.length - 1]);
  const endTops = spreadLabels(
    ends.map((p) => y(p.value)),
    14
  );
  const hero = series.find((s) => s.hero);
  const move = { transition: `left .25s ${EASE}, top .25s ${EASE}` };

  return (
    <div className="relative mt-8 h-56 pb-7 pl-14 pr-1 sm:mt-10 sm:h-[17rem] sm:pr-[5.5rem]">
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
        className="relative h-full w-full cursor-crosshair touch-pan-y select-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
      >
        {ticks.map((t, k) => (
          <span
            key={t}
            aria-hidden
            className={cn(
              "absolute -left-14 w-12 -translate-y-1/2 text-right font-mono text-[11px] tabular-nums text-ink-3",
              k % 2 === 1 && "hidden sm:block"
            )}
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
            <linearGradient id={`${uid}-g`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--lime-hex)" stopOpacity={0.32} />
              <stop offset="0.6" stopColor="var(--lime-hex)" stopOpacity={0.06} />
              <stop offset="1" stopColor="var(--lime-hex)" stopOpacity={0} />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <line
              key={t}
              x1={0}
              x2={100}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--line)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {/* Only the hero line (Meta) gets the lime wash: two washes
              would muddy each other. */}
          {hero ? (
            <path
              d={area(hero)}
              fill={`url(#${uid}-g)`}
              className="animate-fade"
              style={{ "--d": ".5s" } as React.CSSProperties}
            />
          ) : null}
          {[...series].reverse().map((s) => (
            <path
              key={s.name}
              d={path(s)}
              fill="none"
              stroke={s.stroke}
              strokeWidth={s.hero ? 2.6 : 2.2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              className="animate-fade"
              style={
                {
                  "--d": s.hero ? ".3s" : ".5s",
                  filter: s.hero ? "drop-shadow(0 4px 10px var(--lime-glow))" : undefined,
                } as React.CSSProperties
              }
            />
          ))}
        </svg>

        {/* End dots + direct labels. Desktop: name and last price in the
            right gutter; phones have no gutter, so just the name sits above
            the line's last point inside the plot. */}
        {series.map((s, k) => {
          const end = ends[k];
          return (
            <span
              key={`dot-end-${s.name}`}
              aria-hidden
              className={cn(
                "pointer-events-none absolute -ml-[5px] -mt-[5px] h-2.5 w-2.5 rounded-full",
                s.dot,
                s.hero && "shadow-[0_0_0_4px_var(--lime-glow)]"
              )}
              style={{ left: `${x(end.i)}%`, top: `${y(end.value)}%` }}
            />
          );
        })}
        {series.map((s, k) => (
          <span
            key={`end-${s.name}`}
            aria-hidden
            className="absolute right-0 -translate-y-[calc(100%+8px)] whitespace-nowrap rounded-full bg-chip px-1.5 text-[11px] font-medium leading-4 text-foreground sm:left-full sm:right-auto sm:ml-3.5 sm:-translate-y-1/2 sm:bg-transparent sm:px-0 sm:text-[12.5px] sm:font-semibold sm:leading-tight"
            style={{ top: `${endTops[k]}%` }}
          >
            {s.name}
            <span className="hidden font-normal tabular-nums text-ink-3 sm:block">
              {formatMoneyPLN(Math.round(ends[k].value))}
            </span>
          </span>
        ))}

        {/* Crosshair + hover dots (HTML, so they stay round in the
            stretched plot). */}
        {active != null ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-px bg-[linear-gradient(180deg,transparent,var(--ink-3)_30%,var(--ink-3)_70%,transparent)] motion-reduce:!transition-none"
            style={{ left: `${x(active)}%`, ...move }}
          />
        ) : null}
        {rows.map(({ s, v }) =>
          v != null && active != null ? (
            <span
              key={`dot-${s.name}`}
              aria-hidden
              className={cn(
                "pointer-events-none absolute -ml-[7px] -mt-[7px] h-3.5 w-3.5 rounded-full border-2 border-[var(--g1)] motion-reduce:!transition-none",
                s.dot,
                s.hero && "shadow-[0_0_0_5px_var(--lime-glow)]"
              )}
              style={{ left: `${x(active)}%`, top: `${y(v)}%`, ...move }}
            />
          ) : null
        )}

        {xLabels.map(({ i, date }, k) => (
          <span
            key={date}
            aria-hidden
            className={cn(
              "absolute top-full mt-2.5 -translate-x-1/2 whitespace-nowrap font-mono text-[11px] tabular-nums text-ink-3",
              k % 2 === 1 && "hidden sm:block",
              i === 0 && "translate-x-0"
            )}
            style={{ left: `${x(i)}%` }}
          >
            {ddmm(date)}
          </span>
        ))}

        {active != null ? (
          // Glass tooltip, same as the overview chart.
          <div
            aria-hidden
            className={cn(
              "glass-tip pointer-events-none absolute top-0 z-10 flex w-44 flex-col gap-1.5 rounded-[18px] px-3.5 py-3 text-[12.5px] motion-reduce:!transition-none",
              flip ? "-translate-x-[calc(100%+0.875rem)]" : "translate-x-3.5"
            )}
            style={{ left: `${tipLeft}%`, ...move }}
          >
            <span className="whitespace-nowrap font-mono text-[11px] tracking-[0.08em] text-ink-3">
              {weekday(dates[active]).toUpperCase()} {ddmm(dates[active])}
            </span>
            {rows.map(({ s, v }) => (
              <span key={s.name} className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-ink-2">
                  <i className={cn("h-[3px] w-3 rounded-sm", s.dot)} />
                  {s.name}
                </span>
                <b className="text-[15px] font-medium tracking-[-0.02em] tabular-nums">
                  {v != null ? formatMoneyPLN(Math.round(v)) : "-"}
                </b>
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}
