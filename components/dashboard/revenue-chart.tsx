"use client";

import { AreaChart, Card, Title } from "@tremor/react";

import type { TrendPoint } from "@/lib/dashboard/metrics";

const compactPln = (zl: number) => {
  if (Math.abs(zl) >= 1_000_000)
    return `${(zl / 1_000_000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} mln zł`;
  if (Math.abs(zl) >= 1_000)
    return `${(zl / 1_000).toLocaleString("pl-PL", { maximumFractionDigits: 0 })} tys. zł`;
  return `${Math.round(zl)} zł`;
};

// Revenue vs ad spend over the range - the client's own sales curve (peaks
// visible) with spend overlaid.
export function RevenueChart({ trend }: { trend: TrendPoint[] }) {
  const data = trend.map((p) => {
    const [, month, day] = p.date.split("-");
    return {
      date: `${day}.${month}`,
      Przychód: p.revenueMinorUnits / 100,
      Wydatki: p.spendMinorUnits / 100,
    };
  });
  return (
    <Card>
      <Title>Przychód vs wydatki</Title>
      <AreaChart
        className="mt-4 h-72"
        data={data}
        index="date"
        categories={["Przychód", "Wydatki"]}
        colors={["emerald", "indigo"]}
        valueFormatter={compactPln}
        showLegend
        yAxisWidth={76}
        curveType="monotone"
      />
    </Card>
  );
}
