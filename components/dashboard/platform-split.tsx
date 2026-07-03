"use client";

import { Card, DonutChart, Legend, Title } from "@tremor/react";

import type { PlatformSplit as PlatformSplitData } from "@/lib/dashboard/metrics";
import { formatMoneyPLN } from "@/lib/utils";

export function PlatformSplit({ split }: { split: PlatformSplitData }) {
  const total = split.metaSpendMinorUnits + split.googleSpendMinorUnits;
  const pct = (v: number) => (total > 0 ? Math.round((v / total) * 100) : 0);

  const data = [
    { name: "Meta Ads", value: split.metaSpendMinorUnits / 100 },
    { name: "Google Ads", value: split.googleSpendMinorUnits / 100 },
  ];

  return (
    <Card>
      <Title>Podział wydatków</Title>
      <DonutChart
        className="mt-6 h-52"
        data={data}
        category="value"
        index="name"
        colors={["blue", "amber"]}
        valueFormatter={(v) => formatMoneyPLN(Math.round(v * 100))}
      />
      <Legend
        className="mt-4 justify-center"
        categories={[
          `Meta: ${formatMoneyPLN(split.metaSpendMinorUnits)} (${pct(split.metaSpendMinorUnits)}%)`,
          `Google: ${formatMoneyPLN(split.googleSpendMinorUnits)} (${pct(split.googleSpendMinorUnits)}%)`,
        ]}
        colors={["blue", "amber"]}
      />
    </Card>
  );
}
