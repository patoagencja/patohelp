import Link from "next/link";

import { cn } from "@/lib/utils";

export type PositionFilter = "all" | "active" | "attention";

const FILTERS: Array<{ key: PositionFilter; label: string }> = [
  { key: "all", label: "Wszystkie" },
  { key: "active", label: "Otwarte" },
  { key: "attention", label: "Wymagają uwagi" },
];

// Next <Link> — client-side navigation that updates the `camp` search param, so
// the force-dynamic page re-renders the filtered list without a full reload.
export function PositionsFilter({
  value,
  clientSlug,
  range,
}: {
  value: PositionFilter;
  clientSlug: string;
  range: string;
}) {
  return (
    <div className="flex rounded-lg bg-muted p-1">
      {FILTERS.map((f) => (
        <Link
          key={f.key}
          href={`/${clientSlug}/reklamy?range=${range}&camp=${f.key}`}
          scroll={false}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-medium transition-colors",
            value === f.key
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {f.label}
        </Link>
      ))}
    </div>
  );
}
