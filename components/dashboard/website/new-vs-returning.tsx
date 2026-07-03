"use client";

import { Card, DonutChart, Legend, Title } from "@tremor/react";

import { formatNumberPL } from "@/lib/utils";

export function NewVsReturning({
  data,
}: {
  data: { newUsers: number; returningUsers: number };
}) {
  const chartData = [
    { name: "Nowi użytkownicy", value: data.newUsers },
    { name: "Powracający", value: data.returningUsers },
  ];

  return (
    <Card>
      <Title>Nowi vs powracający</Title>
      <DonutChart
        className="mt-6 h-52"
        data={chartData}
        category="value"
        index="name"
        colors={["indigo", "emerald"]}
        valueFormatter={(v) => formatNumberPL(v)}
      />
      <Legend
        className="mt-4 justify-center"
        categories={chartData.map((d) => `${d.name}: ${formatNumberPL(d.value)}`)}
        colors={["indigo", "emerald"]}
      />
    </Card>
  );
}
