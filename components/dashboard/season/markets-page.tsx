import { Globe2 } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { change } from "@/lib/season/format";
import type { SeasonView } from "@/lib/season/load";
import { marketLabel } from "@/lib/season/markets";
import { cn, formatNumberPL, formatPlnWhole } from "@/lib/utils";

import { SeasonTabs } from "./season-tabs";

type Delta = ReturnType<typeof change>;

interface MarketCard {
  code: string;
  /** Lead figure: shop sales, else ad-attributed sales, else spend (grosze). */
  lead: number;
  leadPrev: number;
  spend: number;
  spendPrev: number;
  orders: number | null;
  ordersPrev: number | null;
  /** Daily lead figure, this season through asOf and last season in full. */
  series: Array<number | null>;
  prevSeries: Array<number | null>;
}

const times = (v: number) =>
  v > 0 ? `${v.toLocaleString("pl-PL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×` : "-";

/**
 * "Rynki": every country of a multi-market season on its own card - sales,
 * spend, return, orders and the cost of one, each against the same point of
 * last season, with the season so far drawn over last season's curve. Where
 * to add budget and where to cut, at a glance.
 */
export function MarketsPageView({
  view,
  showRevenue,
  base,
  eyebrowExtra,
}: {
  view: SeasonView;
  showRevenue: boolean;
  base: string;
  eyebrowExtra?: string;
}) {
  const running = view.state.phase === "in";
  const shop = showRevenue ? view.shop : null;
  const byShop = !!shop && Object.keys(shop.markets).filter((c) => c !== "").length >= 2;
  const revenue = showRevenue && (byShop || view.hasValue);
  const len = view.days.length;
  const asOfIdx = view.days.findIndex((d) => d.date === view.asOf);
  const cut = <T,>(list: Array<T | null>) => list.map((v, i) => (i <= asOfIdx ? v : null));
  const prevYear = view.state.previous.year;
  // The cards show state.current - before a season starts that is the last one.
  const seasonLabel = `Sezon ${view.state.current.year}`;

  const adBy = new Map(view.markets.map((m) => [m.code, m]));
  const codes = Array.from(
    new Set([...view.markets.map((m) => m.code), ...(byShop ? Object.keys(shop!.markets) : [])])
  ).filter((c) => c !== "");

  const cards: MarketCard[] = codes.map((code) => {
    const ad = adBy.get(code);
    const days = view.marketDays[code];
    const shopM = byShop ? shop!.markets[code] : undefined;
    const shopDays = byShop ? shop!.marketDays[code] : undefined;
    const spend = ad?.cur.spend ?? 0;
    const spendPrev = ad?.prev.spend ?? 0;
    if (byShop) {
      // Spend on the shop's reporting days (its feed may lag the ads by a
      // day or two), so the return compares like with like.
      const shopIdx = view.days.findIndex((d) => d.date === shop!.asOf);
      const upTo = (list: Array<number | null> | undefined, to: number) =>
        (list ?? []).reduce<number>((sum, v, i) => (i <= to ? sum + (v ?? 0) : sum), 0);
      return {
        code,
        lead: shopM?.cur.revenue ?? 0,
        leadPrev: shopM?.prev.revenue ?? 0,
        spend: days ? upTo(days.spend, shopIdx) : spend,
        spendPrev: days ? upTo(days.prevSpend, shopIdx) : spendPrev,
        orders: shopM?.cur.orders ?? 0,
        ordersPrev: shopM?.prev.orders ?? 0,
        series: cut(shopDays?.revenue ?? []),
        prevSeries: shopDays?.prevRevenue ?? [],
      };
    }
    const pick = revenue ? "value" : "spend";
    return {
      code,
      lead: revenue ? ad?.cur.value ?? 0 : spend,
      leadPrev: revenue ? ad?.prev.value ?? 0 : spendPrev,
      spend,
      spendPrev,
      orders: revenue ? ad?.cur.purchases ?? 0 : null,
      ordersPrev: revenue ? ad?.prev.purchases ?? 0 : null,
      series: days ? cut(pick === "value" ? days.value : days.spend) : [],
      prevSeries: days ? (pick === "value" ? days.prevValue : days.prevSpend).slice(0, len) : [],
    };
  });
  cards.sort((a, b) => b.lead - a.lead || b.spend - a.spend);

  const header = (lead: string) => (
    <div className="space-y-5">
      <SeasonTabs base={base} active="rynki" />
      <PageHeader
        eyebrow={<span className="kick">{`${seasonLabel} · rynki${eyebrowExtra ?? ""}`}</span>}
        title="Rynki"
        description={lead}
      />
    </div>
  );

  if (cards.length < 2) {
    return (
      <div className="space-y-8 px-4 pb-6 pt-6 sm:px-6 md:pt-8">
        {header("Każdy kraj osobno: sprzedaż, wydatki i zwrot na tle zeszłego sezonu.")}
        <EmptyState
          icon={Globe2}
          title="Za mało rynków, żeby je porównać"
          description="Rynki czytamy z nazw kampanii (np. „PL - …”, „DE | …” albo flaga kraju) i z kraju w danych sklepu. Gdy kampanie lub sklep rozróżnią co najmniej dwa kraje, pojawią się tutaj."
        />
      </div>
    );
  }

  // Shares of ALL shop sales, the ones without a country included: "PL to
  // 80%" must not hide that a third of orders carry no market.
  const total = Math.max(byShop ? shop!.totals.revenue : 0, cards.reduce((a, c) => a + c.lead, 0));
  const top = cards[0];
  const growth = cards
    .map((c) => ({ c, d: change(c.lead, c.leadPrev) }))
    .filter((x): x is { c: MarketCard; d: NonNullable<Delta> } => x.d !== null && x.c.leadPrev > total * 0.02)
    .sort((a, b) => b.d.ratio - a.d.ratio);
  const what = byShop ? "sprzedaży sklepu" : revenue ? "sprzedaży z reklam" : "wydatków";
  const lead = [
    total > 0 ? `${marketLabel(top.code)} to ${Math.round((top.lead / total) * 100)}% ${what}.` : null,
    growth.length && growth[0].d.ratio > 0.05
      ? `Najszybciej rośnie ${marketLabel(growth[0].c.code)} (+${growth[0].d.text} ${running ? "na tle tego samego momentu" : "na tle"} sezonu ${prevYear}).`
      : null,
    growth.length > 1 && growth[growth.length - 1].d.ratio < -0.05
      ? `Najbardziej traci ${marketLabel(growth[growth.length - 1].c.code)} (-${growth[growth.length - 1].d.text}).`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  // Best and worst return among markets that carry real spend.
  const rated = revenue
    ? cards.filter((c) => c.spend > 0 && c.spend >= cards.reduce((a, x) => a + x.spend, 0) * 0.03)
    : [];
  const ret = (c: MarketCard) => (c.spend > 0 ? c.lead / c.spend : 0);
  const best = rated.length >= 3 ? rated.reduce((a, b) => (ret(b) > ret(a) ? b : a)).code : null;
  const worst = rated.length >= 3 ? rated.reduce((a, b) => (ret(b) < ret(a) ? b : a)).code : null;

  return (
    <div className="space-y-8 px-4 pb-6 pt-6 sm:px-6 md:pt-8">
      {header(lead || "Każdy kraj osobno na tle zeszłego sezonu.")}
      <p className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-3">
        <span className="flex items-center gap-2">
          <span aria-hidden className="h-[3px] w-5 rounded-full bg-[hsl(var(--lime-line))]" />
          {`sezon ${view.state.current.year}`}
        </span>
        <span className="flex items-center gap-2">
          <span aria-hidden className="w-5 border-t-[1.5px] border-dashed border-prev" />
          {`sezon ${prevYear}`}
        </span>
        <span>{running ? "Zmiany: na tle tego samego dnia zeszłego sezonu." : "Zmiany: cały sezon na tle całego poprzedniego."}</span>
      </p>
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => {
          const share = total > 0 ? c.lead / total : 0;
          const leadDelta = change(c.lead, c.leadPrev);
          const metrics: Array<{ label: string; value: string; delta: Delta }> = [];
          if (revenue) {
            metrics.push({ label: "Wydatki", value: formatPlnWhole(c.spend), delta: change(c.spend, c.spendPrev, { neutral: true }) });
            metrics.push({
              label: byShop ? "Zwrot ze sklepu" : "Zwrot wg Meta i Google",
              value: times(ret(c)),
              delta: c.spendPrev > 0 && c.leadPrev > 0 && c.spend > 0 ? change(ret(c), c.leadPrev / c.spendPrev) : null,
            });
          }
          if (c.orders !== null) {
            metrics.push({ label: "Zamówienia", value: formatNumberPL(c.orders), delta: change(c.orders, c.ordersPrev ?? 0) });
            metrics.push({
              label: "Koszt zamówienia",
              value: c.orders > 0 ? formatPlnWhole(c.spend / c.orders) : "-",
              delta:
                c.orders > 0 && (c.ordersPrev ?? 0) > 0 && c.spendPrev > 0
                  ? change(c.spend / c.orders, c.spendPrev / (c.ordersPrev ?? 1), { higherIsBetter: false })
                  : null,
            });
          }
          return (
            <li key={c.code}>
              <Card className="flex h-full flex-col gap-4 p-5 sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{marketLabel(c.code)}</h2>
                    <p className="text-xs text-ink-3 tabular-nums">
                      {Math.round(share * 100)}% {what}
                    </p>
                  </div>
                  {c.code === best ? (
                    <span className="shrink-0 rounded-full bg-lime-soft px-2.5 py-1 text-xs font-medium text-foreground">najlepszy zwrot</span>
                  ) : c.code === worst ? (
                    <span className="shrink-0 rounded-full bg-negative-soft px-2.5 py-1 text-xs font-medium text-foreground">najsłabszy zwrot</span>
                  ) : null}
                </div>
                <div>
                  <p className="text-xs text-ink-2">{byShop ? "Sprzedaż sklepu" : revenue ? "Sprzedaż z reklam" : "Wydatki"}</p>
                  <p className="mt-1 flex flex-wrap items-baseline gap-x-2 tabular-nums">
                    <span className="text-[1.75rem] font-light tracking-[-0.04em]">{formatPlnWhole(c.lead)}</span>
                    <DeltaText delta={leadDelta} />
                  </p>
                </div>
                <MiniCompare cur={c.series} prev={c.prevSeries} len={len} label={marketLabel(c.code)} />
                {metrics.length ? (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 text-sm">
                    {metrics.map((m) => (
                      <div key={m.label} className="min-w-0">
                        <dt className="truncate text-xs text-ink-3">{m.label}</dt>
                        <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 tabular-nums">
                          <span className="font-medium">{m.value}</span>
                          <DeltaText delta={m.delta} small />
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ul>
      {view.unmappedShare > 0.05 ? (
        <p className="text-xs text-ink-3">
          {Math.round(view.unmappedShare * 100)}% wydatków idzie na kampanie bez kraju w nazwie - nie ma ich w podziale na rynki.
        </p>
      ) : null}
    </div>
  );
}

function DeltaText({ delta, small = false }: { delta: Delta; small?: boolean }) {
  if (!delta) return null;
  return (
    <span
      className={cn(
        small ? "text-xs" : "text-sm",
        delta.tone === "good" ? "text-positive" : delta.tone === "bad" ? "text-negative" : "text-ink-3"
      )}
    >
      {delta.direction === "up" ? "+" : delta.direction === "down" ? "-" : ""}
      {delta.text}
    </span>
  );
}

/** This season (solid, through yesterday) over last season (dashed), one scale. */
function MiniCompare({
  cur,
  prev,
  len,
  label,
}: {
  cur: Array<number | null>;
  prev: Array<number | null>;
  len: number;
  label: string;
}) {
  const W = 300;
  const H = 64;
  const top = Math.max(1, ...cur.map((v) => v ?? 0), ...prev.slice(0, len).map((v) => v ?? 0));
  const x = (i: number) => (len > 1 ? (i / (len - 1)) * W : 0);
  const y = (v: number) => H - 2 - (v / top) * (H - 4);
  const path = (list: Array<number | null>) => {
    let d = "";
    let pen = false;
    list.slice(0, len).forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${label}: ten sezon na tle poprzedniego, dzień po dniu`} className="h-16 w-full">
      <path d={path(prev)} fill="none" className="stroke-[var(--prev)]" strokeWidth={1.5} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      <path d={path(cur)} fill="none" className="stroke-[hsl(var(--lime-line))]" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
