"use client";

import { useState } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { InfoTip } from "@/components/dashboard/info-tip";
import { MainChart, type ChartMetric } from "@/components/dashboard/main-chart";
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

const TONE_CLASS: Record<Tone, string> = {
  good: "text-emerald-700 dark:text-emerald-400",
  bad: "text-red-700 dark:text-red-400",
  flat: "text-muted-foreground",
};

// Full class strings so Tailwind keeps them; no empty column with 3 tiles.
const COLS: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
};

function Tile({
  fact,
  selected,
  onSelect,
}: {
  fact: StoryFact;
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
      : null;

  return (
    <div
      className={cn(
        // focus-within lift keeps an open ⓘ bubble above the neighbours.
        "surface relative min-w-0 p-4 transition-shadow focus-within:z-10 hover:z-10 sm:p-5",
        selected ? "ring-2 ring-primary" : "hover:shadow-raised"
      )}
    >
      {/* The whole tile is the button; the ⓘ sits above it (no nested
          interactive elements). */}
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`${name}: ${fact.value}. Pokaż na wykresie`}
        onClick={onSelect}
        className="absolute inset-0 rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      />
      <div className="pointer-events-none relative">
        <div className="flex items-start gap-1">
          <span className="min-w-0 text-sm font-medium leading-5 text-muted-foreground">{label}</span>
          <InfoTip label={name} text={explain} className="pointer-events-auto shrink-0" />
        </div>
        <p className="mt-1.5 truncate text-2xl font-semibold tabular-nums tracking-tight text-foreground sm:text-metric">
          {fact.value}
        </p>
        {change ? (
          <p className={cn("mt-1.5 flex items-start gap-1 text-sm font-medium", TONE_CLASS[change.tone])}>
            {up === null ? null : up ? (
              <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            ) : (
              <ArrowDownRight className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            )}
            <span>{change.text}</span>
          </p>
        ) : null}
        {fact.yoy ? (
          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{fact.yoy}</p>
        ) : null}
      </div>
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
                selected={selected === f.key}
                onSelect={() => setSelected(f.key)}
              />
            ))}
          </div>
        </>
      ) : null}

      <div className={cn(aside ? "grid items-start gap-4 lg:grid-cols-3" : undefined)}>
        <div className="min-w-0 lg:col-span-2">
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
