"use client";

import { AreaChart, Card, Title } from "@tremor/react";

import { formatNumberPL } from "@/lib/utils";

// TODO: split the trend by source category (paid/organic/social/direct) once
// ga4_daily stores per-day source breakdowns; today it holds daily totals.
export function SessionsTrend({
  trend,
}: {
  trend: Array<{ date: string; sessions: number }>;
}) {
  const data = trend.map((p) => {
    const [, month, day] = p.date.split("-");
    return { date: `${day}.${month}`, Sesje: p.sessions };
  });

  return (
    <Card>
      <Title>Sesje — ostatnie 30 dni</Title>
      <AreaChart
        className="mt-4 h-64"
        data={data}
        index="date"
        categories={["Sesje"]}
        colors={["emerald"]}
        valueFormatter={(v) => formatNumberPL(v)}
        showLegend={false}
        yAxisWidth={56}
        curveType="monotone"
      />
    </Card>
  );
}
