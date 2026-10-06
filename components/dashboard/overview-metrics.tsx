"use client";

import { useMemo, useState } from "react";

import { InfoTip } from "@/components/dashboard/info-tip";
import { MainChart, type ChartMetric } from "@/components/dashboard/main-chart";
import { MetricDelta, MetricTile } from "@/components/dashboard/metric-tile";
import type { SparklineTone } from "@/components/ui/sparkline";
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
  sessions: "Wizyty na stronie",
  cpc: "Koszt kliknięcia",
  revenue: "Sprzedaż",
  orders: "Zamówienia",
  roas: "Zwrot z reklam",
};

// Sparkline colour = the delta's judgement (spend is a decision, not news).
const SPARK_TONE: Record<Tone, SparklineTone> = {
  good: "positive",
  bad: "negative",
  flat: "neutral",
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

// Full class strings so Tailwind keeps them; no empty column with 3 tiles.
// Four tiles stay 2x2 until xl: beside the sidebar at 1024 a quarter of the
// column is too narrow for "43 885 zł" at metric size (it truncated).
const COLS: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "md:grid-cols-3",
  4: "xl:grid-cols-4",
};

function Tile({
  fact,
  series,
  selected,
  onSelect,
}: {
  fact: StoryFact;
  series: number[];
  selected: boolean;
  onSelect: () => void;
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

  return (
    <MetricTile
      selected={selected}
      // Hover: a small lift + deeper shadow says "this is clickable".
      className={cn(!selected && "hover:shadow-raised motion-safe:hover:-translate-y-0.5")}
      // The whole tile is the button; the ⓘ sits above it (no nested
      // interactive elements).
      overlay={
        <button
          type="button"
          aria-pressed={selected}
          aria-label={`${name}: ${fact.value}. Pokaż na wykresie`}
          onClick={onSelect}
          className="absolute inset-0 rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
      }
      label={
        <div className="flex items-start gap-1">
          <span className="min-w-0 text-sm font-medium leading-5 text-muted-foreground">{label}</span>
          <InfoTip label={name} text={explain} className="shrink-0" />
        </div>
      }
      value={fact.value}
      delta={
        change ? (
          <MetricDelta
            text={change.text}
            tone={change.tone}
            direction={up === null ? null : up ? "up" : "down"}
          />
        ) : undefined
      }
      sparkline={series}
      sparkTone={change ? SPARK_TONE[change.tone] : "neutral"}
    >
      {fact.yoy ? <p className="text-xs tabular-nums text-muted-foreground">{fact.yoy}</p> : null}
    </MetricTile>
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
          <p className="text-sm text-muted-foreground">
            Zmiany w porównaniu {comparisonPhrase(periodLabel)}. Kliknij liczbę, aby zobaczyć ją
            na wykresie.
          </p>
          <div
            role="group"
            aria-label="Najważniejsze liczby"
            className={cn("grid grid-cols-2 gap-3 sm:gap-4", COLS[tiles.length])}
          >
            {tiles.map((f) => (
              <Tile
                key={f.key}
                fact={f}
                series={series[f.key] ?? []}
                selected={selected === f.key}
                onSelect={() => setSelected(f.key)}
              />
            ))}
          </div>
        </>
      ) : null}

      {/* Chart + plan side by side only from xl: at 1024 the plan column was
          ~240px and clipped its goal names. */}
      <div className={cn(aside ? "grid items-start gap-4 xl:grid-cols-3" : undefined)}>
        <div className="min-w-0 xl:col-span-2">
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
          />
        </div>
        {aside}
      </div>
    </div>
  );
}
