import { AlertTriangle, Radio } from "lucide-react";

import {
  computeProfit,
  dayLabelPl,
  type ChannelEfficiency as ChannelEfficiencyData,
  type EcomSettings,
} from "@/lib/ecom/insights";
import {
  cn,
  formatMultiple,
  formatNumberPL,
  formatPlnWhole,
} from "@/lib/utils";

/**
 * Which channels actually make money: GA4 last-click revenue per platform next
 * to that platform's ad spend - ROAS, cost per order, conversion rate and, with
 * a margin set, whether each channel clears break-even. Also catches paid
 * traffic GA4 can't see (missing UTMs), a measurement gap that silently
 * undersells the agency's work.
 */
export function ChannelEfficiency({
  data,
  settings,
}: {
  data: ChannelEfficiencyData;
  settings: EcomSettings;
}) {
  const breakEven = computeProfit(1, 1, settings)?.breakEvenRoas ?? null;
  const paid = data.rows.filter((r) => r.spend !== null);
  const unpaid = data.rows.filter((r) => r.spend === null && r.revenue > 0);

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Radio className="h-4 w-4 text-emerald-500" />
          Które kanały zarabiają
        </h2>
        <p className="text-xs text-muted-foreground">
          30 dni do {dayLabelPl(data.windowEnd)} · przychód wg GA4 (ostatnie kliknięcie)
        </p>
      </div>

      {data.revenuePending ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Rozbicie przychodu na kanały pojawi się po najbliższym odświeżeniu danych.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Kanał</th>
                <th className="pb-2 pr-4 text-right font-medium">Wydatki</th>
                <th className="pb-2 pr-4 text-right font-medium">Przychód</th>
                <th className="pb-2 pr-4 text-right font-medium">ROAS</th>
                <th className="pb-2 pr-4 text-right font-medium">Koszt zamówienia</th>
                <th className="pb-2 pr-4 text-right font-medium">Konwersja</th>
                <th className="pb-2 text-right font-medium">Udział</th>
              </tr>
            </thead>
            <tbody>
              {paid.map((r) => {
                const clears =
                  breakEven !== null && r.roas !== null ? r.roas >= breakEven : null;
                return (
                  <tr key={r.channel} className="border-b border-border/50">
                    <td className="py-2.5 pr-4 font-medium">{r.label}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">
                      {formatPlnWhole(r.spend ?? 0)}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-semibold tabular-nums">
                      {formatPlnWhole(r.revenue)}
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">
                      {r.roas !== null ? (
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 font-semibold",
                            clears === true &&
                              "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                            clears === false &&
                              "bg-rose-500/10 text-rose-700 dark:text-rose-400"
                          )}
                          title={
                            breakEven !== null
                              ? `Próg rentowności: ${formatMultiple(breakEven)}`
                              : undefined
                          }
                        >
                          {formatMultiple(r.roas)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">
                      {r.cpa !== null ? formatPlnWhole(r.cpa) : "—"}
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">
                      {r.conversionRate !== null
                        ? `${(r.conversionRate * 100).toLocaleString("pl-PL", {
                            maximumFractionDigits: 2,
                          })}%`
                        : "—"}
                    </td>
                    <td className="py-2.5 text-right tabular-nums">
                      {Math.round(r.share * 100)}%
                    </td>
                  </tr>
                );
              })}
              {unpaid.map((r) => (
                <tr key={r.channel} className="border-b border-border/50 text-muted-foreground">
                  <td className="py-2 pr-4">{r.label}</td>
                  <td className="py-2 pr-4 text-right">—</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatPlnWhole(r.revenue)}
                  </td>
                  <td className="py-2 pr-4 text-right">—</td>
                  <td className="py-2 pr-4 text-right">—</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {r.conversionRate !== null
                      ? `${(r.conversionRate * 100).toLocaleString("pl-PL", {
                          maximumFractionDigits: 2,
                        })}%`
                      : "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {Math.round(r.share * 100)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.untrackedPaid.length ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <b>
              {data.untrackedPaid
                .map((c) => paid.find((r) => r.channel === c)?.label ?? c)
                .join(", ")}
            </b>{" "}
            wydaje budżet, ale GA4 nie widzi z tego ruchu ani sprzedaży - najpewniej
            brakuje tagów UTM w linkach reklam. Sprzedaż z tych kampanii trafia do
            „Pozostałych" i zaniża ich wynik.
          </p>
        </div>
      ) : null}

      <p className="mt-3 text-[11px] text-muted-foreground">
        {breakEven !== null
          ? `Zielony ROAS = kanał zarabia (powyżej progu ${formatMultiple(breakEven)}), czerwony = traci po odliczeniu marży. `
          : ""}
        GA4 przypisuje sprzedaż ostatniemu kliknięciu, więc panele Meta/Google pokazują
        zwykle więcej - to różnica metod liczenia, nie błąd. Łącznie{" "}
        {formatNumberPL(data.rows.reduce((a, r) => a + r.transactions, 0))} zamówień.
      </p>
    </section>
  );
}
