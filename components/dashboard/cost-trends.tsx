import { Card } from "@tremor/react";

import { InfoTip } from "@/components/dashboard/info-tip";
import { GLOSSARY, describeChange } from "@/lib/dashboard/glossary";
import type { CostTrendPoint } from "@/lib/dashboard/metrics";
import { cn, formatMoneyPLN } from "@/lib/utils";

// Inline-SVG dual line chart (server component). Deliberately NOT Tremor's
// LineChart - Recharts-based charts repeatedly fail to render in this app;
// pure SVG always paints and needs no hydration.

const W = 640;
const H = 280;
const PAD = { top: 12, right: 12, bottom: 28, left: 56 };

type Lang = "pl" | "en";

interface Series {
  name: string;
  /** Tailwind stroke-* / bg-* classes - same blue/amber as the platform pills. */
  stroke: string;
  dot: string;
  points: Array<{ i: number; value: number }>;
}

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
}: {
  costTrend: CostTrendPoint[];
  lang?: Lang;
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
      stroke: "stroke-blue-500",
      dot: "bg-blue-500",
      points: costTrend
        .map((p, i) => ({ i, value: p.metaCpcMinorUnits }))
        .filter((p): p is { i: number; value: number } => p.value != null),
    },
    {
      name: "Google",
      stroke: "stroke-amber-500",
      dot: "bg-amber-500",
      points: costTrend
        .map((p, i) => ({ i, value: p.googleCpcMinorUnits }))
        .filter((p): p is { i: number; value: number } => p.value != null),
    },
  ].filter((s) => s.points.length > 0);

  const allValues = series.flatMap((s) => s.points.map((p) => p.value));
  const max = allValues.length ? Math.max(...allValues) : 0;
  const min = 0; // CPC axis starts at zero for honest proportions
  const span = max - min || 1;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const y = (v: number) => PAD.top + plotH - ((v - min) / span) * plotH;

  // 4 horizontal gridlines with PLN labels.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * span);

  // ~6 x-axis date labels.
  const labelEvery = Math.max(1, Math.ceil(n / 6));
  const xLabels = costTrend
    .map((p, i) => ({ i, date: p.date }))
    .filter(({ i }) => i % labelEvery === 0 || i === n - 1);

  const path = (s: Series) =>
    s.points.map((p, idx) => `${idx === 0 ? "M" : "L"}${x(p.i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");

  return (
    <Card>
      {/* ⓘ sits beside the heading, not inside it, so the heading's
          accessible name stays just the title. */}
      <div className="flex items-center gap-1.5">
        <h2 className="text-base font-semibold">
          {en ? "What one click costs - Meta vs Google" : "Ile kosztuje jedno kliknięcie - Meta vs Google"}
        </h2>
        <InfoTip
          label={en ? cpc.en.name : cpc.name}
          text={en ? cpc.en.explain : cpc.explain}
          lang={lang}
        />
      </div>
      {series.length === 0 || n < 2 ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            {series.length === 0
              ? en
                ? "No click cost data in this period - it appears once the ads get their first clicks."
                : "Brak danych o koszcie kliknięcia w tym okresie - pojawią się, gdy reklamy zbiorą pierwsze kliknięcia."
              : en
                ? `${takeaway(series, lang)} A trend needs a few more days of data.`
                : `${takeaway(series, lang)} Na wykres trendu potrzeba jeszcze kilku dni danych.`}
          </p>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground tabular-nums">
            {takeaway(series, lang)}
          </p>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="mt-4 h-64 w-full"
            preserveAspectRatio="none"
            role="img"
            aria-label={`${en ? "Daily cost per click" : "Dzienny koszt kliknięcia"}. ${takeaway(series, lang)}`}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y(t)}
                  y2={y(t)}
                  className="stroke-border"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                <text
                  x={PAD.left - 6}
                  y={y(t) + 3}
                  textAnchor="end"
                  className="fill-muted-foreground"
                  fontSize="10"
                >
                  {formatMoneyPLN(Math.round(t))}
                </text>
              </g>
            ))}
            {xLabels.map(({ i, date }) => {
              const [, month, day] = date.split("-");
              return (
                <text
                  key={date}
                  x={x(i)}
                  y={H - 8}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                  fontSize="10"
                >
                  {day}.{month}
                </text>
              );
            })}
            {series.map((s) => (
              <path
                key={s.name}
                d={path(s)}
                fill="none"
                className={s.stroke}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          <div className="mt-2 flex justify-center gap-4">
            {series.map((s) => (
              <span
                key={s.name}
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <span className={cn("h-2 w-2 rounded-full", s.dot)} aria-hidden />
                {s.name}
              </span>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
