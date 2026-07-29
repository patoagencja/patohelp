"use client";

import { Card, DonutChart, Legend, Title } from "@tremor/react";

import { formatNumberPL } from "@/lib/utils";

export function NewVsReturning({
  data,
  lang = "pl",
}: {
  data: { newUsers: number; returningUsers: number };
  lang?: "pl" | "en";
}) {
  const en = lang === "en";
  const chartData = [
    { name: en ? "New users" : "Nowi użytkownicy", value: data.newUsers },
    { name: en ? "Returning" : "Powracający", value: data.returningUsers },
  ];

  return (
    <Card>
      <Title>{en ? "New vs returning" : "Nowi vs powracający"}</Title>
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
