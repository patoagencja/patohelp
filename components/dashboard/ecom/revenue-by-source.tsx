import { Card, Title } from "@tremor/react";
import { Radio } from "lucide-react";

import { formatMoneyPLN, formatNumberPL } from "@/lib/utils";

export interface SourceRevenueRow {
  category: string;
  sessions: number;
  revenueMinorUnits: number;
  transactions: number;
}

const BAR = ["bg-indigo-500", "bg-emerald-500", "bg-amber-500", "bg-sky-500", "bg-slate-400"];

// Which channels actually SELL - revenue, orders and conversion per source,
// rather than the session split shown on the Witryna tab.
export function RevenueBySource({ sources }: { sources: SourceRevenueRow[] }) {
  const ranked = [...sources].sort(
    (a, b) => b.revenueMinorUnits - a.revenueMinorUnits
  );
  const totalRev = ranked.reduce((a, s) => a + s.revenueMinorUnits, 0);
  const noRevenue = totalRev === 0;

  return (
    <Card>
      <div className="flex items-center justify-between">
        <Title className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-emerald-500" /> Sprzedaż wg źródeł
        </Title>
        <p className="text-xs text-muted-foreground">{formatMoneyPLN(totalRev)}</p>
      </div>

      {noRevenue ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Brak przychodu per źródło w ostatnim snapshocie. Po najbliższym
          odświeżeniu danych (lub kliknięciu „Odśwież") pojawi się rozbicie
          sprzedaży na kanały.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {ranked.map((s, i) => {
            const share = totalRev > 0 ? (s.revenueMinorUnits / totalRev) * 100 : 0;
            const cr = s.sessions > 0 ? (s.transactions / s.sessions) * 100 : 0;
            return (
              <div key={s.category}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium">{s.category}</span>
                  <span className="text-sm font-semibold tabular-nums">
                    {formatMoneyPLN(s.revenueMinorUnits)}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {share.toLocaleString("pl-PL", { maximumFractionDigits: 1 })}%
                    </span>
                  </span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${BAR[i % BAR.length]}`}
                    style={{ width: `${Math.max(2, Math.round(share))}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatNumberPL(s.transactions)} zamówień ·{" "}
                  {formatNumberPL(s.sessions)} sesji · konwersja{" "}
                  {cr.toLocaleString("pl-PL", {
                    maximumFractionDigits: cr < 1 ? 2 : 1,
                  })}
                  %
                </p>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
