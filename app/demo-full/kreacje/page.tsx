import { Trophy } from "lucide-react";

import { CreativesTable } from "@/components/dashboard/creatives-table";
import { getDemoDashboard } from "@/lib/demo/data";
import { formatMoneyPLN, formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default function DemoFullKreacje() {
  const d = getDemoDashboard();
  const top5 = [...d.creativesFull].sort((a, b) => b.spend - a.spend).slice(0, 5);
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">Kreacje</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Wyniki na poziomie pojedynczych reklam · {d.rangeLabel}
        </p>
      </div>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Trophy className="h-4 w-4 text-amber-500" />
          Top 5 kreacji wg wydatków
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {top5.map((c, i) => (
            <div key={c.adId} className="rounded-xl border border-border bg-card">
              <div className="relative overflow-hidden rounded-t-xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.thumbnailUrl ?? ""} alt="" className="h-36 w-full bg-muted object-cover" />
                <span className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white shadow">
                  {i + 1}
                </span>
              </div>
              <div className="space-y-1.5 p-3">
                <p className="truncate text-sm font-medium" title={c.name}>{c.name}</p>
                <p className="font-mono text-base font-bold tabular-nums">{formatMoneyPLN(c.spend)}</p>
                <div className="flex items-center justify-between font-mono text-xs text-muted-foreground">
                  <span>CTR {formatPercent(c.ctr ?? 0)}</span>
                  <span>CPC {c.cpc != null ? formatMoneyPLN(c.cpc) : "-"}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <CreativesTable creatives={d.creativesFull} />
    </>
  );
}
