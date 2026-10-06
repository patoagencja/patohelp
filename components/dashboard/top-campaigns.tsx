import Link from "next/link";
import { ArrowRight } from "lucide-react";

import type { CampaignRow, CampaignStatus } from "@/lib/dashboard/metrics";
import { AD_PROVIDER_LABEL } from "@/lib/types";
import { cn, formatNumberPL, formatPercent, formatPlnWhole } from "@/lib/utils";

const LIMIT = 5;

const STATUS_DOT: Record<CampaignStatus, string> = {
  active: "bg-emerald-500",
  attention: "bg-amber-500",
  critical: "bg-red-500",
  off: "bg-slate-400",
};

const STATUS_LABEL: Record<CampaignStatus, string> = {
  active: "Działa dobrze",
  attention: "Do obejrzenia",
  critical: "Wymaga uwagi",
  off: "Wstrzymana",
};

/**
 * Top campaigns by spend - five rows, four columns, status first. The full,
 * sortable table lives on Reklamy; this answers "where does the money go and
 * is any of it in trouble?" at a glance. Phones keep name + spend only.
 */
export function TopCampaigns({
  campaigns,
  allHref,
}: {
  campaigns: CampaignRow[];
  /** Link to the full campaigns table (Reklamy). */
  allHref: string;
}) {
  const rows = [...campaigns]
    .sort((a, b) => b.spendMinorUnits - a.spendMinorUnits)
    .slice(0, LIMIT);
  if (rows.length === 0) return null;

  return (
    <section aria-labelledby="top-campaigns-heading" className="surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 id="top-campaigns-heading" className="text-base font-semibold">
            Najważniejsze kampanie
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Te z największymi wydatkami w tym okresie.
          </p>
        </div>
        <Link
          href={allHref}
          className="flex items-center gap-1 rounded-sm text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Wszystkie kampanie
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
      <table className="mt-4 w-full table-fixed text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th scope="col" className="pb-2 font-medium">
              Kampania
            </th>
            <th scope="col" className="w-28 pb-2 text-right font-medium sm:w-32">
              Wydatki
            </th>
            <th scope="col" className="hidden w-28 pb-2 text-right font-medium sm:table-cell">
              Kliknięcia
            </th>
            <th scope="col" className="hidden w-24 pb-2 text-right font-medium sm:table-cell">
              Klikalność
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((c) => (
            <tr key={`${c.provider}-${c.campaignId}`}>
              <td className="py-3 pr-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={cn("h-2.5 w-2.5 shrink-0 rounded-full", STATUS_DOT[c.status])}
                    title={c.statusReason ?? STATUS_LABEL[c.status]}
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium" title={c.name}>
                      {c.name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {AD_PROVIDER_LABEL[c.provider]} · {STATUS_LABEL[c.status]}
                    </span>
                  </span>
                </div>
              </td>
              <td className="py-3 text-right tabular-nums">{formatPlnWhole(c.spendMinorUnits)}</td>
              <td className="hidden py-3 text-right tabular-nums sm:table-cell">
                {formatNumberPL(c.clicks)}
              </td>
              <td className="hidden py-3 text-right tabular-nums sm:table-cell">
                {c.impressions > 0 ? formatPercent(c.ctr) : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
