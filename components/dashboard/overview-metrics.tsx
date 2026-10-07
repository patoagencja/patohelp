"use client";

import { useMemo, useState } from "react";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { InfoTip } from "@/components/dashboard/info-tip";
import { MainChart, type ChartMetric } from "@/components/dashboard/main-chart";
import { CountUp } from "@/components/ui/count-up";
import type { ChartEvent } from "@/lib/dashboard/chart-events";
import { GLOSSARY, type GlossaryKey } from "@/lib/dashboard/glossary";
import type { TrendPoint } from "@/lib/dashboard/metrics";
import type { ClientEvent } from "@/lib/dashboard/overview";
import { comparisonPhrase, type StoryFact, type Tone } from "@/lib/dashboard/story";
import type { EngagementYoY } from "@/lib/dashboard/yoy";
import { cn } from "@/lib/utils";

// Story fact keys -> what the chart draws and which glossary entry explains it.
const CHART_METRIC: Record<string, ChartMetric> = {
  spend: "spend",
  impressions: "impressions",
  clicks: "clicks",
  sessions: "sessions",
  cpc: "cpc",
  revenue: "revenue",
  orders: "orders",
  roas: "roas",
};
const GLOSSARY_KEY: Record<string, GlossaryKey> = {
  spend: "spend",
  impressions: "impressions",
  clicks: "clicks",
  sessions: "sessions",
  cpc: "cpc",
  revenue: "revenue",
  orders: "transactions",
  roas: "roas",
};

// Tile labels: short and plain; the ⓘ carries the full name + definition.
const SHORT_NAME: Record<string, string> = {
  spend: "Wydatki",
  impressions: "Wyświetlenia",
  clicks: "Kliknięcia",
  sessions: "Wizyty",
  cpc: "Koszt kliknięcia",
  revenue: "Sprzedaż",
  orders: "Zamówienia",
  roas: "Zwrot z reklam",
};

/** Daily series behind a tile, from the chart's own trend (no new query). */
function dailySeries(trend: TrendPoint[], key: string): number[] {
  switch (key) {
    case "spend":
      return trend.map((p) => p.spendMinorUnits);
    case "clicks":
      return trend.map((p) => p.clicks);
    case "sessions":
      return trend.map((p) => p.sessions);
    case "impressions":
      return trend.map((p) => p.impressions);
    case "revenue":
      return trend.map((p) => p.revenueMinorUnits);
    case "orders":
      return trend.map((p) => p.transactions);
    case "cpc":
      // Days without clicks have no price; skip them rather than plot a 0.
      return trend.filter((p) => p.clicks > 0).map((p) => p.spendMinorUnits / p.clicks);
    case "roas":
      return trend
        .filter((p) => p.spendMinorUnits > 0)
        .map((p) => p.revenueMinorUnits / p.spendMinorUnits);
    default:
      return [];
  }
}

// Delta colour = the judgement (spend is a decision: neutral ink).
const DELTA_TONE: Record<Tone, string> = {
  good: "text-positive",
  bad: "text-negative",
  flat: "text-ink-2",
};

/** Sparkline path in a 200x44 box (Przeglad-pastel tile). */
function sparkPath(v: number[]): string | null {
  if (v.length < 2) return null;
  const mn = Math.min(...v);
  const mx = Math.max(...v);
  const span = mx - mn || 1;
  return v
    .map((p, j) => `${j ? "L" : "M"}${((j * 200) / (v.length - 1)).toFixed(1)} ${(mx === mn ? 22 : 40 - ((p - mn) / span) * 36).toFixed(1)}`)
    .join(" ");
}

/**
 * One 2026 KPI tile (Przeglad-pastel `.k`): mono label + ⓘ, delta on the
 * right, a 46px light number counting up, a drawn sparkline and one quiet
 * line ("więcej niż wcześniej · rok temu …"). The whole tile is the chart
 * tab (overlay button, aria-pressed); selected = lime ring + glow.
 */
