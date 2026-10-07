import type { ReactNode } from "react";

import { SectionBoundary } from "@/components/dashboard/section-boundary";
import { StatTile } from "@/components/dashboard/stat-tile";
import { Card } from "@/components/ui/card";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { plPlural } from "@/lib/dashboard/story";
import { addDaysIso, dayMonthLong, diffDaysIso } from "@/lib/season/config";
import type { SeasonForecast } from "@/lib/season/forecast";
import { change, compactCount, compactPln, roasText } from "@/lib/season/format";
import type { SeasonTotals, SeasonView } from "@/lib/season/load";
import { formatNumberPL, formatPlnWhole } from "@/lib/utils";

import { coversWigilia } from "@/lib/season/festive";

import { SantaHat, Snowfall } from "./festive";
import { SeasonChart } from "./season-chart";
import { SeasonMarkets } from "./season-markets";
import { SeasonProducts } from "./season-products";
import { SeasonTimeline } from "./season-timeline";

const cpc = (t: SeasonTotals) => (t.clicks > 0 ? t.spend / t.clicks : 0);
const roas = (t: SeasonTotals) => (t.spend > 0 ? t.value / t.spend : 0);
const ratio = (rev: number, spend: number) => (spend > 0 && rev > 0 ? rev / spend : 0);
const times = (v: number) =>
  v > 0 ? `${v.toLocaleString("pl-PL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×` : "-";
const clicksWord = (n: number) => plPlural(n, "kliknięcie", "kliknięcia", "kliknięć");

/**
 * The "Sezon" page for clients who earn in one window a year. It answers,
 * in this order: where are we in the season, are we ahead of last season at
 * the same point, where will it end, which markets and products carry it.
 * Shared by the real page and the demo (/demo-full/sezon).
 *
 * Terms (one name per thing across the page): "Sprzedaż sklepu" = the shop's
 * own panel; "Sprzedaż z reklam (wg Meta i Google)" = what the platforms
 * attribute to themselves; "Zwrot ze sprzedaży sklepu" = shop sales / all ad
 * spend (MER); "Zwrot wg Meta i Google" = the platforms' own ROAS.
 */
