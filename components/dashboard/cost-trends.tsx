"use client";

import { Card, LineChart, Title } from "@tremor/react";

import type { CostTrendPoint } from "@/lib/dashboard/metrics";
import { formatMoneyPLN } from "@/lib/utils";

export function CostTrends({ costTrend }: { costTrend: CostTrendPoint[] }) {
  const data = costTrend.map((p) => {
    const [, month, day] = p.date.split("-");
    return {
      date: `${day}.${month}`,
      "CPC Meta":
        p.metaCpcMinorUnits != null ? p.metaCpcMinorUnits / 100 : null,
      "CPC Google":
        p.googleCpcMinorUnits != null ? p.googleCpcMinorUnits / 100 : null,
    };
  });

  return (
    <Card>
      <Title>Średni CPC dziennie - Meta vs Google</Title>
      <LineChart
        className="mt-4 h-64"
        data={data}
        index="date"
        categories={["CPC Meta", "CPC Google"]}
        colors={["blue", "amber"]}
        valueFormatter={(v) => formatMoneyPLN(Math.round(v * 100))}
        yAxisWidth={72}
        connectNulls
        curveType="monotone"
      />
    </Card>
  );
}
