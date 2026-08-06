"use client";

import { AreaChart, BadgeDelta, Card } from "@tremor/react";

import type { Kpi, TrendPoint } from "@/lib/dashboard/metrics";
import { formatMoneyPLN } from "@/lib/utils";

const compactPln = (zl: number) => {
  if (Math.abs(zl) >= 1_000_000)
    return `${(zl / 1_000_000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} mln zł`;
  if (Math.abs(zl) >= 1_000)
    return `${(zl / 1_000).toLocaleString("pl-PL", { maximumFractionDigits: 0 })} tys. zł`;
  return `${Math.round(zl)} zł`;
};

function SummaryRow({
  dot,
  label,
  value,
  strong,
}: {
  dot: string;
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {label}
      </span>
      <span
        className={
          strong
            ? "text-sm font-bold text-foreground"
            : "text-sm font-semibold text-foreground"
        }
      >
        {value}
      </span>
    </div>
  );
}

// "Your sales report" panel: big revenue number + delta on the left with an
// income / ad spend / net breakdown and best-day highlight, revenue-vs-spend
// area chart on the right.
export function SalesOverview({
  trend,
  revenueKpi,
}: {
  trend: TrendPoint[];
  revenueKpi: Kpi;
}) {
  const totalRev = trend.reduce((a, p) => a + p.revenueMinorUnits, 0);
  const totalSpend = trend.reduce((a, p) => a + p.spendMinorUnits, 0);
  const net = totalRev - totalSpend;
  const daysWithRevenue = trend.filter((p) => p.revenueMinorUnits > 0).length;
  const avgDaily = daysWithRevenue > 0 ? totalRev / daysWithRevenue : 0;
  const best = trend.reduce(
    (m, p) => (p.revenueMinorUnits > m.revenueMinorUnits ? p : m),
    trend[0] ?? { date: "", revenueMinorUnits: 0 }
  );

  const deltaPct = revenueKpi.deltaPercent;
  const deltaType =
    deltaPct === null || Math.round(deltaPct) === 0
      ? "unchanged"
      : deltaPct > 0
        ? "increase"
        : "decrease";

  const chart = trend.map((p) => {
    const [, month, day] = p.date.split("-");
    return {
      date: `${day}.${month}`,
      Przychód: p.revenueMinorUnits / 100,
      Wydatki: p.spendMinorUnits / 100,
    };
  });

  const bestLabel = best?.date
    ? `${best.date.slice(8, 10)}.${best.date.slice(5, 7)}`
    : "—";

  return (
    <Card>
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <div>
          <p className="text-sm text-muted-foreground">Raport sprzedaży</p>
          <p className="mt-1 text-3xl font-bold tracking-tight text-foreground">
            {formatMoneyPLN(totalRev)}
          </p>
          {deltaPct !== null ? (
            <BadgeDelta deltaType={deltaType} size="xs" className="mt-2">
              {`${deltaPct > 0 ? "+" : ""}${(Math.round(deltaPct * 10) / 10).toLocaleString("pl-PL")}% vs poprzedni okres`}
            </BadgeDelta>
          ) : null}

          <div className="mt-5 divide-y divide-border/60 border-y border-border/60">
            <SummaryRow
              dot="bg-emerald-500"
              label="Przychód"
              value={compactPln(totalRev / 100)}
            />
            <SummaryRow
              dot="bg-indigo-500"
              label="Wydatki na reklamę"
              value={compactPln(totalSpend / 100)}
            />
            <SummaryRow
              dot={net >= 0 ? "bg-emerald-600" : "bg-rose-500"}
              label="Wynik netto"
              value={compactPln(net / 100)}
              strong
            />
          </div>

          <div className="mt-4 space-y-1.5 text-xs text-muted-foreground">
            <p>
              Śr. dzienny przychód:{" "}
              <span className="font-semibold text-foreground">
                {compactPln(avgDaily / 100)}
              </span>
            </p>
            <p>
              Najlepszy dzień:{" "}
              <span className="font-semibold text-foreground">
                {bestLabel} · {compactPln((best?.revenueMinorUnits ?? 0) / 100)}
              </span>
            </p>
          </div>
        </div>

        <AreaChart
          className="h-72 lg:h-80"
          data={chart}
          index="date"
          categories={["Przychód", "Wydatki"]}
          colors={["emerald", "indigo"]}
          valueFormatter={compactPln}
          showLegend
          showAnimation
          curveType="monotone"
        />
      </div>
    </Card>
  );
}
