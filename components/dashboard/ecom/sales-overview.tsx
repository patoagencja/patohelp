"use client";

import type React from "react";

import { Card } from "@/components/ui/card";
import { TrendLineChart, type TrendLinePoint } from "@/components/dashboard/trend-line-chart";
import type { Kpi, TrendPoint } from "@/lib/dashboard/metrics";
import { dayMonthPL } from "@/lib/dashboard/story";
import { formatNumberPL, formatPlnWhole } from "@/lib/utils";

import { aboutPln, todayWarsawIso } from "./plain";

// Non-breaking spaces keep "12 tys. zł" one token on the axis.
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
  // board: "z każdych 100 zł sprzedaży 18 zł poszło na reklamy". The best day
  // is set bold, as the one fact to take away (the chart pins it too).
  const adShare = totalRev > 0 ? (totalSpend / totalRev) * 100 : null;
  let takeaway: string;
  let lead: React.ReactNode;
  if (totalRev <= 0) {
    takeaway =
      totalSpend > 0
        ? `Google Analytics nie zanotował w tym okresie sprzedaży, choć na reklamy wydano ${aboutPln(
            totalSpend
          )}.`
        : "W tym okresie nie ma jeszcze danych o sprzedaży.";
    lead = takeaway;
  } else {
    // Exact whole złoty, not aboutPln(): the chart pins this same day with
    // its exact value right below, and "(11 000 zł)" next to a "10 590 zł"
    // tooltip reads as two different numbers.
    const bestText = best
      ? `${dayMonthPL(best.date)} (${formatPlnWhole(best.revenueMinorUnits)})`
      : null;
    const shareText =
      adShare !== null && totalSpend > 0
        ? `z każdych 100 zł sprzedaży ok. ${adShare.toLocaleString("pl-PL", {
            maximumFractionDigits: adShare < 10 ? 1 : 0,
          })} zł poszło na reklamy`
        : null;
    if (bestText) {
      takeaway = `Najlepszym dniem był ${bestText}${shareText ? `, a ${shareText}` : ""}.`;
      lead = (
        <>
          Najlepszym dniem był <b className="font-medium text-foreground">{bestText}</b>
          {shareText ? `, a ${shareText}` : ""}.
        </>
      );
    } else {
      takeaway = shareText
        ? `${shareText.charAt(0).toUpperCase()}${shareText.slice(1)}.`
        : `Sklep sprzedał w tym okresie za ok. ${aboutPln(totalRev)}.`;
      lead = takeaway;
    }
  }

  // Złoty, not grosze: the axis and tooltip speak whole money.
  const chart: TrendLinePoint[] = fullDays.map((p) => {
    const ly = lyByDate.get(p.date);
    return {
      date: p.date,
      value: p.revenueMinorUnits / 100,
      compare: showLy ? (ly != null ? ly / 100 : null) : undefined,
    };
  });

  return (
    <Card className="rounded-glass p-6 sm:p-[28px_30px]">
      <p className="kick">Przychód ze sklepu</p>
      <h2 className="mt-2 text-[22px] font-medium tracking-[-0.03em]">Sprzedaż dzień po dniu</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{lead}</p>

      {/* Fewer than two finished days draw no line at all - say why. */}
      {chart.length < 2 || totalRev <= 0 ? (
        <div className="mt-6 flex h-64 items-center justify-center rounded-[22px] bg-chip px-4 text-center text-sm text-ink-2 sm:h-72">
          {chart.length < 2
            ? "Za mało dni, by narysować wykres - wróć za kilka dni."
            : "Wykres pojawi się, gdy Google Analytics zarejestruje pierwszą sprzedaż."}
        </div>
      ) : (
        <div className="mt-5">
        <TrendLineChart
          // Last year is the comparison, not the news: grey and dashed.
          className="h-64 sm:h-72"
          points={chart}
          valueLabel={SALES}
          compareLabel={showLy ? LAST_YEAR : undefined}
          formatValue={(zl) => formatPlnWhole(Math.round(zl * 100))}
          formatAxis={compactPln}
          ariaLabel={`Wykres sprzedaży dzień po dniu. ${takeaway}`}
          highlightIndex={best ? fullDays.indexOf(best) : null}
          highlightNote="najlepszy dzień"
        />
        </div>
      )}
      {todayPoint ? (
        <p className="mt-3 text-[13px] text-ink-3">
          Bez dzisiejszego, niepełnego dnia (do tej pory{" "}
          <span className="tabular-nums">{formatPlnWhole(todayPoint.revenueMinorUnits)}</span>)
          - doliczymy go jutro.
        </p>
      ) : null}
    </Card>
  );
}
