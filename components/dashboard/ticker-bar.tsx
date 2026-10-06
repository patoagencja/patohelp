import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import type { CampaignRow } from "@/lib/dashboard/metrics";
import { AD_PROVIDER_LABEL, type AdProvider } from "@/lib/types";
import { cn, formatPlnWhole } from "@/lib/utils";

const PLATFORM_PILL: Record<AdProvider, string> = {
  meta_ads: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  google_ads: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  tiktok_ads: "bg-pink-500/10 text-pink-700 dark:text-pink-300",
};

// Recent-vs-earlier spend change from the 7-day spark - the same measure as the
// "Zmiana" column in the campaigns table, so the two never disagree.
function spendDelta(spark: number[]): number | null {
  if (spark.length < 4) return null;
  const half = Math.floor(spark.length / 2);
  // Daily averages, not sums: a 7-day spark splits 3 + 4 days, and summing
  // made every campaign look ~33% "up" (+76% rows next to a +11% total).
  const priorDays = spark.slice(0, half);
  const recentDays = spark.slice(half);
  const prior = priorDays.reduce((a, b) => a + b, 0) / priorDays.length;
  const recent = recentDays.reduce((a, b) => a + b, 0) / recentDays.length;
  if (prior <= 0) return null;
  return ((recent - prior) / prior) * 100;
}

function TickerItem({ c }: { c: CampaignRow }) {
  const delta = spendDelta(c.spark);
  const up = (delta ?? 0) >= 0;
  return (
    <span className="inline-flex items-center gap-2 px-4 text-xs text-muted-foreground">
      <span
        className={cn(
          "rounded-full px-1.5 py-px text-[10px] font-medium",
          PLATFORM_PILL[c.provider]
        )}
      >
        {AD_PROVIDER_LABEL[c.provider]}
      </span>
      <span className="max-w-[14rem] truncate">{c.name}</span>
      <span className="font-medium tabular-nums text-foreground/80">
        {formatPlnWhole(c.spendMinorUnits)}
      </span>
      {delta !== null ? (
        <span
          className={cn(
            "inline-flex items-center tabular-nums",
            up
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-red-700 dark:text-red-400"
          )}
        >
          {up ? (
            <ArrowUpRight className="h-3 w-3" aria-hidden />
          ) : (
            <ArrowDownRight className="h-3 w-3" aria-hidden />
          )}
          {up ? "+" : ""}
          {Math.round(delta)}%
        </span>
      ) : null}
      <span className="pl-2 text-border" aria-hidden>
        ·
      </span>
    </span>
  );
}

/**
 * Quiet scrolling strip of active campaigns with their spend and recent spend
 * change. Kept deliberately small and muted: it is ambient context, not
 * something the reader has to study. Content is duplicated so the marquee
 * loops seamlessly; the copy is hidden from screen readers.
 */
export function TickerBar({ campaigns }: { campaigns: CampaignRow[] }) {
  const items = campaigns
    .filter((c) => c.status !== "off" && c.spendMinorUnits > 0)
    .slice(0, 20);

  if (items.length === 0) return null;

  return (
    // Focusable so keyboard users can pause the marquee too (it pauses on
    // hover and focus) - WCAG 2.2.2 wants moving content to be stoppable.
    <div
      className="ticker-mask overflow-hidden rounded-xl print:hidden border border-border/60 bg-card/60 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="Aktywne kampanie: wydatki i zmiana w ostatnich dniach"
      role="region"
      tabIndex={0}
    >
      <div className="ticker-track">
        {items.map((c) => (
          <TickerItem key={`${c.provider}:${c.campaignId}`} c={c} />
        ))}
        <span className="contents" aria-hidden>
          {items.map((c) => (
            <TickerItem key={`${c.provider}:${c.campaignId}:dup`} c={c} />
          ))}
        </span>
      </div>
    </div>
  );
}
