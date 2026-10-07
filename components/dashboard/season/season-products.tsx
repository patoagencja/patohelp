import type { CSSProperties } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/page-header";
import { plPlural } from "@/lib/dashboard/story";
import { change, compactPln } from "@/lib/season/format";
import type { SeasonShopProduct } from "@/lib/season/shop";
import { cn, formatNumberPL } from "@/lib/utils";

/**
 * What sells, from the shop's own panel: each product's share of the
 * season, orders and the change against the previous season at the same
 * point. Shown only when the shop sends product names.
 */
export function SeasonProducts({
  products,
  prevGen,
  hasPrev,
  running = true,
}: {
  products: SeasonShopProduct[];
  /** "sezonu 2025" (genitive). */
  prevGen: string;
  hasPrev: boolean;
  running?: boolean;
}) {
  const all = products.filter((p) => p.cur.revenue > 0 || p.prev.revenue > 0);
  const list = all.slice(0, 8);
  if (list.length < 2) return null;
  // Shares against every product, not just the eight shown.
  const total = all.reduce((a, p) => a + p.cur.revenue, 0);
  return (
    <Card className="space-y-5 p-5 sm:p-6">
      <SectionHeader
        title="Produkty"
        description={
          hasPrev
            ? running
              ? `Sprzedaż sklepu według produktu i zmiana względem ${prevGen} w tym samym momencie.`
              : `Sprzedaż sklepu według produktu i zmiana względem całego ${prevGen}.`
            : "Sprzedaż sklepu według produktu."
        }
      />
      <ul className="divide-y divide-[var(--line)]">
        {list.map((p, idx) => {
          const share = total > 0 ? p.cur.revenue / total : 0;
          const ch = hasPrev ? change(p.cur.revenue, p.prev.revenue) : null;
          return (
            <li
              key={p.product}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-1.5 py-3 sm:grid-cols-[minmax(10rem,1.2fr)_minmax(6rem,2fr)_auto_auto] sm:gap-x-5"
            >
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-medium">{p.product}</span>
                <span className="block text-[12.5px] text-ink-3 tabular-nums">
                  {Math.round(share * 100)}%{"\u00a0"}sprzedaży · {formatNumberPL(p.cur.orders)}{"\u00a0"}
                  {plPlural(p.cur.orders, "zamówienie", "zamówienia", "zamówień")}
                  {p.cur.orders > 0 ? ` · śr.\u00a0${formatNumberPL(p.cur.revenue / p.cur.orders / 100)}\u00a0zł` : ""}
                </span>
              </span>
              <span className="col-span-3 row-start-2 sm:col-span-1 sm:row-start-auto">
                <span aria-hidden className="block h-2.5 overflow-hidden rounded-full bg-chip">
                  <span
                    className="share-fill block h-full origin-left rounded-full animate-grow"
                    style={{ width: `${Math.max(2, share * 100)}%`, "--d": `${0.3 + idx * 0.06}s` } as CSSProperties}
                  />
                </span>
              </span>
              <b className="text-right text-[15px] font-semibold tabular-nums">{compactPln(p.cur.revenue)}</b>
              <span
                className={cn(
                  "inline-flex min-w-[3.5rem] items-center justify-end gap-0.5 text-[13px] font-semibold tabular-nums sm:min-w-[4.5rem]",
                  !ch ? "text-ink-3" : ch.tone === "good" ? "text-positive" : ch.tone === "bad" ? "text-negative" : "text-ink-2"
                )}
              >
                {ch ? (
                  <>
                    {ch.direction === "up" ? (
                      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                    ) : ch.direction === "down" ? (
                      <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />
                    ) : null}
                    <span className="sr-only">{ch.direction === "down" ? "spadek" : "wzrost"} </span>
                    {ch.text}
                  </>
                ) : hasPrev ? (
                  "nowy"
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
