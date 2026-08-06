import { Card, Title } from "@tremor/react";

import { formatNumberPL } from "@/lib/utils";

interface Step {
  label: string;
  value: number;
}

// Sales funnel from the data we track daily: sessions -> engaged sessions
// (engagement rate applied) -> transactions. Widths are proportional on a log
// scale so the transactions bar stays visible next to thousands of sessions.
export function ConversionFunnel({
  sessions,
  engagementRate, // percent 0-100
  transactions,
}: {
  sessions: number;
  engagementRate: number;
  transactions: number;
}) {
  const engaged = Math.round((sessions * engagementRate) / 100);
  const steps: Step[] = [
    { label: "Sesje", value: sessions },
    { label: "Zaangażowane sesje", value: engaged },
    { label: "Transakcje", value: transactions },
  ];
  const max = Math.max(...steps.map((s) => s.value), 1);
  const width = (v: number) =>
    v <= 0 ? 4 : Math.max(8, Math.round((Math.log10(v + 1) / Math.log10(max + 1)) * 100));

  const conv = (from: number, to: number) =>
    from > 0
      ? `${((to / from) * 100).toLocaleString("pl-PL", {
          maximumFractionDigits: to / from < 0.01 ? 2 : 1,
        })}%`
      : "—";

  const colors = ["bg-indigo-300/70", "bg-indigo-500/80", "bg-emerald-500"];

  return (
    <Card>
      <div className="flex items-center justify-between">
        <Title>Lejek sprzedaży</Title>
        <p className="text-xs text-muted-foreground">
          Konwersja sesja → zakup:{" "}
          <span className="font-semibold text-foreground">
            {conv(sessions, transactions)}
          </span>
        </p>
      </div>
      <div className="mt-5 space-y-4">
        {steps.map((s, i) => (
          <div key={s.label}>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">{s.label}</span>
              <span className="text-sm font-bold text-foreground">
                {formatNumberPL(s.value)}
                {i > 0 ? (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {conv(steps[i - 1].value, s.value)} z poprzedniego kroku
                  </span>
                ) : null}
              </span>
            </div>
            <div className="h-7 w-full overflow-hidden rounded-lg bg-muted">
              <div
                className={`h-full rounded-lg ${colors[i]} transition-all duration-700`}
                style={{ width: `${width(s.value)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
