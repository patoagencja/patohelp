"use client";

import { AreaChart, Card, Title } from "@tremor/react";

import type { TrendPoint } from "@/lib/dashboard/metrics";
import { formatMoneyPLN } from "@/lib/utils";

export function TrendChart({
  trend,
  label,
}: {
  trend: TrendPoint[];
  label?: string;
}) {
  // Sessions (GA4) join as a second series once that integration lands.
  const hasSessions = trend.some((p) => p.sessions > 0);

  const data = trend.map((point) => {
    const [, month, day] = point.date.split("-");
    return {
      date: `${day}.${month}`,
      Wydatki: point.spendMinorUnits / 100,
      ...(hasSessions ? { Sesje: point.sessions } : {}),
    };
  });

  return (
    <Card>
      <Title>Trend wydatków{label ? ` — ${label}` : ""}</Title>
      <AreaChart
        className="mt-4 h-72"
        data={data}
        index="date"
        categories={hasSessions ? ["Wydatki", "Sesje"] : ["Wydatki"]}
        colors={hasSessions ? ["indigo", "emerald"] : ["indigo"]}
        valueFormatter={(value) => formatMoneyPLN(value * 100)}
        showLegend={hasSessions}
        yAxisWidth={72}
        curveType="monotone"
      />
    </Card>
  );
}
