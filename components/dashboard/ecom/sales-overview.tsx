"use client";

import { AreaChart, BadgeDelta, Card } from "@tremor/react";

import { InfoTip } from "@/components/dashboard/info-tip";
import { describeChange } from "@/lib/dashboard/glossary";
import type { Kpi, TrendPoint } from "@/lib/dashboard/metrics";
import { dayMonthPL } from "@/lib/dashboard/story";
import { cn, formatMoneyPLN, formatNumberPL, formatPlnWhole } from "@/lib/utils";

import { aboutPln, Takeaway, todayWarsawIso } from "./plain";

// Non-breaking spaces: Recharts wraps axis ticks on plain spaces, which split
// the top tick into "12 tys." / "zł" on two lines.
const compactPln = (zl: number) => {
  if (Math.abs(zl) >= 1_000_000)
    return `${(zl / 1_000_000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })}\u00a0mln\u00a0zł`;
  if (Math.abs(zl) >= 1_000)
    return `${(zl / 1_000).toLocaleString("pl-PL", { maximumFractionDigits: 0 })}\u00a0tys.\u00a0zł`;
  return `${formatNumberPL(zl)}\u00a0zł`;
};

function SummaryRow({
  dot,
  label,
  value,
  strong,
  explain,
}: {
  dot: string;
  label: string;
  value: string;
  strong?: boolean;
  explain?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} />
        {label}
        {explain ? <InfoTip label={label} text={explain} /> : null}
      </span>
      <span
        className={cn(
          "shrink-0 text-sm tabular-nums text-foreground",
          strong ? "font-bold" : "font-semibold"
        )}
      >
        {value}
      </span>
    </div>
  );
}

