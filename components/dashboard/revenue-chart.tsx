"use client";

import { AreaChart, Card } from "@tremor/react";

import type { TrendPoint } from "@/lib/dashboard/metrics";

const compactPln = (zl: number) => {
  if (Math.abs(zl) >= 1_000_000)
    return `${(zl / 1_000_000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} mln zł`;
  if (Math.abs(zl) >= 1_000)
    return `${(zl / 1_000).toLocaleString("pl-PL", { maximumFractionDigits: 0 })} tys. zł`;
  return `${Math.round(zl)} zł`;
};

// Sales vs ad spend over the range - the client's own sales curve (peaks
// visible) with spend overlaid, so "did spending more sell more?" is one look.
export function RevenueChart({ trend }: { trend: TrendPoint[] }) {
  const data = trend.map((p) => {
    const [, month, day] = p.date.split("-");
    return {
      date: `${day}.${month}`,
      Sprzedaż: p.revenueMinorUnits / 100,
      "Wydatki na reklamy": p.spendMinorUnits / 100,
    };
  });
  return (
    <Card>
      <h3 className="text-base font-semibold">Sprzedaż a wydatki na reklamy</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Dzień po dniu - sprzedaż według Google Analytics, wydatki z Meta i Google.
      </p>
      <AreaChart
        className="mt-4 h-64 sm:h-72"
        data={data}
        index="date"
        categories={["Sprzedaż", "Wydatki na reklamy"]}
        colors={["emerald", "indigo"]}
        valueFormatter={compactPln}
        showLegend
        yAxisWidth={64}
        curveType="monotone"
      />
    </Card>
  );
}
