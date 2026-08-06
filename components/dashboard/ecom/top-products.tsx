import { Card, Title } from "@tremor/react";
import { Package } from "lucide-react";

import { formatMoneyPLN, formatNumberPL } from "@/lib/utils";

export interface ProductRow {
  itemName: string;
  itemId: string;
  quantity: number;
  revenueMinorUnits: number;
}

// Sales per product (SKU) for the selected range - name, units, revenue and
// share of total revenue with a proportional bar.
export function TopProducts({
  products,
  tableMissing,
}: {
  products: ProductRow[];
  tableMissing?: boolean;
}) {
  if (tableMissing) {
    return (
      <Card>
        <Title className="flex items-center gap-2">
          <Package className="h-4 w-4 text-emerald-500" /> Top produkty (SKU)
        </Title>
        <p className="mt-3 text-sm text-muted-foreground">
          Aby włączyć sprzedaż per produkt, uruchom w Supabase migrację{" "}
          <code className="rounded bg-muted px-1">0018_ga4_items.sql</code>, a
          potem odśwież dane (przycisk Odśwież lub debug z{" "}
          <code className="rounded bg-muted px-1">days=365</code> dla historii).
        </p>
      </Card>
    );
  }

  const totalRev = products.reduce((a, p) => a + p.revenueMinorUnits, 0);

  return (
    <Card>
      <div className="flex items-center justify-between">
        <Title className="flex items-center gap-2">
          <Package className="h-4 w-4 text-emerald-500" /> Top produkty (SKU)
        </Title>
        <p className="text-xs text-muted-foreground">
          {formatNumberPL(products.reduce((a, p) => a + p.quantity, 0))} szt. ·{" "}
          {formatMoneyPLN(totalRev)}
        </p>
      </div>

      {products.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Brak danych produktowych w tym okresie (GA4 nie zwrócił pozycji — jeśli
          to świeża konfiguracja, historia pojawi się po backfillu).
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="pb-2 pr-2 font-medium">#</th>
                <th className="pb-2 pr-4 font-medium">Produkt</th>
                <th className="pb-2 pr-4 text-right font-medium">Sztuk</th>
                <th className="pb-2 pr-4 text-right font-medium">Przychód</th>
                <th className="pb-2 font-medium">Udział</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p, i) => {
                const share = totalRev > 0 ? (p.revenueMinorUnits / totalRev) * 100 : 0;
                return (
                  <tr key={`${p.itemId}:${p.itemName}`} className="border-b border-border/50">
                    <td className="py-2 pr-2 text-muted-foreground">{i + 1}</td>
                    <td className="max-w-[280px] py-2 pr-4">
                      <span className="block truncate font-medium" title={p.itemName}>
                        {p.itemName}
                      </span>
                      {p.itemId && p.itemId !== p.itemName ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          SKU: {p.itemId}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {formatNumberPL(p.quantity)}
                    </td>
                    <td className="py-2 pr-4 text-right font-semibold tabular-nums">
                      {formatMoneyPLN(p.revenueMinorUnits)}
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-emerald-500"
                            style={{ width: `${Math.max(2, Math.round(share))}%` }}
                          />
                        </div>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {share.toLocaleString("pl-PL", { maximumFractionDigits: 1 })}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
