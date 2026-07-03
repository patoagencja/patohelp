"use client";

import { Card, DonutChart, Legend, Title } from "@tremor/react";

import { formatNumberPL } from "@/lib/utils";

const COLORS = ["indigo", "emerald", "amber", "sky", "slate"] as const;

export function TrafficSources({
  sources,
}: {
  sources: Array<{ category: string; sessions: number }>;
}) {
  return (
    <Card>
      <Title>Źródła ruchu</Title>
      <DonutChart
        className="mt-6 h-52"
        data={sources.map((s) => ({ name: s.category, value: s.sessions }))}
        category="value"
        index="name"
        colors={[...COLORS]}
        valueFormatter={(v) => `${formatNumberPL(v)} sesji`}
      />
      <Legend
        className="mt-4 justify-center"
        categories={sources.map(
          (s) => `${s.category}: ${formatNumberPL(s.sessions)}`
        )}
        colors={[...COLORS]}
      />
    </Card>
  );
}