export function SeasonPageView({
  view,
  showRevenue,
  isAgency,
  eyebrowExtra,
}: {
  view: SeasonView;
  /** Shop clients: sales and returns. Others see clicks and cost only. */
  showRevenue: boolean;
  isAgency: boolean;
  eyebrowExtra?: ReactNode;
}) {
  const { state, totals, prevSamePoint, prevFull, hasPrev, forecast, today } = view;
  const running = state.phase === "in";
  // Seasons through Christmas Eve get snow and a Santa hat (the timeline
  // already counts down to Wigilia) - only while the season runs.
  const festive = running && coversWigilia(state.current);
  const prevYear = state.previous.year;
  const seasonLabel = `Sezon ${state.current.year}`;
  const prevLabel = `Sezon ${prevYear}`;
  // Cases: "na tle / względem sezonu 2025", "w sezonie 2025".
  const prevGen = `sezonu ${prevYear}`;
  const prevLoc = `w sezonie ${prevYear}`;
  // The shop's own sales lead when the shop sends them; ad-attributed sales
  // stay as the second opinion (and the only one without a shop feed).
  const shop = showRevenue ? view.shop : null;
  const revenue = showRevenue && (view.hasValue || !!shop);
  const shopComparable = !!shop?.hasPrev && (shop.prevSamePoint.revenue > 0 || shop.prevSamePoint.orders > 0);
  // Day 1 compares nothing yet (load.ts): no "last season: 0 zł" lines.
  const comparable = hasPrev && (prevSamePoint.spend > 0 || prevSamePoint.clicks > 0);
  const compareAsOf = shop?.asOf ?? view.asOf;
  const asOfLabel = running
    ? compareAsOf < today
      ? compareAsOf === addDaysIso(today, -1)
        ? `do wczoraj (${dayMonthLong(compareAsOf)})`
        : `do ${dayMonthLong(compareAsOf)}`
      : "od dziś"
    : "łącznie";

  // The one sentence a board reads first.
  const ch = shop
    ? shopComparable
      ? change(shop.totals.revenue, shop.prevSamePoint.revenue)
      : null
    : comparable
      ? revenue
        ? change(totals.value, prevSamePoint.value)
        : change(totals.clicks, prevSamePoint.clicks)
      : null;
  const what = shop
    ? `${compactPln(shop.totals.revenue)} sprzedaży w sklepie`
    : revenue
      ? `${compactPln(totals.value)} sprzedaży z reklam (wg Meta i Google)`
      : `${compactCount(totals.clicks)} ${clicksWord(totals.clicks)} w reklamy`;
  const more = (c: NonNullable<typeof ch>) => (c.ratio >= 0 ? `o ${c.text} więcej` : `o ${c.text} mniej`);
  let lead: string;
  if (!running) {
    lead = ch ? `${seasonLabel}: ${what} - ${more(ch)} niż ${prevLoc}.` : `${seasonLabel}: ${what}.`;
  } else if (state.day === 1) {
    lead = hasPrev
      ? `Pierwszy dzień sezonu - dzisiejsze liczby rosną na bieżąco. Porównanie z sezonem ${prevYear} dzień w dzień zobaczysz od jutra.`
      : "Pierwszy dzień sezonu - dzisiejsze liczby rosną na bieżąco. Za rok zobaczysz tu porównanie z tym sezonem.";
  } else if (ch) {
    lead =
      revenue || shop
        ? `Sezon idzie ${ch.ratio >= 0 ? `o ${ch.text} lepiej` : `o ${ch.text} słabiej`} niż ${prevLoc} w tym samym momencie: ${what} ${asOfLabel}.`
        : `Reklamy przyniosły ${more(ch)} kliknięć niż ${prevLoc} w tym samym momencie: ${what} ${asOfLabel}.`;
  } else {
    lead = `${what[0].toUpperCase()}${what.slice(1)} ${asOfLabel}.`;
  }

  const spark = (pick: (d: SeasonView["days"][number]) => number | null) =>
    view.days
      .filter((d) => d.date <= view.asOf)
      .map((d) => pick(d) ?? 0)
      .slice(-30);
  const footWith = (ok: boolean) => (text: string) =>
    ok ? (
      <>
        {running ? `${prevLabel} w tym momencie` : prevLabel}: <b className="font-medium text-ink-2">{text}</b>
      </>
    ) : null;
  const compareFoot = footWith(comparable);
  const shopFoot = footWith(shopComparable);
  const todaySub = (v: number | null | undefined) =>
    v && v > 0 ? `dziś do tej pory: ${formatPlnWhole(v)}` : undefined;
  const spendTile = (index: number) => (
    <StatTile
      key="spend"
      index={index}
      label="Wydatki na reklamy"
      explain="Wszystkie kampanie reklamowe łącznie (netto), od początku sezonu."
      value={formatPlnWhole(totals.spend)}
      delta={comparable ? change(totals.spend, prevSamePoint.spend, { neutral: true }) : null}
      spark={spark((d) => d.spend)}
      foot={compareFoot(formatPlnWhole(prevSamePoint.spend))}
    />
  );

  const tiles = shop
    ? [
        <StatTile
          key="shop"
          index={0}
          highlight
          label="Sprzedaż sklepu"
          explain="Wszystkie zamówienia z panelu sprzedażowego sklepu (brutto), od początku sezonu - niezależnie od tego, skąd przyszedł klient."
          value={formatPlnWhole(shop.totals.revenue)}
          delta={shopComparable ? change(shop.totals.revenue, shop.prevSamePoint.revenue) : null}
          spark={view.days.filter((d) => d.date <= shop.asOf).map((d) => shop.days[d.i] ?? 0).slice(-30)}
          sub={
            shop.pending.revenue > 0
              ? `+ ${formatPlnWhole(shop.pending.revenue)} czeka na płatność`
              : todaySub(shop.today?.revenue)
          }
          foot={shopFoot(formatPlnWhole(shop.prevSamePoint.revenue))}
        />,
        <StatTile
          key="mer"
          index={1}
          label="Zwrot ze sklepu"
          explain="Cała sprzedaż sklepu (brutto) podzielona przez wszystkie wydatki na reklamy (MER). Uczciwszy niż zwrot podawany przez Meta i Google, bo każda z nich liczy u siebie to samo zamówienie."
          value={times(ratio(shop.totals.revenue, totals.spend))}
          delta={
            shopComparable
              ? change(ratio(shop.totals.revenue, totals.spend), ratio(shop.prevSamePoint.revenue, prevSamePoint.spend))
              : null
          }
          sub={view.hasValue ? `wg Meta i Google: ${roasText(totals.value, totals.spend)}` : undefined}
          foot={shopFoot(times(ratio(shop.prevSamePoint.revenue, prevSamePoint.spend)))}
        />,
        <StatTile
          key="orders"
          index={2}
          label="Zamówienia"
          explain="Opłacone zamówienia z panelu sprzedażowego sklepu."
          value={formatNumberPL(shop.totals.orders)}
          delta={shopComparable ? change(shop.totals.orders, shop.prevSamePoint.orders) : null}
          sub={
            shop.totals.orders > 0
              ? `śr. zamówienie ${formatPlnWhole(shop.totals.revenue / shop.totals.orders)}`
              : undefined
          }
          foot={shopFoot(formatNumberPL(shop.prevSamePoint.orders))}
        />,
        spendTile(3),
      ]
    : revenue
      ? [
          <StatTile
            key="value"
            index={0}
            highlight
            label="Sprzedaż z reklam"
            explain="Wartość zamówień, które Meta i Google przypisują swoim reklamom (ich własne śledzenie), od początku sezonu. Gdy obie platformy dotknęły tego samego zamówienia, obie je liczą."
            value={formatPlnWhole(totals.value)}
            delta={comparable ? change(totals.value, prevSamePoint.value) : null}
            spark={spark((d) => d.value)}
            sub={todaySub(view.todayTotals?.value)}
            foot={compareFoot(formatPlnWhole(prevSamePoint.value))}
          />,
          <StatTile
            key="roas"
            index={1}
            label="Zwrot wg Meta i Google"
            explain="Ile złotych sprzedaży przypisanej reklamom przypada na 1 zł wydany na reklamy (ROAS)."
            value={roasText(totals.value, totals.spend)}
            delta={comparable ? change(roas(totals), roas(prevSamePoint)) : null}
            sub={
              totals.spend > 0
                ? `z 1 zł reklamy: ${roas(totals).toLocaleString("pl-PL", { maximumFractionDigits: 2 })} zł sprzedaży`
                : undefined
            }
            foot={compareFoot(roasText(prevSamePoint.value, prevSamePoint.spend))}
          />,
          <StatTile
            key="orders"
            index={2}
            label="Zamówienia z reklam"
            explain="Zakupy, które Meta i Google przypisują swoim reklamom."
            value={formatNumberPL(totals.purchases)}
            delta={comparable ? change(totals.purchases, prevSamePoint.purchases) : null}
            sub={
              totals.purchases > 0
                ? `śr. zamówienie ${formatPlnWhole(totals.value / totals.purchases)}`
                : undefined
            }
            foot={compareFoot(formatNumberPL(prevSamePoint.purchases))}
          />,
          spendTile(3),
        ]
      : [
          <StatTile
            key="clicks"
            index={0}
            highlight
            label="Kliknięcia"
            explain="Kliknięcia w reklamy od początku sezonu."
            value={formatNumberPL(totals.clicks)}
            delta={comparable ? change(totals.clicks, prevSamePoint.clicks) : null}
            spark={spark((d) => d.clicks)}
            foot={compareFoot(formatNumberPL(prevSamePoint.clicks))}
          />,
          <StatTile
            key="cpc"
            index={1}
            label="Koszt kliknięcia"
            explain="Średnio tyle kosztowało jedno kliknięcie w reklamę."
            value={
              totals.clicks > 0
                ? `${(cpc(totals) / 100).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`
                : "-"
            }
            delta={comparable ? change(cpc(totals), cpc(prevSamePoint), { higherIsBetter: false }) : null}
            foot={compareFoot(
              prevSamePoint.clicks > 0
                ? `${(cpc(prevSamePoint) / 100).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`
                : "-"
            )}
          />,
          spendTile(2),
        ];

  const todayIdx = running ? diffDaysIso(state.current.start, today) : null;
  const projection: SeasonForecast | null = shop ? shop.forecast : revenue ? forecast : null;
  const projectionPrev = shop ? shop.prevFull.revenue : prevFull.value;

  // Notes that change how the numbers should be read - for the client too.
  const notes: string[] = [];
  if (shop && running && shop.lastDate && shop.lastDate < addDaysIso(today, -1)) {
    notes.push(
      `Sprzedaż ze sklepu mamy do ${dayMonthLong(shop.lastDate)} - porównujemy do tego dnia.${
        isAgency ? " Sprawdź wysyłkę w Ustawieniach → Panel sprzedażowy sklepu." : ""
      }`
    );
  }
  if (shop && running) {
    notes.push(
      "Zamówienia można opłacić do 10 dni po złożeniu - sprzedaż z ostatnich dni jeszcze urośnie."
    );
  }
  if (view.prevPartialFrom) {
    notes.push(
      `Dane ${prevGen} mamy dopiero od ${dayMonthLong(view.prevPartialFrom)} - porównanie z nim jest niepełne.`
    );
  }

  return (
    <div className="min-w-0 space-y-8 px-4 py-6 sm:px-6 md:py-8">
      <div className="relative">
        {festive ? <Snowfall className="-inset-x-4 -top-8 bottom-auto h-80 sm:-inset-x-6" /> : null}
        <PageHeader
          className="relative"
          eyebrow={
            <span className="kick">
              {running ? `${seasonLabel} · dzień ${state.day} z ${state.totalDays}` : `${seasonLabel} · podsumowanie`}
              {eyebrowExtra}
            </span>
          }
          title={
            festive ? (
              <span className="relative inline-block">
                <SantaHat className="absolute -left-3 -top-2.5 h-6 w-8 -rotate-[20deg] md:-top-3 md:h-7 md:w-9" />
                Sezon
              </span>
            ) : (
              "Sezon"
            )
          }
          description={lead}
        />
      </div>

      {notes.length ? (
        <ul className="space-y-1.5 rounded-[18px] bg-chip px-4 py-3 text-[13.5px] leading-relaxed text-ink-2">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}

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
            title={
              shop
                ? "Sprzedaż przez cały sezon"
                : revenue
                  ? "Sprzedaż z reklam przez cały sezon"
                  : "Kliknięcia przez cały sezon"
            }
            description={
              hasPrev
                ? `${seasonLabel} na tle ${prevGen}, dzień w dzień. Najedź na wykres lub dotknij go, żeby porównać konkretny dzień.`
                : "Pierwszy sezon w panelu - za rok zobaczysz tu porównanie dzień w dzień."
            }
          />
          <SeasonChart
            days={view.days}
            moments={view.moments}
            prevMoments={view.prevMoments}
            todayIdx={todayIdx}
            metric={revenue ? "value" : "clicks"}
            shop={
              shop
                ? { days: shop.days, prevDays: shop.prevDays, lastDate: shop.lastDate, hasPrev: shop.hasPrev }
                : null
            }
            seasonLabel={seasonLabel}
            prevGen={prevGen}
            prevLabel={prevLabel}
          />
          <SeasonFacts view={view} shop={shop} revenue={revenue} prevLoc={prevLoc} />
          {projection ? (
            <p className="rounded-[18px] bg-chip px-4 py-3 text-[14.5px] leading-relaxed text-ink-2">
              <b className="font-semibold text-foreground">
                {projection.preliminary ? "Prognoza wstępna:" : "Prognoza:"}
              </b>{" "}
              jeśli reszta sezonu pójdzie jak {prevLoc} (z tempem z ostatnich dwóch tygodni),{" "}
              {shop ? "sklep zamknie sezon" : "sezon zamknie się"} na ok.{" "}
              <b className="font-semibold text-foreground">{compactPln(projection.value)}</b>{" "}
              {shop ? "sprzedaży" : "sprzedaży z reklam"} (zakres {compactPln(projection.low)} -{" "}
              {compactPln(projection.high)}; {prevLabel.toLowerCase()}: {compactPln(projectionPrev)}).
            </p>
          ) : null}
        </Card>
      </SectionBoundary>

      <SectionBoundary name="season/markets">
        <SeasonMarkets
          markets={view.markets}
          shopMarkets={shop?.markets ?? null}
          showRevenue={revenue}
          prevGen={prevGen}
          running={running}
          unmappedShare={view.unmappedShare}
          isAgency={isAgency}
        />
      </SectionBoundary>

      {shop?.products.length ? (
        <SectionBoundary name="season/products">
          <SeasonProducts products={shop.products} prevGen={prevGen} hasPrev={shopComparable} running={running} />
        </SectionBoundary>
      ) : null}
    </div>
  );
}

/** Best day and the last week - the peaks and the pace people ask about. */
function SeasonFacts({
  view,
  shop,
  revenue,
  prevLoc,
}: {
  view: SeasonView;
  shop: SeasonView["shop"];
  revenue: boolean;
  prevLoc: string;
}) {
  const items: string[] = [];
  const running = view.state.phase === "in";
  // A "best day" after one or two days is just "a day".
  const enoughDays = !running || (view.state.day ?? 0) >= 3;
  if (enoughDays) {
    if (shop?.bestDay) {
      items.push(`Najlepszy dzień sklepu: ${dayMonthLong(shop.bestDay.date)} (${compactPln(shop.bestDay.revenue)})`);
    } else if (revenue && view.bestDay) {
      items.push(`Najlepszy dzień: ${dayMonthLong(view.bestDay.date)} (${compactPln(view.bestDay.value)})`);
    }
    if (revenue && !shop && view.hasPrev && view.prevBestDay) {
      items.push(`${prevLoc}: ${dayMonthLong(view.prevBestDay.date)} (${compactPln(view.prevBestDay.value)})`);
    }
  }
  if (view.last7) {
    const pick = (t: SeasonTotals) => (revenue ? t.value : t.clicks);
    const c = change(pick(view.last7.cur), pick(view.last7.prev));
    if (c) {
      items.push(
        `Ostatnie 7 dni: ${c.ratio >= 0 ? `+${c.text}` : `-${c.text}`} ${
          revenue ? "sprzedaży z reklam" : "kliknięć"
        } względem tych samych dni tygodnia rok temu`
      );
    }
  }
  if (!items.length) return null;
  return <p className="text-[13.5px] leading-relaxed text-ink-3">{items.join(" · ")}</p>;
}
