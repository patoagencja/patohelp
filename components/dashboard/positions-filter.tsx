"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

export type PositionFilter = "all" | "active" | "attention";

const FILTERS: Array<{ key: PositionFilter; label: string }> = [
  { key: "all", label: "Wszystkie" },
  { key: "active", label: "Otwarte" },
  { key: "attention", label: "Wymagają uwagi" },
];

// URL-driven filter (same mechanism as the date-range picker, which works
// reliably) - avoids depending on local client state for the switch.
export function PositionsFilter({ value }: { value: PositionFilter }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function select(next: PositionFilter) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("camp", next);
    router.push(`${pathname}?${params.toString()}`);
    router.refresh();
  }

  return (
    <div className="flex rounded-lg bg-muted p-1">
      {FILTERS.map((f) => (
        <button
          key={f.key}
          type="button"
          onClick={() => select(f.key)}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-medium transition-colors",
            value === f.key
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
