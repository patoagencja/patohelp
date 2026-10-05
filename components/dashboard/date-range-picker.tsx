"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Loader2 } from "lucide-react";

import { RANGE_KEYS, RANGE_LABELS, type RangeKey } from "@/lib/dashboard/ranges";
import { cn } from "@/lib/utils";

const SHORT_LABELS: Record<RangeKey, string> = {
  "7d": "7 dni",
  "30d": "30 dni",
  "90d": "90 dni",
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
}: {
  value: RangeKey;
  customFrom?: string;
  customTo?: string;
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
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <div
        role="radiogroup"
        aria-label="Zakres dat"
        className="inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-xl border border-border bg-card p-1 shadow-sm"
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
              className={cn(
                "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {pending && target === key ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
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
          className={cn(
            "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
            active === "custom" && !target
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <CalendarDays className="h-3.5 w-3.5" />
          Własny
        </button>
      </div>

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
            className="h-9 rounded-lg border border-border bg-card px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="text-xs text-muted-foreground">–</span>
          <input
            type="date"
            name="to"
            required
            defaultValue={customTo ?? ""}
            aria-label="Data do"
            className="h-9 rounded-lg border border-border bg-card px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="submit"
            className="h-9 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Pokaż
          </button>
        </form>
      ) : null}
    </div>
  );
}
