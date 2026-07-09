import { TrendingDown, TrendingUp } from "lucide-react";

import type { CampaignRow } from "@/lib/dashboard/metrics";
import { cn, formatMoneyPLN } from "@/lib/utils";

// Recent-vs-earlier spend delta from the 7-day spark, so each campaign gets a
// stock-style % move on the tape.
function spendDelta(spark: number[]): number | null {
  if (spark.length < 4) return null;
  const half = Math.floor(spark.length / 2);
  const prior = spark.slice(0, half).reduce((a, b) => a + b, 0);
  const recent = spark.slice(half).reduce((a, b) => a + b, 0);
  if (prior <= 0) return null;
  return ((recent - prior) / prior) * 100;
}

function TickerItem({ c }: { c: CampaignRow }) {
  const delta = spendDelta(c.spark);
  const up = (delta ?? 0) >= 0;
  return (
    <span className="inline-flex items-center gap-2 px-5 text-sm">
      <span className="font-semibold uppercase tracking-wide text-muted-foreground">
        {c.provider === "meta_ads" ? "META" : "GOOG"}
      </span>
      <span className="max-w-[14rem] truncate text-foreground">{c.name}</span>
      <span className="tabular-nums font-medium text-foreground">
        {formatMoneyPLN(c.spendMinorUnits)}
      </span>
      {delta !== null ? (
        <span
          className={cn(
            "inline-flex items-center gap-0.5 tabular-nums font-semibold",
            up ? "text-emerald-500" : "text-red-500"
          )}
        >
          {up ? (
            <TrendingUp className="h-3.5 w-3.5" />
          ) : (
            <TrendingDown className="h-3.5 w-3.5" />
          )}
          {up ? "+" : ""}
          {delta.toFixed(1)}%
        </span>
      ) : null}
      <span className="text-border">•</span>
    </span>
  );
}

/**
 * Scrolling campaign tape at the top of the dashboard - a stock-ticker for ad
 * campaigns. Content is duplicated so the marquee loops seamlessly.
 */
export function TickerBar({ campaigns }: { campaigns: CampaignRow[] }) {
  const items = campaigns
    .filter((c) => c.status !== "off" && c.spendMinorUnits > 0)
    .slice(0, 20);

  if (items.length === 0) return null;

  return (
    <div className="ticker-mask overflow-hidden rounded-xl border border-border bg-card py-2.5">
      <div className="ticker-track">
        {[...items, ...items].map((c, i) => (
          <TickerItem key={`${c.provider}:${c.campaignId}:${i}`} c={c} />
        ))}
      </div>
    </div>
  );
}
