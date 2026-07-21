"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";

import { RANGE_KEYS, RANGE_LABELS, type RangeKey } from "@/lib/dashboard/ranges";

// Native <select> for presets + an always-visible from/to GET form. The form
// submits natively (no JS state, no conditional rendering), so a custom range
// works even if hydration hiccups; filled from/to overrides the preset
// server-side via parseCustomRange.
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

  function onPreset(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", next);
    params.delete("from");
    params.delete("to");
    router.push(`${pathname}?${params.toString()}`);
    // Next 14 may serve the cached RSC payload when only search params
    // change - force a server re-render so the data actually updates.
    router.refresh();
  }

  const hasCustom = Boolean(customFrom && customTo);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Custom from/to - plain GET form, submits natively. */}
      <form method="get" action={pathname} className="flex items-center gap-1.5">
        <input
          type="date"
          name="from"
          defaultValue={customFrom ?? ""}
          aria-label="Data od"
          className="h-9 rounded-lg border border-border bg-card px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <span className="text-xs text-muted-foreground">-</span>
        <input
          type="date"
          name="to"
          defaultValue={customTo ?? ""}
          aria-label="Data do"
          className="h-9 rounded-lg border border-border bg-card px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          className="h-9 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted"
        >
          OK
        </button>
      </form>

      <div className="relative w-44">
        <select
          value={hasCustom ? "custom" : value}
          onChange={(e) => {
            if (e.target.value !== "custom") onPreset(e.target.value);
          }}
          aria-label="Zakres dat"
          className="w-full cursor-pointer appearance-none rounded-lg border border-border bg-card px-3 py-2 pr-9 text-sm font-medium outline-none focus:ring-2 focus:ring-ring"
        >
          {RANGE_KEYS.map((key) => (
            <option key={key} value={key}>
              {RANGE_LABELS[key]}
            </option>
          ))}
          {hasCustom ? <option value="custom">Własny zakres</option> : null}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      </div>
    </div>
  );
}
