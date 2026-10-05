import { Users } from "lucide-react";

import { InfoTip } from "@/components/dashboard/info-tip";
import { dayLabelPl } from "@/lib/ecom/insights";
import type { NewVsReturning as NewVsReturningData, NvrSegment } from "@/lib/ecom/new-vs-returning";
import { cn, formatNumberPL, formatPlnWhole } from "@/lib/utils";

import { pctOf, Takeaway, type TakeawayTone } from "./plain";

const SEGMENTS = [
  {
    key: "newBuyers",
    name: "Nowi klienci",
    bar: "bg-emerald-500",
    dot: "bg-emerald-500",
    explain:
      "Osoby, które w czasie zakupu były w sklepie po raz pierwszy (tak rozpoznaje je Google Analytics). To przybliżenie „pierwszego zakupu” - ktoś mógł wcześniej kupić na innym urządzeniu.",
  },
  {
    key: "returning",
    name: "Stali klienci",
    bar: "bg-indigo-500",
    dot: "bg-indigo-500",
    explain:
      "Osoby, które już wcześniej odwiedzały sklep i wróciły, żeby kupić. Część z nich kupuje po raz pierwszy, ale znała już sklep - np. z reklamy albo newslettera.",
  },
] as const;

const COST_EXPLAIN =
  "To szacunek: cały budżet reklamowy z tych 30 dni podzielony przez liczbę zamówień od nowych klientów. Reklamy przyprowadzają też stałych klientów, więc faktyczny koszt zdobycia nowego kupującego jest raczej niższy.";

/** Plain-language verdict built from the share of ORDERS (not revenue). */
function takeawayFor(newOrderShare: number): { text: string; tone: TakeawayTone } {
  const outOfTen = Math.round(newOrderShare * 10);
  if (outOfTen >= 10) {
    return {
      text: "Prawie wszystkie zamówienia składają nowi klienci - reklamy przyprowadzają nowych kupujących, ale mało kto wraca po więcej.",
      tone: "neutral",
    };
  }
  if (outOfTen >= 6) {
    return {
      text: `${outOfTen} na 10 zamówień składają nowi klienci - reklamy przyprowadzają nowych kupujących.`,
      tone: "good",
    };
  }
  if (outOfTen === 5) {
    return {
      text: "Zamówienia dzielą się mniej więcej po równo między nowych i stałych klientów - sklep rośnie i ma do kogo wracać.",
      tone: "good",
    };
  }
  if (outOfTen >= 1) {
    return {
      text: `${10 - outOfTen} na 10 zamówień składają stali klienci - sklep żyje z lojalności, a nowych kupujących przybywa wolniej.`,
      tone: "neutral",
    };
  }
  return {
    text: "Prawie wszystkie zamówienia składają stali klienci - nowych kupujących przybywa niewiele.",
    tone: "warn",
  };
}

/**
 * Only worth a sentence when the gap is noticeable - "o 2% więcej" is noise
 * that invites over-reading.
 */
function aovComparison(n: NvrSegment, r: NvrSegment): string | null {
  if (!n.aovMinorUnits || !r.aovMinorUnits) return null;
  const diff = r.aovMinorUnits / n.aovMinorUnits - 1;
  if (Math.abs(diff) < 0.05) return null;
  return diff > 0
    ? `Stali klienci zostawiają w jednym zamówieniu średnio o ${pctOf(diff)} więcej niż nowi.`
    : `Nowi klienci zostawiają w jednym zamówieniu średnio o ${pctOf(-diff)} więcej niż stali.`;
}

// Growth (new buyers) vs loyalty (returning) - the split shop owners ask
// about. Fixed 30-day GA4 snapshot, independent of the range picker.
export function NewVsReturning({ data }: { data: NewVsReturningData | null }) {
  if (!data) return null;
  const knownOrders = data.newBuyers.transactions + data.returning.transactions;
  if (knownOrders <= 0) return null;

  const takeaway = takeawayFor(data.newBuyers.transactionShare);
  const aovLine = aovComparison(data.newBuyers, data.returning);

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <Users className="h-4 w-4 shrink-0 text-emerald-500" />
        Nowi czy stali klienci
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Okres:{" "}
        <span className="font-medium text-foreground">
          ostatnie 30 dni do {dayLabelPl(data.windowEnd)}
        </span>{" "}
        - niezależnie od zakresu wybranego u góry.
      </p>

      <Takeaway tone={takeaway.tone} className="mt-3">
        {takeaway.text}
      </Takeaway>

      {/* Revenue share, not orders: the bar answers "where does the money
          come from", the takeaway above already covers order counts. */}
      <div className="mt-5">
        <p className="mb-2 text-sm text-muted-foreground">Udział w sprzedaży</p>
        <div
          className="flex h-7 w-full overflow-hidden rounded-lg bg-muted"
          role="img"
          aria-label={`Nowi klienci ${pctOf(data.newBuyers.revenueShare)} sprzedaży, stali klienci ${pctOf(
            data.returning.revenueShare
          )}`}
        >
          {SEGMENTS.map((s) => {
            const share = data[s.key].revenueShare;
            return share > 0 ? (
              <div
                key={s.key}
                className={cn("h-full transition-all duration-700", s.bar)}
                style={{ width: `max(${share * 100}%, 0.375rem)` }}
              />
            ) : null;
          })}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SEGMENTS.map((s) => {
          const seg = data[s.key];
          return (
            <div key={s.key} className="min-w-0 rounded-lg bg-muted/50 p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", s.dot)} aria-hidden />
                <span className="min-w-0">{s.name}</span>
                <InfoTip label={s.name} text={s.explain} />
                <span className="ml-auto shrink-0 text-base font-bold tabular-nums">
                  {pctOf(seg.revenueShare)}
                </span>
              </p>
              <dl className="mt-2 space-y-1 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Sprzedaż</dt>
                  <dd className="font-medium tabular-nums">
                    {formatPlnWhole(seg.revenueMinorUnits)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Zamówienia</dt>
                  <dd className="font-medium tabular-nums">{formatNumberPL(seg.transactions)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Średni koszyk</dt>
                  <dd className="font-medium tabular-nums">
                    {seg.aovMinorUnits !== null ? formatPlnWhole(seg.aovMinorUnits) : "—"}
                  </dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>

      {aovLine ? <p className="mt-3 text-sm text-muted-foreground">{aovLine}</p> : null}

      {data.costPerNewOrderMinorUnits !== null ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border border-dashed border-border p-3 text-sm">
          <span className="text-muted-foreground">
            Szacunkowy koszt pozyskania nowego klienta:
          </span>
          <span className="whitespace-nowrap font-semibold tabular-nums">
            ok. {formatPlnWhole(data.costPerNewOrderMinorUnits)}
            <InfoTip
              label="szacunkowy koszt pozyskania nowego klienta"
              text={COST_EXPLAIN}
              className="ml-1 align-middle"
            />
          </span>
        </div>
      ) : null}

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Podział według Google Analytics: „nowy” to ktoś, kto kupił podczas
        pierwszej wizyty w sklepie, „stały” - ktoś, kto był już wcześniej.
        {data.notSetRevenueShare >= 0.05
          ? ` ${pctOf(data.notSetRevenueShare)} sprzedaży Google Analytics nie przypisał do żadnej grupy - nie liczymy jej powyżej.`
          : ""}
      </p>
    </section>
  );
}
