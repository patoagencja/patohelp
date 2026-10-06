import { InfoTip } from "@/components/dashboard/info-tip";
import { GLOSSARY, describeChange } from "@/lib/dashboard/glossary";
import type { CostTrendPoint } from "@/lib/dashboard/metrics";
import { cn, formatMoneyPLN } from "@/lib/utils";

// Inline-SVG dual line chart (server component). Deliberately NOT Tremor's
// LineChart - Recharts-based charts repeatedly fail to render in this app;
// pure SVG always paints and needs no hydration. The plot is a stretchy
// 0-100 viewBox; axis labels are HTML positioned in % on top of it, so they
// stay crisp and undistorted at phone width.

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

  return (
    <section className={cn("surface p-5 sm:p-6", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
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
        {!empty ? (
          <ul className="flex items-center gap-4 pt-1.5" aria-label={en ? "Legend" : "Legenda"}>
            {series.map((s) => (
              <li
                key={s.name}
                className="flex items-center gap-1.5 text-sm text-muted-foreground"
              >
                <span className={cn("h-0.5 w-4 rounded-full", s.dot)} aria-hidden />
                {s.name}
              </li>
            ))}
          </ul>
        ) : null}
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
          <div
            className="relative mt-5 h-52 pb-6 pl-14 sm:h-64"
            role="img"
            aria-label={`${en ? "Daily cost per click" : "Dzienny koszt kliknięcia"}. ${takeaway(series, lang)}`}
          >
            <div className="relative h-full w-full" aria-hidden>
              {ticks.map((t) => (
                <span
                  key={t}
                  className="absolute -left-14 w-12 -translate-y-1/2 text-right text-xs tabular-nums text-muted-foreground"
                  style={{ top: `${y(t)}%` }}
                >
                  {formatMoneyPLN(Math.round(t))}
                </span>
              ))}
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="absolute inset-0 h-full w-full overflow-visible"
              >
                {ticks.map((t) => (
                  <line
                    key={t}
                    x1={0}
                    x2={100}
                    y1={y(t)}
                    y2={y(t)}
                    className="stroke-border"
                    strokeWidth="1"
                    strokeDasharray={t === min ? undefined : "3 3"}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
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
              {xLabels.map(({ i, date }, k) => {
                const [, month, day] = date.split("-");
                return (
                  <span
                    key={date}
                    className={cn(
                      "absolute top-full mt-1.5 -translate-x-1/2 whitespace-nowrap text-xs tabular-nums text-muted-foreground",
                      k % 2 === 1 && "hidden sm:block",
                      i === 0 && "translate-x-0"
                    )}
                    style={{ left: `${x(i)}%` }}
                  >
                    {Number(day)}.{month}
                  </span>
                );
              })}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
