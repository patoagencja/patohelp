"use client";

import { Card, DonutChart, Legend, Title } from "@tremor/react";

import { formatNumberPL } from "@/lib/utils";

const DEVICE_LABEL: Record<string, string> = {
  mobile: "Mobile",
  desktop: "Desktop",
  tablet: "Tablet",
};

const COLORS = ["indigo", "sky", "slate"] as const;

export function Devices({
  devices,
  lang = "pl",
}: {
  devices: Array<{ device: string; sessions: number }>;
  lang?: "pl" | "en";
}) {
  const en = lang === "en";
  const data = devices.map((d) => ({
    name: DEVICE_LABEL[d.device] ?? d.device,
    value: d.sessions,
  }));

  return (
    <Card>
      <Title>{en ? "Devices" : "Urządzenia"}</Title>
      <DonutChart
        className="mt-6 h-52"
        data={data}
        category="value"
        index="name"
        colors={[...COLORS]}
        valueFormatter={(v) => `${formatNumberPL(v)} ${en ? "sessions" : "sesji"}`}
      />
      <Legend
        className="mt-4 justify-center"
        categories={data.map((d) => `${d.name}: ${formatNumberPL(d.value)}`)}
        colors={[...COLORS]}
      />
    </Card>
  );
}
