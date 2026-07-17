"use client";

import { Card, DonutChart, Legend, Title } from "@tremor/react";

import type { PlatformSplit as PlatformSplitData } from "@/lib/dashboard/metrics";
import { formatMoneyPLN } from "@/lib/utils";

export function PlatformSplit({ split }: { split: PlatformSplitData }) {
  const total =
    split.metaSpendMinorUnits +
    split.googleSpendMinorUnits +
    split.tiktokSpendMinorUnits;
  const pct = (v: number) => (total > 0 ? Math.round((v / total) * 100) : 0);

  // Only show platforms that actually have spend.
  const entries = [
    { name: "Meta Ads", short: "Meta", value: split.metaSpendMinorUnits, color: "blue" },
    { name: "Google Ads", short: "Google", value: split.googleSpendMinorUnits, color: "amber" },
    { name: "TikTok Ads", short: "TikTok", value: split.tiktokSpendMinorUnits, color: "rose" },
  ].filter((e) => e.value > 0);

  return (
    <Card>
      <Title>Podział wydatków</Title>
      <DonutChart
        className="mt-6 h-52"
        data={entries.map((e) => ({ name: e.name, value: e.value / 100 }))}
        category="value"
        index="name"
        colors={entries.map((e) => e.color)}
        valueFormatter={(v) => formatMoneyPLN(Math.round(v * 100))}
      />
      <Legend
        className="mt-4 justify-center"
        categories={entries.map(
          (e) => `${e.short}: ${formatMoneyPLN(e.value)} (${pct(e.value)}%)`
        )}
        colors={entries.map((e) => e.color)}
      />
    </Card>
  );
}
