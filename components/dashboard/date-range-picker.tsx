"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";

import { RANGE_KEYS, RANGE_LABELS, type RangeKey } from "@/lib/dashboard/ranges";

// Native <select> (not Tremor's custom Select) so it always hydrates and fires.
// Navigates by setting ?range= and refreshing the server components.
export function DateRangePicker({ value }: { value: RangeKey }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function onChange(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", next);
    router.push(`${pathname}?${params.toString()}`);
    // Next 14 may serve the cached RSC payload when only search params
    // change - force a server re-render so the data actually updates.
    router.refresh();
  }

  return (
    <div className="relative w-full sm:w-52">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Zakres dat"
        className="w-full cursor-pointer appearance-none rounded-lg border border-border bg-card px-3 py-2 pr-9 text-sm font-medium outline-none focus:ring-2 focus:ring-ring"
      >
        {RANGE_KEYS.map((key) => (
          <option key={key} value={key}>
            {RANGE_LABELS[key]}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
