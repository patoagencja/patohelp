"use client";

import { useEffect, useRef, useState } from "react";
import { BadgeDelta, Card, Flex, Grid, SparkAreaChart, Text } from "@tremor/react";

import { AnimatedNumber } from "@/components/dashboard/animated-number";
import type { DashboardKpis, Kpi, TrendPoint } from "@/lib/dashboard/metrics";
import { cn, formatMoneyPLN, formatNumberPL, formatPercent } from "@/lib/utils";

// How an increase should be judged for each metric.
type Direction = "good" | "bad" | "neutral";

// Green when the change is good for the client, red when bad, gray for
// neutral metrics (spend) — the arrow still shows the direction.
function deltaBadge(kpi: Kpi, direction: Direction) {
  if (kpi.deltaPercent === null) return null;
  const rounded = Math.round(kpi.deltaPercent * 10) / 10;

  const deltaType =
    rounded === 0 || direction === "neutral"
      ? "unchanged"
      : (direction === "good" ? rounded > 0 : rounded < 0)
        ? "increase" // green
        : "decrease"; // red

  return {
    deltaType,
    showArrow: rounded > 0 ? "▲" : rounded < 0 ? "▼" : "",
    label: `${rounded > 0 ? "+" : ""}${formatPercent(rounded, 1)}`,
  };
}

// Sparkline colour mirrors the delta judgement: green = good move, red = bad,
// indigo for neutral (spend). Keeps the whole card reading as one signal.
function sparkColor(kpi: Kpi, direction: Direction) {
  if (direction === "neutral" || kpi.deltaPercent === null) return "indigo";
  const good = direction === "good" ? kpi.deltaPercent >= 0 : kpi.deltaPercent <= 0;
  return good ? "emerald" : "red";
}

function KpiCard({
  label,
  value,
  format,
  kpi,
  direction,
  series,
  hint,
}: {
  label: string;
  value: number;
  format: (n: number) => string;
  kpi: Kpi;
  direction: Direction;
  series: number[];
  hint?: string;
}) {
  const delta = hint ? null : deltaBadge(kpi, direction);
  const hasSpark = series.some((v) => v > 0);
  const data = series.map((v, i) => ({ i, v }));

  // Flash the whole card green/red when the value changes (e.g. auto-refresh).
  const prevRef = useRef(value);
  const [cardFlash, setCardFlash] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (prevRef.current === value) return;
    setCardFlash(value > prevRef.current ? "up" : "down");
    prevRef.current = value;
    const t = setTimeout(() => setCardFlash(null), 700);
    return () => clearTimeout(t);
  }, [value]);

  return (
    <Card
      className={cn(
        "group transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:ring-1 hover:ring-primary/20",
        cardFlash === "up" && "ring-2 ring-emerald-500/60",
        cardFlash === "down" && "ring-2 ring-red-500/60"
      )}
    >
      <Flex justifyContent="between" alignItems="start">
        <Text>{label}</Text>
        {delta ? (
          <BadgeDelta deltaType={delta.deltaType as never} size="xs">
            {`${delta.showArrow} ${delta.label}`.trim()}
          </BadgeDelta>
        ) : null}
      </Flex>

      <Flex justifyContent="between" alignItems="end" className="mt-2 gap-2">
        <AnimatedNumber
          value={value}
          format={format}
          className="min-w-0 flex-1 truncate text-2xl font-bold tracking-tight text-foreground"
        />
        {hasSpark ? (
          <SparkAreaChart
            data={data}
            index="i"
            categories={["v"]}
            colors={[sparkColor(kpi, direction)]}
            className="h-8 w-16 shrink-0 sm:w-20"
          />
        ) : null}
      </Flex>

      <Text className={cn("mt-1 text-xs", hint && "text-muted-foreground")}>
        {hint ?? "vs poprzedni okres"}
      </Text>
    </Card>
  );
}

export function KpiCards({
  kpis,
  trend,
}: {
  kpis: DashboardKpis;
  trend: TrendPoint[];
}) {
  const noSessions = kpis.sessions.value === 0 && kpis.sessions.previous === 0;
  const noConversions =
    kpis.conversions.value === 0 && kpis.conversions.previous === 0;

  // Per-day series for each metric so every card carries its own sparkline.
  const spendSeries = trend.map((t) => t.spendMinorUnits / 100);
  const clicksSeries = trend.map((t) => t.clicks);
  const sessionsSeries = trend.map((t) => t.sessions);
  const conversionsSeries = trend.map((t) => t.conversions);
  const ctrSeries = trend.map((t) =>
    t.impressions > 0 ? (t.clicks / t.impressions) * 100 : 0
  );
  const cpcSeries = trend.map((t) =>
    t.clicks > 0 ? t.spendMinorUnits / t.clicks / 100 : 0
  );

  return (
    <Grid numItemsSm={2} numItemsLg={3} className="gap-4">
      <KpiCard
        label="Wydatki"
        value={kpis.spendMinorUnits.value}
        format={(n) => formatMoneyPLN(Math.round(n))}
        kpi={kpis.spendMinorUnits}
        direction="neutral"
        series={spendSeries}
      />
      <KpiCard
        label="Kliknięcia"
        value={kpis.clicks.value}
        format={formatNumberPL}
        kpi={kpis.clicks}
        direction="good"
        series={clicksSeries}
      />
      <KpiCard
        label="Sesje (GA4)"
        value={kpis.sessions.value}
        format={(n) => (noSessions ? "—" : formatNumberPL(n))}
        kpi={kpis.sessions}
        direction="good"
        series={sessionsSeries}
        hint={noSessions ? "po podłączeniu GA4" : undefined}
      />
      <KpiCard
        label="Średni CTR"
        value={kpis.ctr.value}
        format={(n) => formatPercent(n)}
        kpi={kpis.ctr}
        direction="good"
        series={ctrSeries}
      />
      <KpiCard
        label="Średni CPC"
        value={kpis.cpcMinorUnits.value}
        format={(n) => formatMoneyPLN(Math.round(n))}
        kpi={kpis.cpcMinorUnits}
        direction="bad"
        series={cpcSeries}
      />
      <KpiCard
        label="Konwersje"
        value={kpis.conversions.value}
        format={(n) => (noConversions ? "—" : formatNumberPL(n))}
        kpi={kpis.conversions}
        direction="good"
        series={conversionsSeries}
        hint={noConversions ? "brak zdarzeń konwersji" : undefined}
      />
    </Grid>
  );
}
