import type React from "react";

import { ShowMoreList } from "@/components/dashboard/show-more-list";
import { Card } from "@/components/ui/card";
import { cn, formatNumberPL, formatPlnWhole } from "@/lib/utils";

import { aboutPln, pctOf } from "./plain";

export interface ProductRow {
  itemName: string;
  itemId: string;
  quantity: number;
  revenueMinorUnits: number;
}

const units = (n: number) => `${formatNumberPL(n)} szt.`;

/** Long feed titles ("Drzwi wewnętrzne ... 80 cm lewe, biały mat") break the sentence. */
function shortName(name: string, max = 60): string {
  return name.length > max ? `${name.slice(0, max - 1).trimEnd()}…` : name;
}

function productsTakeaway(products: ProductRow[], totalRev: number): string | null {
  const top = products[0];
  if (!top || totalRev <= 0) return null;
  const share = top.revenueMinorUnits / totalRev;
  const top3 = products.slice(0, 3).reduce((a, p) => a + p.revenueMinorUnits, 0) / totalRev;
  const head = `Najlepiej sprzedaje się „${shortName(top.itemName)}”: ${units(
    top.quantity
  )} za ok. ${aboutPln(top.revenueMinorUnits)}`;
  // Shares are of the listed products only (top 10), so say exactly that.
  if (products.length >= 4 && top3 >= 0.6) {
    return `${head} - a pierwsza trójka to aż ${pctOf(top3)} sprzedaży z top ${products.length}.`;
  }
  return `${head} (${pctOf(share)} sprzedaży z top ${products.length}).`;
}

// Bestsellers for the selected range as a ranked list (not a table) so long
// product names wrap instead of forcing a horizontal scroll on phones. Top 5
// by default; the rest of the ten one click away.
export function TopProducts({
  products,
  tableMissing,
  isAgency = false,
}: {
  products: ProductRow[];
  tableMissing?: boolean;
  /** Agency users get the technical setup hint and SKU codes; clients see
   *  product names only (a code like "SW-MER-OVS-BEZ" means nothing to them). */
  isAgency?: boolean;
}) {
  const title = (
    <>
      <p className="kick">Produkty · wybrany okres</p>
      <h2 className="mt-2 text-[22px] font-medium tracking-[-0.03em]">
        Najlepiej sprzedające się produkty
      </h2>
    </>
  );

  if (tableMissing) {
    return (
      <Card className="rounded-glass p-6 sm:p-[28px_30px]">
        {title}
        {isAgency ? (
          <p className="mt-3 text-sm text-ink-2">
            Aby włączyć sprzedaż per produkt, uruchom w Supabase migrację{" "}
            <code className="rounded bg-chip px-1">0018_ga4_items.sql</code>, a potem
            odśwież dane (przycisk Odśwież lub debug z{" "}
            <code className="rounded bg-chip px-1">days=365</code> dla historii).
          </p>
        ) : (
          <p className="mt-3 text-sm text-ink-2">
            Sprzedaż w podziale na produkty pojawi się tu wkrótce - właśnie ją
            włączamy.
          </p>
        )}
      </Card>
    );
  }

  const totalRev = products.reduce((a, p) => a + p.revenueMinorUnits, 0);
  const max = Math.max(1, ...products.map((p) => p.revenueMinorUnits));
  const takeaway = productsTakeaway(products, totalRev);

  return (
    <Card className="flex flex-col rounded-glass p-6 sm:p-[28px_30px]">
      {title}
      {takeaway ? <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{takeaway}</p> : null}

      {products.length === 0 ? (
        <p className="mt-4 text-sm text-ink-2">
          Google Analytics nie przekazał jeszcze sprzedaży w podziale na produkty dla
          tego okresu. Jeśli sklep jest świeżo podłączony, historia pojawi się po
          pierwszym pełnym pobraniu danych.
        </p>
      ) : (
        <ShowMoreList initial={5} className="mt-3">
          {products.map((p, i) => {
            const share = totalRev > 0 ? p.revenueMinorUnits / totalRev : 0;
            return (
              <li
                key={`${p.itemId}:${p.itemName}`}
                className="flex gap-4 border-t border-line py-4 first:border-t-0"
              >
                {/* Rank chip: the bestseller in lime, the rest quiet chips. */}
                <span
                  className={cn(
                    "flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums",
                    i === 0 ? "bg-lime text-lime-foreground shadow-lime-glow" : "bg-chip text-ink-2"
                  )}
                  aria-label={`Miejsce ${i + 1}`}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="line-clamp-2 min-w-0 break-words text-[15px] font-medium" title={p.itemName}>
                      {p.itemName}
                    </p>
                    <p className="shrink-0 text-[15px] font-medium tabular-nums tracking-[-0.01em]">
                      {formatPlnWhole(p.revenueMinorUnits)}
                    </p>
                  </div>
                  {/* Bar length is relative to the bestseller (a ranking, not
                      shares): the share-of-spend bar of "Gdzie idą pieniądze". */}
                  <div className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-chip" aria-hidden>
                    <div
                      className={cn(
                        "share-fill h-full origin-left rounded-full animate-grow",
                        i > 0 && "opacity-60"
                      )}
                      style={{
                        width: `${Math.max((p.revenueMinorUnits / max) * 100, 1.5)}%`,
                        "--d": `${0.2 + Math.min(i, 5) * 0.06}s`,
                      } as React.CSSProperties}
                    />
                  </div>
                  <p className="mt-2 text-[13px] tabular-nums text-ink-3">
                    {units(p.quantity)} · {pctOf(share)} sprzedaży z listy
                    {isAgency && p.itemId && p.itemId !== p.itemName ? (
                      <span className="break-all"> · kod {p.itemId}</span>
                    ) : null}
                  </p>
                </div>
              </li>
            );
          })}
        </ShowMoreList>
      )}
    </Card>
  );
}