// "How sales went, day by day": total + change on the left with a sales / ad
// spend / what's left breakdown, the sales-vs-spend curve on the right (with
// last year overlaid when it's well covered).
export function SalesOverview({
  trend,
  revenueKpi,
  lastYear,
}: {
  trend: TrendPoint[];
  revenueKpi: Kpi;
  /** Last year's revenue per current date (52-week aligned), when reliable. */
  lastYear?: Array<{ date: string; revenue: number | null }> | null;
}) {
  const lyByDate = new Map((lastYear ?? []).map((p) => [p.date, p.revenue]));
  const showLy = lyByDate.size > 0;
  const totalRev = trend.reduce((a, p) => a + p.revenueMinorUnits, 0);
  const totalSpend = trend.reduce((a, p) => a + p.spendMinorUnits, 0);
  const net = totalRev - totalSpend;
  // Totals above include today's orders so far (they match the KPI tiles);
  // per-day figures and the curve use finished days only - a half-synced
  // today would drag the average down and plunge the end of the chart.
  const today = todayWarsawIso();
  const fullDays = trend.filter((p) => p.date < today);
  const todayPoint = trend.find((p) => p.date === today) ?? null;
  const fullRev = fullDays.reduce((a, p) => a + p.revenueMinorUnits, 0);
  const daysWithRevenue = fullDays.filter((p) => p.revenueMinorUnits > 0).length;
  const avgDaily = daysWithRevenue > 0 ? fullRev / daysWithRevenue : 0;
  const best = fullDays.reduce<TrendPoint | null>(
    (m, p) => (p.revenueMinorUnits > (m?.revenueMinorUnits ?? 0) ? p : m),
    null
  );

  const deltaPct = revenueKpi.deltaPercent;
  const deltaType =
    deltaPct === null || Math.round(deltaPct) === 0
      ? "unchanged"
      : deltaPct > 0
        ? "increase"
        : "decrease";

  // Ad cost as a share of sales is the plainest "is this sane" number for a
  // board: "z każdych 100 zł sprzedaży 18 zł poszło na reklamy".
  const adShare = totalRev > 0 ? (totalSpend / totalRev) * 100 : null;
  let takeaway: string;
  if (totalRev <= 0) {
    takeaway =
      totalSpend > 0
        ? `Google Analytics nie zanotował w tym okresie sprzedaży, choć na reklamy wydano ${aboutPln(
            totalSpend
          )}.`
        : "W tym okresie nie ma jeszcze danych o sprzedaży.";
  } else {
    const parts: string[] = [];
    if (adShare !== null && totalSpend > 0) {
      const share = adShare.toLocaleString("pl-PL", {
        maximumFractionDigits: adShare < 10 ? 1 : 0,
      });
      parts.push(`Z każdych 100 zł sprzedaży ok. ${share} zł poszło na reklamy`);
    }
    if (best) {
      parts.push(
        `najlepszym dniem był ${dayMonthPL(best.date)} (${aboutPln(best.revenueMinorUnits)})`
      );
    }
    takeaway = parts.length
      ? `${parts[0].charAt(0).toUpperCase()}${parts.join(", a ").slice(1)}.`
      : `Sklep sprzedał w tym okresie za ok. ${aboutPln(totalRev)}.`;
  }

  const chart = fullDays.map((p) => {
    const [, month, day] = p.date.split("-");
    const ly = lyByDate.get(p.date);
    return {
      date: `${day}.${month}`,
      Sprzedaż: p.revenueMinorUnits / 100,
      "Wydatki na reklamy": p.spendMinorUnits / 100,
      ...(showLy ? { "Sprzedaż rok temu": ly != null ? ly / 100 : null } : {}),
    };
  });

  return (
    <Card>
      <h3 className="text-base font-semibold">Sprzedaż dzień po dniu</h3>
      <Takeaway className="mt-3">{takeaway}</Takeaway>

      <div className="mt-5 grid gap-6 lg:grid-cols-[260px_1fr]">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">Sprzedaż w wybranym okresie</p>
          <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight text-foreground">
            {formatMoneyPLN(totalRev)}
          </p>
          {deltaPct !== null ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <BadgeDelta deltaType={deltaType} size="xs" className="tabular-nums">
                {`${deltaPct > 0 ? "+" : ""}${(Math.round(deltaPct * 10) / 10).toLocaleString(
                  "pl-PL"
                )}%`}
              </BadgeDelta>
              <span className="text-xs text-muted-foreground">
                {describeChange(deltaPct, "amount")}
              </span>
            </div>
          ) : null}

          <div className="mt-5 divide-y divide-border/60 border-y border-border/60">
            <SummaryRow dot="bg-emerald-500" label="Sprzedaż" value={compactPln(totalRev / 100)} />
            <SummaryRow
              dot="bg-indigo-500"
              label="Wydatki na reklamy"
              value={compactPln(totalSpend / 100)}
            />
            {/* Not profit (no margin applied) - the profit card does that. */}
            <SummaryRow
              dot={net >= 0 ? "bg-emerald-600" : "bg-rose-500"}
              label="Po odjęciu reklam"
              value={compactPln(net / 100)}
              strong
              explain="Sprzedaż minus wydatki na reklamy. To jeszcze nie zysk - nie odjęliśmy kosztu towaru ani VAT. Zysk liczymy w karcie „Zysk po reklamach”."
            />
          </div>

          <div className="mt-4 space-y-1.5 text-xs text-muted-foreground">
            <p>
              Średnio dziennie:{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {compactPln(avgDaily / 100)}
              </span>
            </p>
            {best ? (
              <p>
                Najlepszy dzień:{" "}
                <span className="font-semibold tabular-nums text-foreground">
                  {dayMonthPL(best.date)} · {compactPln(best.revenueMinorUnits / 100)}
                </span>
              </p>
            ) : null}
          </div>
        </div>

        <div className="min-w-0">
          <AreaChart
            className="h-64 sm:h-72 lg:h-80"
            data={chart}
            index="date"
            categories={
              showLy
                ? ["Sprzedaż", "Sprzedaż rok temu", "Wydatki na reklamy"]
                : ["Sprzedaż", "Wydatki na reklamy"]
            }
            colors={showLy ? ["emerald", "slate", "indigo"] : ["emerald", "indigo"]}
            valueFormatter={compactPln}
            yAxisWidth={76}
            showLegend
            showAnimation
            curveType="monotone"
          />
          {todayPoint ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Wykres kończy się na wczoraj - dzisiejszy dzień jeszcze trwa (do tej
              pory{" "}
              <span className="tabular-nums">{formatPlnWhole(todayPoint.revenueMinorUnits)}</span>{" "}
              sprzedaży), więc pokazalibyśmy fałszywy spadek.
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
