import Link from "next/link";
import { CalendarDays } from "lucide-react";

import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import type { CompareMode, NetRange, RangePreset } from "@/lib/daily-net/calc";
import { cn } from "@/lib/utils";

/** The page's own query string: range preset or from/to, and the comparison. */
export function wynikHref(
  path: string,
  q: { range?: RangePreset; from?: string; to?: string; cmp?: CompareMode }
): string {
  const p = new URLSearchParams();
  if (q.from && q.to) {
    p.set("from", q.from);
    p.set("to", q.to);
  } else if (q.range && q.range !== "custom") {
    p.set("range", q.range);
  }
  if (q.cmp === "weekday") p.set("cmp", "weekday");
  const s = p.toString();
  return s ? `${path}?${s}` : path;
}

/**
 * Range quick picks (this season for seasonal shops, this month, the last
 * 30 days) plus a custom from/to. Plain links and a GET form: it works
 * before hydration, and each range keeps its own URL. The date range
 * picker the other pages use offers 7/30/90 days and months, not a season.
 */
export function NetRangeControl({
  path,
  range,
  mode,
  seasonal,
}: {
  path: string;
  range: NetRange;
  mode: CompareMode;
  seasonal: boolean;
}) {
  const picks: Array<[RangePreset, string]> = [
    ...(seasonal ? ([["season", "Ten sezon"]] as Array<[RangePreset, string]>) : []),
    ["month", "Ten miesiąc"],
    ["30d", "Ostatnie 30 dni"],
  ];
  const custom = range.preset === "custom";
  const field =
    "h-9 rounded-xl border-transparent bg-chip px-3 text-sm tabular-nums text-foreground hover:bg-secondary focus:border-hairline focus:bg-card focus:outline-none focus:ring-2 focus:ring-ring [@media(pointer:coarse)]:h-11";
  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <nav aria-label="Zakres dat" className={segmentedTrack}>
        {picks.map(([key, label]) => (
          <Link
            key={key}
            href={wynikHref(path, { range: key, cmp: mode })}
            aria-current={range.preset === key ? "true" : undefined}
            className={segmentedItem(range.preset === key, "[@media(pointer:coarse)]:min-h-11")}
          >
            {label}
          </Link>
        ))}
      </nav>
      <details className="group self-start sm:self-end" open={custom}>
        <summary
          className={cn(
            "inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-full px-3.5 text-sm font-medium text-ink-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden [@media(pointer:coarse)]:min-h-11",
            custom && "bg-anchor text-anchor-foreground hover:text-anchor-foreground"
          )}
        >
          <CalendarDays className="h-3.5 w-3.5" aria-hidden />
          Własny zakres
        </summary>
        <form method="get" action={path} className="mt-2 flex flex-wrap items-center gap-1.5">
          <input type="date" name="from" required defaultValue={custom ? range.start : ""} aria-label="Data od" className={field} />
          <span className="text-xs text-muted-foreground">–</span>
          <input type="date" name="to" required defaultValue={custom ? range.end : ""} aria-label="Data do" className={field} />
          {mode === "weekday" ? <input type="hidden" name="cmp" value="weekday" /> : null}
          <button
            type="submit"
            className="h-9 rounded-full bg-anchor px-4 text-sm font-medium text-anchor-foreground shadow-sm hover:bg-anchor/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:h-11"
          >
            Pokaż
          </button>
        </form>
      </details>
    </div>
  );
}
