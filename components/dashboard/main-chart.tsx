"use client";

import { useState } from "react";
import { AreaChart, Card, Title } from "@tremor/react";
import { CalendarDays } from "lucide-react";

import type { TrendPoint } from "@/lib/dashboard/metrics";
import type { ClientEvent } from "@/lib/dashboard/overview";
import { cn, formatMoneyPLN, formatNumberPL } from "@/lib/utils";

type MetricKey = "spend" | "sessions" | "clicks" | "conversions";

const METRICS: Array<{ key: MetricKey; label: string }> = [
  { key: "spend", label: "Wydatki" },
  { key: "sessions", label: "Sesje" },
  { key: "clicks", label: "Kliknięcia" },
  { key: "conversions", label: "Konwersje" },
];

const EVENT_TYPE_LABEL: Record<string, string> = {
  campaign_launch: "Start kampanii",
  budget_change: "Zmiana budżetu",
  sale_period: "Okres promocji",
  strategy_change: "Zmiana strategii",
  other: "Inne",
};

// TODO: annotations overlay directly on the chart (Tremor has no native
// support) — for now events render as a chronological list below.
export function MainChart({
  trend,
  events,
  label,
}: {
  trend: TrendPoint[];
  events: ClientEvent[];
  label?: string;
}) {
  const [metric, setMetric] = useState<MetricKey>("spend");

  const isMoney = metric === "spend";
  const data = trend.map((p) => {
    const [, month, day] = p.date.split("-");
    const value =
      metric === "spend"
        ? p.spendMinorUnits / 100
        : metric === "sessions"
          ? p.sessions
          : metric === "clicks"
            ? p.clicks
            : p.conversions;
    return { date: `${day}.${month}`, Wartość: value };
  });

  const activeLabel = METRICS.find((m) => m.key === metric)?.label ?? "";

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Title>
          {activeLabel}
          {label ? ` — ${label}` : ""}
        </Title>
        <div className="flex rounded-lg bg-muted p-1">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMetric(m.key)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                metric === m.key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <AreaChart
        className="mt-4 h-72"
        data={data}
        index="date"
        categories={["Wartość"]}
        colors={["indigo"]}
        valueFormatter={(v) =>
          isMoney ? formatMoneyPLN(Math.round(v * 100)) : formatNumberPL(v)
        }
        showLegend={false}
        yAxisWidth={isMoney ? 80 : 56}
        curveType="monotone"
      />

      {events.length > 0 ? (
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Wydarzenia w tym okresie
          </p>
          <ul className="space-y-1.5">
            {events.map((e) => {
              const [, month, day] = e.eventDate.split("-");
              return (
                <li key={e.id} className="flex items-start gap-2 text-sm">
                  <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>
                    <span className="font-medium">
                      {day}.{month}
                    </span>
                    : {e.title}
                    {e.eventType ? (
                      <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">
                        {EVENT_TYPE_LABEL[e.eventType] ?? e.eventType}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
