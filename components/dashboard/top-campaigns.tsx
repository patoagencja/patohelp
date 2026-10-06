import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import type { CampaignRow, CampaignStatus } from "@/lib/dashboard/metrics";
import { AD_PROVIDER_LABEL } from "@/lib/types";
import { cn, formatNumberPL, formatPercent, formatPlnWhole } from "@/lib/utils";

const LIMIT = 5;

// Status = a small coloured dot + the words (colour is never the only cue).
const STATUS_DOT: Record<CampaignStatus, string> = {
  active: "bg-lime ring-lime-soft",
  attention: "bg-warning-fill ring-warning-soft",
  critical: "bg-negative ring-negative-soft",
  off: "bg-chart-muted ring-muted",
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
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id="top-campaigns-heading" className="text-section-title">
            Najważniejsze kampanie
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Te z największymi wydatkami w tym okresie.
          </p>
        </div>
        <Link
          href={allHref}
          className="flex items-center gap-1 rounded-full bg-muted py-1.5 pl-3.5 pr-2.5 text-sm font-medium text-foreground transition-colors hover:bg-anchor hover:text-anchor-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Wszystkie kampanie
          <ArrowUpRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
      <table className="mt-4 w-full table-fixed text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
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
        <tbody className="divide-y divide-border border-t border-border">
          {rows.map((c) => (
            <tr key={`${c.provider}-${c.campaignId}`}>
              <td className="py-3.5 pr-3">
                <span className="block truncate font-medium" title={c.name}>
                  {c.name}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                  <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground/80">
                    {AD_PROVIDER_LABEL[c.provider]}
                  </span>
                  <span
                    className="inline-flex items-center gap-1.5"
                    title={c.statusReason ?? STATUS_LABEL[c.status]}
                  >
                    <span
                      className={cn("h-2 w-2 shrink-0 rounded-full ring-[3px]", STATUS_DOT[c.status])}
                      aria-hidden
                    />
                    {STATUS_LABEL[c.status]}
                  </span>
                </span>
              </td>
              <td className="py-3.5 text-right text-[15px] font-medium tabular-nums">
                {formatPlnWhole(c.spendMinorUnits)}
              </td>
              <td className="hidden py-3.5 text-right tabular-nums text-muted-foreground sm:table-cell">
                {formatNumberPL(c.clicks)}
              </td>
              <td className="hidden py-3.5 text-right tabular-nums text-muted-foreground sm:table-cell">
                {c.impressions > 0 ? formatPercent(c.ctr) : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
