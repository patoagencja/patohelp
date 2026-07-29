"use client";

import { Card, DonutChart, Legend, Title } from "@tremor/react";

import { formatNumberPL } from "@/lib/utils";

const COLORS = ["indigo", "emerald", "amber", "sky", "slate"] as const;

export function TrafficSources({
  sources,
  lang = "pl",
}: {
  sources: Array<{ category: string; sessions: number }>;
  lang?: "pl" | "en";
}) {
  const en = lang === "en";
  const catName = (c: string) =>
    en && c === "Referral/Inne" ? "Referral/Other" : c;
  const unit = (v: number) => `${formatNumberPL(v)} ${en ? "sessions" : "sesji"}`;
  return (
    <Card>
      <Title>{en ? "Traffic sources" : "Źródła ruchu"}</Title>
      <DonutChart
        className="mt-6 h-52"
        data={sources.map((s) => ({ name: catName(s.category), value: s.sessions }))}
        category="value"
        index="name"
        colors={[...COLORS]}
        valueFormatter={unit}
      />
      <Legend
        className="mt-4 justify-center"
        categories={sources.map(
          (s) => `${catName(s.category)}: ${formatNumberPL(s.sessions)}`
        )}
        colors={[...COLORS]}
      />
    </Card>
  );
}
