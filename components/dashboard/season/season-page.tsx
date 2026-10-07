import type { ReactNode } from "react";

import { SectionBoundary } from "@/components/dashboard/section-boundary";
import { StatTile } from "@/components/dashboard/stat-tile";
import { Card } from "@/components/ui/card";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { dayMonthLong, diffDaysIso } from "@/lib/season/config";
import { change, compactCount, compactPln, roasText } from "@/lib/season/format";
import type { SeasonTotals, SeasonView } from "@/lib/season/load";
import { formatNumberPL, formatPlnWhole } from "@/lib/utils";

import { SeasonChart } from "./season-chart";
import { SeasonMarkets } from "./season-markets";
import { SeasonTimeline } from "./season-timeline";

const cpc = (t: SeasonTotals) => (t.clicks > 0 ? t.spend / t.clicks : 0);
const roas = (t: SeasonTotals) => (t.spend > 0 ? t.value / t.spend : 0);

/**
 * The "Sezon" page for clients who earn in one window a year. It answers,
 * in this order: where are we in the season, are we ahead of last season at
 * the same point, where will it end, which markets carry it. Shared by the
 * real page and the demo (/demo-full/sezon).
 */
export function SeasonPageView({
  view,
  showRevenue,
  isAgency,
  eyebrowExtra,
}: {
  view: SeasonView;
  /** Shop clients: sales and ROAS. Others see clicks and cost only. */
  showRevenue: boolean;
  isAgency: boolean;
  eyebrowExtra?: ReactNode;
}) {
  const { state, totals, prevSamePoint, prevFull, hasPrev, forecast, today } = view;
  const running = state.phase === "in";
  const seasonLabel = `Sezon ${state.current.year}`;
  const prevLabel = `Sezon ${state.previous.year}`;
  // Genitive for "na tle / względem sezonu 2025".
  const prevGen = `sezonu ${state.previous.year}`;
  const revenue = showRevenue && view.hasValue;
  const asOfLabel = running
    ? view.asOf < today
      ? `do wczoraj (${dayMonthLong(view.asOf)})`
      : "od dziś"
    : "łącznie";

  // The one sentence a board reads first.
  let lead: string;
  const ch = revenue ? change(totals.value, prevSamePoint.value) : change(totals.clicks, prevSamePoint.clicks);
  const what = revenue
    ? `${compactPln(totals.value)} sprzedaży z reklam`
    : `${compactCount(totals.clicks)} kliknięć w reklamy`;
  if (!running) {
    lead = hasPrev && ch
      ? `${seasonLabel}: ${what} - ${ch.ratio >= 0 ? `o ${ch.text} więcej` : `o ${ch.text} mniej`} niż ${prevLabel.toLowerCase()}.`
      : `${seasonLabel}: ${what}.`;
  } else if (state.day === 1) {
    lead = `Pierwszy dzień sezonu - pierwsze liczby pojawią się tu jutro, porównane z sezonem ${state.previous.year} dzień w dzień.`;
  } else if (hasPrev && ch) {
    lead = `Sezon idzie ${ch.ratio >= 0 ? `o ${ch.text} lepiej` : `o ${ch.text} słabiej`} niż ${prevLabel.toLowerCase()} w tym samym momencie: ${what} ${asOfLabel}.`;
  } else {
    lead = `${what[0].toUpperCase()}${what.slice(1)} ${asOfLabel}.`;
  }

  const spark = (pick: (d: SeasonView["days"][number]) => number | null) =>
    view.days
      .filter((d) => d.date <= view.asOf)
      .map((d) => pick(d) ?? 0)
      .slice(-30);
  // Day 1 compares nothing yet (load.ts): no "last season: 0 zł" lines.
  const comparable = hasPrev && (prevSamePoint.spend > 0 || prevSamePoint.clicks > 0);
  const compareFoot = (text: string) =>
    comparable ? (
      <>
        {running ? `${prevLabel} w tym momencie` : prevLabel}: <b className="font-medium text-ink-2">{text}</b>
      </>
    ) : null;

  const tiles = revenue
    ? [
        <StatTile
          key="value"
          index={0}
          highlight
          label="Sprzedaż z reklam"
          explain="Wartość zamówień, które Meta i Google przypisują reklamom (ich własne śledzenie konwersji), od początku sezonu."
          value={formatPlnWhole(totals.value)}
          delta={change(totals.value, prevSamePoint.value)}
          spark={spark((d) => d.value)}
          sub={
            view.todayTotals && view.todayTotals.value > 0
              ? `dziś do teraz: ${formatPlnWhole(view.todayTotals.value)}`
              : undefined
          }
          foot={compareFoot(formatPlnWhole(prevSamePoint.value))}
        />,
        <StatTile
          key="roas"
          index={1}
          label="Zwrot z reklam"
          explain="Ile złotych sprzedaży przypada na 1 zł wydany na reklamy (ROAS)."
          value={roasText(totals.value, totals.spend)}
          delta={change(roas(totals), roas(prevSamePoint))}
          sub={totals.spend > 0 ? `z 1 zł reklamy: ${(roas(totals)).toLocaleString("pl-PL", { maximumFractionDigits: 2 })} zł sprzedaży` : undefined}
          foot={compareFoot(roasText(prevSamePoint.value, prevSamePoint.spend))}
        />,
        <StatTile
          key="orders"
          index={2}
          label="Zamówienia"
          explain="Zakupy przypisane reklamom przez Meta i Google."
          value={formatNumberPL(totals.purchases)}
          delta={change(totals.purchases, prevSamePoint.purchases)}
          sub={
            totals.purchases > 0
              ? `śr. zamówienie ${formatPlnWhole(totals.value / totals.purchases)}`
              : undefined
          }
          foot={compareFoot(formatNumberPL(prevSamePoint.purchases))}
        />,
        <StatTile
          key="spend"
          index={3}
          label="Wydatki na reklamy"
          explain="Meta i Google łącznie, od początku sezonu."
          value={formatPlnWhole(totals.spend)}
          delta={change(totals.spend, prevSamePoint.spend, { neutral: true })}
          spark={spark((d) => d.spend)}
          foot={compareFoot(formatPlnWhole(prevSamePoint.spend))}
        />,
      ]
    : [
        <StatTile
          key="clicks"
          index={0}
          highlight
          label="Kliknięcia"
          explain="Kliknięcia w reklamy Meta i Google od początku sezonu."
          value={formatNumberPL(totals.clicks)}
          delta={change(totals.clicks, prevSamePoint.clicks)}
          spark={spark((d) => d.clicks)}
          foot={compareFoot(formatNumberPL(prevSamePoint.clicks))}
        />,
        <StatTile
          key="cpc"
          index={1}
          label="Koszt kliknięcia"
          explain="Średnio tyle kosztowało jedno kliknięcie w reklamę."
          value={totals.clicks > 0 ? `${(cpc(totals) / 100).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł` : "-"}
          delta={change(cpc(totals), cpc(prevSamePoint), { higherIsBetter: false })}
          foot={compareFoot(
            prevSamePoint.clicks > 0
              ? `${(cpc(prevSamePoint) / 100).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`
              : "-"
          )}
        />,
        <StatTile
          key="spend"
          index={2}
          label="Wydatki na reklamy"
          explain="Meta i Google łącznie, od początku sezonu."
          value={formatPlnWhole(totals.spend)}
          delta={change(totals.spend, prevSamePoint.spend, { neutral: true })}
          spark={spark((d) => d.spend)}
          foot={compareFoot(formatPlnWhole(prevSamePoint.spend))}
        />,
      ];

  const todayIdx = running ? diffDaysIso(state.current.start, today) : null;

  return (
    <div className="min-w-0 space-y-8 px-4 py-6 sm:px-6 md:py-8">
      <PageHeader
        eyebrow={
          <span className="kick">
            {running ? `${seasonLabel} · dzień ${state.day} z ${state.totalDays}` : `${seasonLabel} · podsumowanie`}
            {eyebrowExtra}
          </span>
        }
        title="Sezon"
        description={lead}
      />

      <SectionBoundary name="season/timeline">
        <SeasonTimeline state={state} today={today} moments={view.moments} />
      </SectionBoundary>

      <SectionBoundary name="season/kpis">
        <div className={revenue ? "grid gap-4 sm:grid-cols-2 xl:grid-cols-4" : "grid gap-4 sm:grid-cols-3"}>
          {tiles}
        </div>
      </SectionBoundary>

      <SectionBoundary name="season/chart">
        <Card className="space-y-4 p-5 sm:p-6">
          <SectionHeader
            title={revenue ? "Sprzedaż z reklam przez cały sezon" : "Kliknięcia przez cały sezon"}
            description={
              hasPrev
                ? `${seasonLabel} na tle ${prevGen}, dzień w dzień. Najedź na wykres, żeby porównać konkretny dzień.`
                : "Pierwszy sezon w panelu - za rok zobaczysz tu porównanie dzień w dzień."
            }
          />
          <SeasonChart
            days={view.days}
            moments={view.moments}
            todayIdx={todayIdx}
            metric={revenue ? "value" : "clicks"}
            seasonLabel={seasonLabel}
            prevLabel={prevLabel}
          />
          <SeasonFacts view={view} revenue={revenue} prevLabel={prevLabel} seasonLabel={seasonLabel} />
          {forecast && revenue ? (
            <p className="rounded-[18px] bg-chip px-4 py-3 text-[14.5px] leading-relaxed text-ink-2">
              <b className="font-semibold text-foreground">Prognoza:</b> jeśli reszta sezonu pójdzie
              jak w {prevLabel.toLowerCase().replace("sezon", "sezonie")}, {seasonLabel.toLowerCase()} zamknie się
              na ok. <b className="font-semibold text-foreground">{compactPln(forecast.value)}</b> sprzedaży z
              reklam ({prevLabel.toLowerCase()}: {compactPln(prevFull.value)}).
            </p>
          ) : null}
        </Card>
      </SectionBoundary>

      <SectionBoundary name="season/markets">
        <SeasonMarkets
          markets={view.markets}
          showRevenue={revenue}
          prevGen={prevGen}
          unmappedShare={view.unmappedShare}
          isAgency={isAgency}
        />
      </SectionBoundary>
    </div>
  );
}

/** Best day this season and last - the peaks people remember. */
function SeasonFacts({
  view,
  revenue,
  prevLabel,
  seasonLabel,
}: {
  view: SeasonView;
  revenue: boolean;
  prevLabel: string;
  seasonLabel: string;
}) {
  if (!revenue) return null;
  const items: string[] = [];
  if (view.bestDay) {
    items.push(
      `Najlepszy dzień: ${seasonLabel.toLowerCase()} - ${dayMonthLong(view.bestDay.date)} (${compactPln(view.bestDay.value)})`
    );
  }
  if (view.hasPrev && view.prevBestDay) {
    items.push(
      `${prevLabel} - ${dayMonthLong(view.prevBestDay.date)} (${compactPln(view.prevBestDay.value)})`
    );
  }
  if (!items.length) return null;
  return <p className="text-[13.5px] text-ink-3">{items.join(" · ")}</p>;
}