function Tile({
  fact,
  series,
  selected,
  onSelect,
  index,
}: {
  fact: StoryFact;
  series: number[];
  selected: boolean;
  onSelect: () => void;
  index: number;
}) {
  const g = GLOSSARY[GLOSSARY_KEY[fact.key] ?? "spend"];
  const name = g.name;
  const label = SHORT_NAME[fact.key] ?? name;
  // The hint ("ze wszystkich źródeł, nie tylko z reklam") is honest context,
  // not headline material - it rides along in the ⓘ.
  const explain = fact.hint ? `${g.explain} ${capitalise(fact.hint)}.` : g.explain;
  const change = fact.change;
  // A cheaper click is good news pointing down; arrows follow the number.
  const up =
    change && change.tone !== "flat"
      ? (fact.key === "cpc") !== (change.tone === "good")
      : change && /więcej|drożej/.test(change.text)
        ? true
        : change && /mniej|taniej/.test(change.text)
          ? false
          : null;
  const m = change ? /^o (\d+(?:[.,]\d+)?\s?%)\s+(.*)$/.exec(change.text) : null;
  const pct = m ? m[1] : null;
  const words = m ? m[2] : change?.text;
  const yoy = fact.yoy?.replace(/^rok temu: /, "rok temu ");
  const unit = /^(.*?)\s?(zł)$/.exec(fact.value);
  const spark = sparkPath(series);

  return (
    <div
      className={cn(
        "glass relative flex w-[15rem] shrink-0 snap-start flex-col gap-3.5 rounded-tile p-5 pb-[18px] transition-[transform,box-shadow] duration-500 [transition-timing-function:cubic-bezier(.34,1.56,.64,1)] focus-within:z-10 hover:z-10 animate-rise motion-safe:hover:-translate-y-[5px] sm:w-auto sm:gap-4 sm:p-[22px] sm:pb-5",
        selected && "shadow-lime-ring print:shadow-none"
      )}
      style={{ "--d": `${0.45 + index * 0.08}s` } as React.CSSProperties}
    >
      {/* Selected: a soft lime light from the top-left corner. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 rounded-[inherit] bg-[radial-gradient(120%_80%_at_0%_0%,hsl(var(--lime)/0.2),transparent_60%)] opacity-0 transition-opacity duration-500",
          selected && "opacity-100"
        )}
      />
      {/* The whole tile is the button; the ⓘ sits above it. */}
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`${name}: ${fact.value}${change ? `, ${change.text}` : ""}. Pokaż na wykresie`}
        onClick={onSelect}
        className="absolute inset-0 z-[1] rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      />
      <div className="pointer-events-none relative z-[2] flex items-center justify-between gap-2 [&_button]:pointer-events-auto">
        <span className="flex min-w-0 items-center gap-1">
          <span className="kick truncate text-[11px] tracking-[0.08em] xl:text-[11.5px] xl:tracking-[0.12em]">{label}</span>
          <InfoTip label={name} text={explain} className="shrink-0" />
        </span>
        {change ? (
          <span className={cn("inline-flex shrink-0 items-center gap-1 text-[13.5px] font-semibold tabular-nums", DELTA_TONE[change.tone])}>
            {up === true ? <ArrowUpRight className="h-[13px] w-[13px]" strokeWidth={2.4} aria-hidden /> : null}
            {up === false ? <ArrowDownRight className="h-[13px] w-[13px]" strokeWidth={2.4} aria-hidden /> : null}
            {pct ?? (change.tone === "flat" ? "≈" : "")}
          </span>
        ) : null}
      </div>
      <p className="pointer-events-none relative text-[2.25rem] font-light leading-none tracking-[-0.055em] tabular-nums sm:text-[2.5rem] xl:text-[2.875rem]">
        {unit ? (
          <>
            <CountUp text={unit[1]} delayMs={250 + index * 80} />
            <small className="ml-[3px] text-[0.48em] tracking-[-0.02em]">{unit[2]}</small>
          </>
        ) : (
          <CountUp text={fact.value} delayMs={250 + index * 80} />
        )}
      </p>
      {spark ? (
        <svg
          aria-hidden
          width="100%"
          height="44"
          viewBox="0 0 200 44"
          preserveAspectRatio="none"
          className="pointer-events-none relative overflow-visible"
        >
          <path
            key={selected ? "on" : "off"}
            d={spark}
            pathLength={1}
            fill="none"
            stroke={selected ? "hsl(var(--lime-line))" : "var(--ink-3)"}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="draw-path animate-draw"
            style={{ "--d": `${0.9 + index * 0.12}s` } as React.CSSProperties}
          />
        </svg>
      ) : null}
      {words || yoy ? (
        <p className="pointer-events-none relative text-[13px] leading-snug text-ink-3">
          {[words, yoy].filter(Boolean).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The overview's numbers: four KPI tiles that double as the chart's tabs
 * (click "Wizyty" and the chart shows visits) and the one main chart, with
 * the month plan beside it on wide screens. One chart doing the job of four
 * and no dual axis to decode.
 */
export function OverviewMetrics({
  facts,
  periodLabel,
  trend,
  prevTrend,
  events,
  autoEvents,
  yoy,
  demo = false,
  aside,
  forecast = false,
  afterTiles,
}: {
  facts: StoryFact[];
  periodLabel: string;
  trend: TrendPoint[];
  prevTrend?: TrendPoint[];
  events: ClientEvent[];
  autoEvents?: ChartEvent[];
  yoy?: EngagementYoY | null;
  demo?: boolean;
  /** Shown to the right of the chart on desktop, under it on phones. */
  aside?: React.ReactNode;
  /** 7-day arithmetic projection on the chart (see MainChart). */
  forecast?: boolean;
  /** Rendered right under the KPI tiles, above the chart (goal tiles). */
  afterTiles?: React.ReactNode;
}) {
  const tiles = facts.filter((f) => CHART_METRIC[f.key]);
  const series = useMemo(
    () => Object.fromEntries(tiles.map((f) => [f.key, dailySeries(trend, f.key)])),
    // tiles is derived from facts; keyed on the inputs, not the array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [facts, trend]
  );
  const [selected, setSelected] = useState<string | null>(tiles[0]?.key ?? null);
  const metric = selected ? CHART_METRIC[selected] : undefined;

  return (
    <div className="space-y-4">
      {tiles.length > 0 ? (
        <>
          <p className="text-[13px] text-ink-3">
            Zmiany w porównaniu {comparisonPhrase(periodLabel)}. Kliknij kafelek, aby zobaczyć go
            na wykresie.
          </p>
          {/* Phones: a swipeable carousel (Telefon-2030); sm+: a grid. */}
          <div
            role="group"
            aria-label="Najważniejsze liczby"
            className={cn(
              "-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 pt-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:snap-none sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0",
              tiles.length >= 4 ? "sm:grid-cols-2 lg:grid-cols-4" : tiles.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"
            )}
          >
            {tiles.map((f, i) => (
              <Tile
                key={f.key}
                fact={f}
                index={i}
                series={series[f.key] ?? []}
                selected={selected === f.key}
                onSelect={() => setSelected(f.key)}
              />
            ))}
          </div>
        </>
      ) : null}

      {afterTiles ? <div className="pt-4 empty:hidden">{afterTiles}</div> : null}

      {/* With an aside (legacy callers) chart + aside sit side by side from
          xl; the 2026 overview renders the plan next to the campaigns. */}
      <div className={cn("pt-3", aside ? "grid items-start gap-6 xl:grid-cols-3" : undefined)}>
        <div className="min-w-0 animate-rise xl:col-span-2" style={{ "--d": ".7s" } as React.CSSProperties}>
          <MainChart
            trend={trend}
            prevTrend={prevTrend}
            events={events}
            autoEvents={autoEvents}
            yoy={yoy}
            label={periodLabel}
            demo={demo}
            metric={metric}
            hidePicker={Boolean(metric)}
            hideCompare
            forecast={forecast}
          />
        </div>
        {aside}
      </div>
    </div>
  );
}
