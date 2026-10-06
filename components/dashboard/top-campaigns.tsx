import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { Ping, type PingTone } from "@/components/ui/primitives";
import type { CampaignRow, CampaignStatus } from "@/lib/dashboard/metrics";
import { AD_PROVIDER_LABEL } from "@/lib/types";
import { cn, formatPercent, formatPlnWhole } from "@/lib/utils";

const LIMIT = 5;

// Status = a ping dot + the words (colour is never the only cue).
const STATUS_PING: Record<CampaignStatus, PingTone> = {
  active: "lime",
  attention: "amber",
  critical: "coral",
  off: "muted",
};

const STATUS_LABEL: Record<CampaignStatus, string> = {
  active: "Działa dobrze",
  attention: "Do obejrzenia",
  critical: "Wymaga uwagi",
  off: "Wstrzymana",
};

const SHARE_FILL: Record<CampaignStatus, string> = {
  active: "share-fill",
  attention: "share-fill-warn",
  critical: "share-fill-bad",
  off: "share-fill opacity-50",
};

// Name | share of spend | spend | CTR (Przeglad-pastel `.crow`). Phones keep
// name + spend; the share bar joins from sm, CTR from md.
// At lg the card shares the row with the plan, so the share bar steps out
// until xl rather than squeezing the names.
const ROW =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(5rem,1fr)_6.5rem] sm:gap-x-[18px] md:grid-cols-[minmax(0,1.4fr)_minmax(7.5rem,1fr)_6.5rem_4.75rem] lg:grid-cols-[minmax(0,1fr)_6.5rem_4.75rem] xl:grid-cols-[minmax(0,1.4fr)_minmax(7.5rem,1fr)_6.5rem_4.75rem]";
const SHARE_COL = "hidden sm:block lg:hidden xl:block";

/**
 * "Gdzie idą pieniądze": the top campaigns by spend - status ping, platform
 * tag, status words, a share-of-spend bar (lime; amber/coral when the
 * campaign needs a look), spend and CTR. The full, sortable table lives on
 * Reklamy ("Wszystkie N").
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
  const total = campaigns.reduce((a, c) => a + Math.max(0, c.spendMinorUnits), 0);
  const top = Math.max(1, rows[0].spendMinorUnits);

  return (
    <section
      aria-labelledby="top-campaigns-heading"
      className="glass min-w-0 rounded-glass p-6 sm:p-7"
    >
      <div className="mb-2.5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="kick">Kampanie w tym okresie</p>
          <h2 id="top-campaigns-heading" className="mt-2 text-[22px] font-medium tracking-[-0.03em]">
            Gdzie idą pieniądze
          </h2>
        </div>
        <Link
          href={allHref}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-chip px-[18px] text-sm font-medium text-foreground transition-[background-color,transform] duration-200 hover:bg-[var(--chip-hover)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:active:scale-100"
        >
          Wszystkie {campaigns.length}
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
      <table className="w-full text-sm">
        <caption className="sr-only">Kampanie z największymi wydatkami w tym okresie</caption>
        <thead>
          <tr className={cn(ROW, "py-2")}>
            <th scope="col" className="kick text-left text-[10.5px] font-normal">
              Kampania
            </th>
            <th scope="col" className={cn("kick text-left text-[10.5px] font-normal", SHARE_COL)}>
              Udział w wydatkach
            </th>
            <th scope="col" className="kick text-right text-[10.5px] font-normal">
              Wydatki
            </th>
            <th scope="col" className="kick hidden text-right text-[10.5px] font-normal md:block">
              Klikalność
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c, i) => {
            const share = total > 0 ? (c.spendMinorUnits / total) * 100 : 0;
            return (
              <tr key={`${c.provider}-${c.campaignId}`} className={cn(ROW, "border-t border-line py-[15px]")}>
                <td className="flex min-w-0 items-center gap-3">
                  <Ping tone={STATUS_PING[c.status]} still={c.status === "off"} />
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-medium" title={c.name}>
                      {c.name}
                    </span>
                    <span className="mt-[5px] flex flex-wrap items-center gap-2">
                      <span className="inline-flex h-[22px] items-center rounded-full bg-chip px-2 text-[11.5px] font-medium text-ink-2">
                        {AD_PROVIDER_LABEL[c.provider]}
                      </span>
                      <span className="text-[12.5px] text-ink-2" title={c.statusReason ?? STATUS_LABEL[c.status]}>
                        {STATUS_LABEL[c.status]}
                      </span>
                    </span>
                  </span>
                </td>
                <td className={SHARE_COL}>
                  <span className="sr-only">{Math.round(share)}% wydatków</span>
                  <span aria-hidden className="relative block h-2 overflow-hidden rounded-full bg-chip">
                    <span
                      className={cn(
                        "absolute inset-y-0 left-0 origin-left rounded-full animate-grow",
                        SHARE_FILL[c.status]
                      )}
                      style={
                        {
                          width: `${Math.max(2, (c.spendMinorUnits / top) * 100)}%`,
                          "--d": `${0.8 + i * 0.1}s`,
                        } as React.CSSProperties
                      }
                    />
                  </span>
                </td>
                <td className="whitespace-nowrap text-right text-[15px] font-medium tabular-nums">
                  {formatPlnWhole(c.spendMinorUnits)}
                </td>
                <td className="hidden text-right text-[15px] tabular-nums text-ink-2 md:block">
                  {c.impressions > 0 ? formatPercent(c.ctr) : "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
