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
  const title = <h2 className="text-section-title text-foreground">Najlepiej sprzedające się produkty</h2>;

  if (tableMissing) {
    return (
      <Card className="p-5 sm:p-6">
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
  const max = Math.max(1, ...products.map((p) => p.revenueMinorUnits));
  const takeaway = productsTakeaway(products, totalRev);

  return (
    <Card className="flex flex-col p-5 sm:p-6">
      {title}
      {takeaway ? (
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{takeaway}</p>
      ) : null}

      {products.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Google Analytics nie przekazał jeszcze sprzedaży w podziale na produkty dla
          tego okresu. Jeśli sklep jest świeżo podłączony, historia pojawi się po
          pierwszym pełnym pobraniu danych.
        </p>
      ) : (
        <ShowMoreList initial={5} className="mt-4">
          {products.map((p, i) => {
            const share = totalRev > 0 ? p.revenueMinorUnits / totalRev : 0;
            return (
              <li
                key={`${p.itemId}:${p.itemName}`}
                className="flex gap-3 border-t border-border/70 py-3.5 first:border-t-0 first:pt-0"
              >
                {/* Rank chip: the bestseller in lime, the rest quiet grey. */}
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                    i === 0 ? "bg-lime text-lime-foreground" : "bg-muted text-muted-foreground"
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
                    <p className="shrink-0 text-[15px] font-semibold tabular-nums tracking-[-0.01em]">
                      {formatPlnWhole(p.revenueMinorUnits)}
                    </p>
                  </div>
                  {/* Bar length is relative to the bestseller (a ranking, not
                      shares). The leader gets the striped lime highlight
                      bar, the rest grey - like the benchmark's best bar. */}
                  <div
                    className={cn(
                      "mt-2 overflow-hidden rounded-full bg-muted",
                      i === 0 ? "h-3" : "h-2"
                    )}
                    aria-hidden
                  >
                    <div
                      className={`${cn(
                        "h-full rounded-full",
                        i === 0 ? "bg-lime" : "bg-chart-muted/55"
                      )}${i === 0 ? " bg-stripes" : ""}`}
                      style={{ width: `${Math.max((p.revenueMinorUnits / max) * 100, 1.5)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs tabular-nums text-muted-foreground">
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
