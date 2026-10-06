"use client";

import { LineChart } from "@tremor/react";

import { Card } from "@/components/ui/card";
import { usePrefersReducedMotion } from "@/components/dashboard/use-reduced-motion";
import type { Kpi, TrendPoint } from "@/lib/dashboard/metrics";
import { dayMonthPL } from "@/lib/dashboard/story";
import { formatNumberPL, formatPlnWhole } from "@/lib/utils";

import { aboutPln, todayWarsawIso } from "./plain";

// Non-breaking spaces: Recharts wraps axis ticks on plain spaces, which split
// the top tick into "12 tys." / "zł" on two lines.
const compactPln = (zl: number) => {
  if (Math.abs(zl) >= 1_000_000)
    return `${(zl / 1_000_000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} mln zł`;
  if (Math.abs(zl) >= 1_000)
    return `${(zl / 1_000).toLocaleString("pl-PL", { maximumFractionDigits: 0 })} tys. zł`;
  return `${formatNumberPL(zl)} zł`;
};

const SALES = "Sprzedaż";
const LAST_YEAR = "Rok temu";

// "How sales went, day by day": the page's one chart. Sales as a solid line,
// the same days last year as a dashed grey line when that history is
// reliable. Totals live in the KPI row above and spend/profit in the
// details, so the card is just the shape of the period plus one sentence.
export function SalesOverview({
  trend,
  lastYear,
}: {
  trend: TrendPoint[];
  /** Kept for callers; the revenue total and change now live in the KPI row. */
  revenueKpi?: Kpi;
  thinBase?: boolean;
  /** Last year's revenue per current date (52-week aligned), when reliable. */
  lastYear?: Array<{ date: string; revenue: number | null }> | null;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const lyByDate = new Map((lastYear ?? []).map((p) => [p.date, p.revenue]));
  const showLy = lyByDate.size > 0;
  const totalRev = trend.reduce((a, p) => a + p.revenueMinorUnits, 0);
  const totalSpend = trend.reduce((a, p) => a + p.spendMinorUnits, 0);
  // The curve uses finished days only - a half-synced today would plunge the
  // end of the chart and read as "sales crashed".
  const today = todayWarsawIso();
  const fullDays = trend.filter((p) => p.date < today);
  const todayPoint = trend.find((p) => p.date === today) ?? null;
  const best = fullDays.reduce<TrendPoint | null>(
    (m, p) => (p.revenueMinorUnits > (m?.revenueMinorUnits ?? 0) ? p : m),
    null
  );

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
    if (best) {
      parts.push(
        `Najlepszym dniem był ${dayMonthPL(best.date)} (${aboutPln(best.revenueMinorUnits)})`
      );
    }
    if (adShare !== null && totalSpend > 0) {
      const share = adShare.toLocaleString("pl-PL", {
        maximumFractionDigits: adShare < 10 ? 1 : 0,
      });
      parts.push(`z każdych 100 zł sprzedaży ok. ${share} zł poszło na reklamy`);
    }
    takeaway = parts.length
      ? `${parts.join(", a ")}.`
      : `Sklep sprzedał w tym okresie za ok. ${aboutPln(totalRev)}.`;
  }

  const chart = fullDays.map((p) => {
    const [, month, day] = p.date.split("-");
    const ly = lyByDate.get(p.date);
    return {
      date: `${day}.${month}`,
      [SALES]: p.revenueMinorUnits / 100,
      ...(showLy ? { [LAST_YEAR]: ly != null ? ly / 100 : null } : {}),
    };
  });

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-section-title text-foreground">Sprzedaż dzień po dniu</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{takeaway}</p>

      {/* Fewer than two finished days gives Tremor nothing to draw but an
          English "No data". Say why instead. */}
      {chart.length < 2 || totalRev <= 0 ? (
        <div className="mt-5 flex h-64 items-center justify-center rounded-lg border border-dashed border-border px-4 text-center text-sm text-muted-foreground sm:h-72">
          {chart.length < 2
            ? "Za mało dni, by narysować wykres - wróć za kilka dni."
            : "Wykres pojawi się, gdy Google Analytics zarejestruje pierwszą sprzedaż."}
        </div>
      ) : (
        <LineChart
          // Last year is the comparison, not the news: grey and dashed.
          className="mt-5 h-64 sm:h-72 [&_.recharts-line.stroke-slate-500_.recharts-line-curve]:[stroke-dasharray:5_5]"
          data={chart}
          index="date"
          categories={showLy ? [SALES, LAST_YEAR] : [SALES]}
          colors={showLy ? ["indigo", "slate"] : ["indigo"]}
          valueFormatter={compactPln}
          yAxisWidth={72}
          showLegend={showLy}
          showAnimation={!reducedMotion}
          curveType="monotone"
          connectNulls
          role="img"
          aria-label={`Wykres sprzedaży dzień po dniu. ${takeaway}`}
        />
      )}
      {todayPoint ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Bez dzisiejszego, niepełnego dnia (do tej pory{" "}
          <span className="tabular-nums">{formatPlnWhole(todayPoint.revenueMinorUnits)}</span>)
          - doliczymy go jutro.
        </p>
      ) : null}
    </Card>
  );
}
