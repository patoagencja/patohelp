"use client";

import { AreaChart, Card, Title } from "@tremor/react";

import { formatNumberPL } from "@/lib/utils";

// TODO: split the trend by source category (paid/organic/social/direct) once
// ga4_daily stores per-day source breakdowns; today it holds daily totals.
export function SessionsTrend({
  trend,
  lang = "pl",
}: {
  trend: Array<{ date: string; sessions: number }>;
  lang?: "pl" | "en";
}) {
  const en = lang === "en";
  const key = en ? "Sessions" : "Wizyty";
  const data = trend.map((p) => {
    const [, month, day] = p.date.split("-");
    return { date: `${day}.${month}`, [key]: p.sessions };
  });

  const total = trend.reduce((a, p) => a + p.sessions, 0);
  // One day draws no area at all and an all-zero range is a flat line on the
  // floor; Tremor's own fallback is an English "No data". Say why instead.
  const empty =
    total <= 0
      ? en
        ? "Google Analytics data appears after the first sync."
        : "Dane z Google Analytics pojawią się po pierwszej synchronizacji."
      : trend.length < 2
        ? en
          ? "Not enough days for a trend yet - check back in a few days."
          : "Za mało dni, by narysować trend - wróć za kilka dni."
        : null;

  return (
    <Card>
      <Title>{en ? "Sessions - last 30 days" : "Wizyty na stronie dzień po dniu"}</Title>
      {empty ? (
        <div className="mt-4 flex h-64 items-center justify-center rounded-lg border border-dashed border-border px-4 text-center text-sm text-muted-foreground">
          {empty}
        </div>
      ) : (
      <AreaChart
        className="mt-4 h-64"
        data={data}
        index="date"
        categories={[key]}
        colors={["emerald"]}
        valueFormatter={(v) => formatNumberPL(v)}
        showLegend={false}
        yAxisWidth={56}
        curveType="monotone"
      />
      )}
    </Card>
  );
}
