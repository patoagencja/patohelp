"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Loader2 } from "lucide-react";

import { RANGE_KEYS, RANGE_LABELS, type RangeKey } from "@/lib/dashboard/ranges";
import { SegmentedTrack, segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

const SHORT_LABELS: Record<RangeKey, string> = {
  "7d": "7 dni",
  "30d": "30 dni",
  "90d": "90 dni",
  "365d": "Rok",
  month: "Ten miesiąc",
  prev_month: "Poprzedni",
};

/**
 * Segmented range switcher. Navigation runs in a transition, so the current
 * screen stays put (dimmed via `data-pending` on <html>, see globals.css)
 * while the new range streams in - no white flash, no skeleton jump. Chunk
 * errors after a deploy are recovered by the route error boundary's reload.
 * The custom range is still a real GET form, so it works before hydration.
 */
export function DateRangePicker({
  value,
  customFrom,
  customTo,
  align = "end",
  size = "default",
}: {
  value: RangeKey;
  customFrom?: string;
  customTo?: string;
  /** "start" in the overview hero (left column), "end" in page headers. */
  align?: "start" | "end";
  /** "lg" = the hero's 44px segments (Przeglad-pastel). */
  size?: "default" | "lg";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const hasCustom = Boolean(customFrom && customTo);
  const [customOpen, setCustomOpen] = useState(hasCustom);
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (pending) root.dataset.pending = "true";
    else delete root.dataset.pending;
    if (!pending) setTarget(null);
    return () => {
      delete root.dataset.pending;
    };
  }, [pending]);

  function go(params: URLSearchParams) {
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  function onPreset(next: RangeKey) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", next);
    params.delete("from");
    params.delete("to");
    setTarget(next);
    setCustomOpen(false);
    go(params);
  }

  const active = hasCustom ? "custom" : value;

  return (
    <div className={cn("flex flex-col items-stretch gap-2", align === "end" ? "sm:items-end" : "sm:items-start")}>
      {/* Sliding "sel" pill under the active range (SegmentedTrack). */}
      <SegmentedTrack
        role="radiogroup"
        aria-label="Zakres dat"
        className={segmentedTrack}
      >
        {RANGE_KEYS.map((key) => {
          const isActive = (target ?? active) === key;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={isActive}
              title={RANGE_LABELS[key]}
              onClick={() => onPreset(key)}
              className={segmentedItem(isActive, size === "lg" ? "min-h-11 px-4" : undefined)}
            >
              {pending && target === key ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : null}
              {SHORT_LABELS[key]}
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={active === "custom" && !target}
          onClick={() => setCustomOpen((o) => !o)}
          className={segmentedItem(active === "custom" && !target, size === "lg" ? "min-h-11 px-4" : undefined)}
        >
          <CalendarDays className="h-3.5 w-3.5" aria-hidden />
          Własny
        </button>
      </SegmentedTrack>

      {customOpen ? (
        <form
          method="get"
          action={pathname}
          onSubmit={(e) => {
            const form = new FormData(e.currentTarget);
            const from = String(form.get("from") ?? "");
            const to = String(form.get("to") ?? "");
            if (!from || !to) return; // let the browser show "required"
            e.preventDefault();
            const params = new URLSearchParams(searchParams.toString());
            params.delete("range");
            params.set("from", from);
            params.set("to", to);
            setTarget("custom");
            go(params);
          }}
          className="flex flex-wrap items-center gap-1.5 animate-in fade-in slide-in-from-top-1"
        >
          <input
            type="date"
            name="from"
            required
            defaultValue={customFrom ?? ""}
            aria-label="Data od"
            className="h-9 rounded-xl border-transparent bg-chip px-3 text-sm tabular-nums text-foreground transition-[background-color,box-shadow] duration-150 hover:bg-secondary focus:border-hairline focus:bg-card focus:outline-none focus:ring-2 focus:ring-ring dark:focus:bg-muted"
          />
          <span className="text-xs text-muted-foreground">–</span>
          <input
            type="date"
            name="to"
            required
            defaultValue={customTo ?? ""}
            aria-label="Data do"
            className="h-9 rounded-xl border-transparent bg-chip px-3 text-sm tabular-nums text-foreground transition-[background-color,box-shadow] duration-150 hover:bg-secondary focus:border-hairline focus:bg-card focus:outline-none focus:ring-2 focus:ring-ring dark:focus:bg-muted"
          />
          <button
            type="submit"
            className="h-9 rounded-full bg-anchor px-4 text-sm font-medium text-anchor-foreground shadow-sm transition-colors duration-150 hover:bg-anchor/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Pokaż
          </button>
        </form>
      ) : null}
    </div>
  );
}
