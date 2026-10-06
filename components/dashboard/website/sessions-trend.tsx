"use client";

import { LineChart } from "@tremor/react";

import { Card } from "@/components/ui/card";

import { formatNumberPL } from "@/lib/utils";

// TODO: split the trend by source category (paid/organic/social/direct) once
// ga4_daily stores per-day source breakdowns; today it holds daily totals.
export function SessionsTrend({
  trend,
  lang = "pl",
}: {
  trend: Array<{ date: string; sessions: number }>;
  lang?: "pl" | "en";
}) {
  const en = lang === "en";
  const key = en ? "Sessions" : "Wizyty";
  const data = trend.map((p) => {
    const [, month, day] = p.date.split("-");
    return { date: `${day}.${month}`, [key]: p.sessions };
  });

  const total = trend.reduce((a, p) => a + p.sessions, 0);
  // One day draws no area at all and an all-zero range is a flat line on the
  // floor; Tremor's own fallback is an English "No data". Say why instead.
  const empty =
    total <= 0
      ? en
        ? "Google Analytics data appears after the first sync."
        : "Dane z Google Analytics pojawią się po pierwszej synchronizacji."
      : trend.length < 2
        ? en
          ? "Not enough days for a trend yet - check back in a few days."
          : "Za mało dni, by narysować trend - wróć za kilka dni."
        : null;

  // Screen readers can't read the area shape; give them the takeaway instead.
  const peak = trend.reduce<{ date: string; sessions: number } | null>(
    (best, p) => (!best || p.sessions > best.sessions ? p : best),
    null
  );
  const peakLabel = peak ? data[trend.indexOf(peak)]?.date : null;
  const summary =
    !empty && peak
      ? en
        ? `${formatNumberPL(total)} sessions over ${trend.length} days, about ${formatNumberPL(Math.round(total / trend.length))} a day. Busiest day: ${peakLabel} (${formatNumberPL(peak.sessions)}).`
        : `Łącznie ${formatNumberPL(total)} wizyt w ${trend.length} dni, średnio ${formatNumberPL(Math.round(total / trend.length))} dziennie. Najwięcej: ${peakLabel} (${formatNumberPL(peak.sessions)}).`
      : null;

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-section-title text-foreground">
        {en ? "Sessions - last 30 days" : "Wizyty na stronie dzień po dniu"}
      </h2>
      {summary ? <p className="sr-only">{summary}</p> : null}
      {empty ? (
        <div className="mt-4 flex h-64 items-center justify-center rounded-lg border border-dashed border-border px-4 text-center text-sm text-muted-foreground">
          {empty}
        </div>
      ) : (
      <LineChart
        className="mt-4 h-64"
        data={data}
        index="date"
        categories={[key]}
        colors={["indigo"]}
        valueFormatter={(v) => formatNumberPL(v)}
        showLegend={false}
        yAxisWidth={56}
        curveType="monotone"
      />
      )}
    </Card>
  );
}
