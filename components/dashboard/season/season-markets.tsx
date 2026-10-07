import type { CSSProperties } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/page-header";
import { change, compactCount, compactPln, roasText } from "@/lib/season/format";
import type { SeasonMarket } from "@/lib/season/load";
import { marketLabel } from "@/lib/season/markets";
import { cn } from "@/lib/utils";

/**
 * Market by market: who carries the season and who grows. One row per
 * country with its share of sales as a bar (no 7-colour pie), ROAS and the
 * change against the same point of the previous season.
 */
export function SeasonMarkets({
  markets,
  showRevenue,
  prevLabel,
  unmappedShare,
  isAgency,
}: {
  markets: SeasonMarket[];
  showRevenue: boolean;
  prevLabel: string;
  unmappedShare: number;
  isAgency: boolean;
}) {
  const metric = (t: SeasonMarket["cur"]) => (showRevenue ? t.value : t.clicks);
  const total = markets.reduce((a, m) => a + metric(m.cur), 0);
  const fmt = (v: number) => (showRevenue ? compactPln(v) : compactCount(v));

  if (markets.length < 2) {
    // Nothing to split: say why to the agency (it's a naming fix), stay
    // quiet for the client.
    return isAgency ? (
      <Card className="p-5 text-sm leading-relaxed text-ink-2 sm:p-6">
        <p className="font-medium text-foreground">Rynki</p>
        <p className="mt-1">
          Podział na kraje bierzemy z nazw kampanii. Dodaj kod kraju na początku nazwy (np. „PL -
          Search”, „DE | PMax”) albo flagę, a pojawi się tu tabela rynków.
        </p>
      </Card>
    ) : null;
  }

  return (
    <Card className="space-y-5 p-5 sm:p-6">
      <SectionHeader
        title="Rynki"
        description={
          showRevenue
            ? `Sprzedaż z reklam w każdym kraju i zmiana względem ${prevLabel.toLowerCase()} w tym samym momencie.`
            : `Kliknięcia w każdym kraju i zmiana względem ${prevLabel.toLowerCase()} w tym samym momencie.`
        }
      />
      <ul className="divide-y divide-[var(--line)]">
        {markets.map((m, idx) => {
          const v = metric(m.cur);
          const share = total > 0 ? v / total : 0;
          const ch = change(v, metric(m.prev));
          return (
            <li key={m.code} className="grid grid-cols-[2.75rem_1fr_auto] items-center gap-x-3 gap-y-1.5 py-3 sm:grid-cols-[2.75rem_minmax(8rem,1fr)_minmax(6rem,2fr)_auto_auto] sm:gap-x-5">
              <span className="grid h-9 w-11 place-items-center rounded-[12px] bg-chip font-mono text-[12px] font-medium tracking-[0.06em]">
                {m.code}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-medium">{marketLabel(m.code)}</span>
                <span className="block text-[12.5px] text-ink-3 tabular-nums">
                  {Math.round(share * 100)}% sezonu
                  {showRevenue ? ` · ROAS ${roasText(m.cur.value, m.cur.spend)}` : ""}
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
              <b className="text-right text-[15px] font-semibold tabular-nums">{fmt(v)}</b>
              <span
                className={cn(
                  "hidden min-w-[4.5rem] items-center justify-end gap-0.5 text-[13px] font-semibold tabular-nums sm:inline-flex",
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
                ) : (
                  "nowy"
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {isAgency && unmappedShare > 0.15 ? (
        <p className="text-[12.5px] text-ink-3">
          {Math.round(unmappedShare * 100)}% wydatków pochodzi z kampanii bez kodu kraju w nazwie -
          nie ma ich w tabeli.
        </p>
      ) : null}
    </Card>
  );
}
