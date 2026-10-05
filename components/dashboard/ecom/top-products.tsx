import { Card } from "@tremor/react";
import { Package } from "lucide-react";

import type { CSSProperties } from "react";

import { cn, formatNumberPL, formatPlnWhole } from "@/lib/utils";

import { aboutPln, pctOf, Takeaway } from "./plain";

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
// product names wrap instead of forcing a horizontal scroll on phones. The
// card spans the full width; from lg the list flows into two columns (1-5,
// 6-10) so ten rows don't make one very tall card.
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
    <h3 className="flex items-center gap-2 text-base font-semibold">
      <Package className="h-4 w-4 text-emerald-500" /> Najlepiej sprzedające się produkty
    </h3>
  );

  if (tableMissing) {
    return (
      <Card>
        {title}
        {isAgency ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Aby włączyć sprzedaż per produkt, uruchom w Supabase migrację{" "}
            <code className="rounded bg-muted px-1">0018_ga4_items.sql</code>, a potem
            odśwież dane (przycisk Odśwież lub debug z{" "}
            <code className="rounded bg-muted px-1">days=365</code> dla historii).
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Sprzedaż w podziale na produkty pojawi się tu wkrótce - właśnie ją
            włączamy.
          </p>
        )}
      </Card>
    );
  }

  const totalRev = products.reduce((a, p) => a + p.revenueMinorUnits, 0);
  const totalQty = products.reduce((a, p) => a + p.quantity, 0);
  const takeaway = productsTakeaway(products, totalRev);

  return (
    <Card className="flex flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        {title}
        {products.length ? (
          <p className="text-xs tabular-nums text-muted-foreground">
            top {products.length} · {units(totalQty)} · {formatPlnWhole(totalRev)}
          </p>
        ) : null}
      </div>

      {takeaway ? (
        <Takeaway tone="good" className="mt-3">
          {takeaway}
        </Takeaway>
      ) : null}

      {products.length ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Procent przy produkcie = udział w sprzedaży top {products.length}.
        </p>
      ) : null}

      {products.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Google Analytics nie przekazał jeszcze sprzedaży w podziale na produkty dla
          tego okresu. Jeśli sklep jest świeżo podłączony, historia pojawi się po
          pierwszym pełnym pobraniu danych.
        </p>
      ) : (
        <ol
          className="mt-2 grid grid-cols-1 lg:grid-flow-col lg:grid-cols-2 lg:gap-x-10 lg:[grid-template-rows:repeat(var(--rows),auto)]"
          style={{ "--rows": Math.ceil(products.length / 2) } as CSSProperties}
        >
          {products.map((p, i) => {
            const share = totalRev > 0 ? p.revenueMinorUnits / totalRev : 0;
            const rows = Math.ceil(products.length / 2);
            return (
              <li
                key={`${p.itemId}:${p.itemName}`}
                className={cn(
                  "flex gap-3 border-t border-border/60 py-3",
                  i === 0 && "border-t-0",
                  // First item of the second column starts it - no divider on top.
                  i === rows && "lg:border-t-0"
                )}
              >
                <span
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                    i < 3
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                      : "bg-muted text-muted-foreground"
                  )}
                  aria-label={`Miejsce ${i + 1}`}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="line-clamp-2 min-w-0 break-words text-sm font-medium" title={p.itemName}>
                      {p.itemName}
                    </p>
                    <p className="shrink-0 text-sm font-semibold tabular-nums">
                      {formatPlnWhole(p.revenueMinorUnits)}
                    </p>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          i < 3 ? "bg-emerald-500" : "bg-emerald-500/50"
                        )}
                        style={{ width: `${Math.max(share * 100, 1.5)}%` }}
                      />
                    </div>
                    <span
                      className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground"
                      title={`Udział w sprzedaży top ${products.length}`}
                    >
                      {pctOf(share)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                    {units(p.quantity)}
                    {isAgency && p.itemId && p.itemId !== p.itemName ? (
                      <span className="break-all"> · kod {p.itemId}</span>
                    ) : null}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {products.length ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Według Google Analytics, za wybrany okres.
        </p>
      ) : null}
    </Card>
  );
}
