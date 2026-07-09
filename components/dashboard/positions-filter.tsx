import { cn } from "@/lib/utils";

export type PositionFilter = "all" | "active" | "attention";

const FILTERS: Array<{ key: PositionFilter; label: string }> = [
  { key: "all", label: "Wszystkie" },
  { key: "active", label: "Otwarte" },
  { key: "attention", label: "Wymagają uwagi" },
];

// Plain anchor links (hard navigation) — bulletproof: the filter switches even
// if client JS hasn't hydrated. The page is force-dynamic so each URL renders
// the correctly filtered list server-side.
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
        <a
          key={f.key}
          href={`/${clientSlug}/reklamy?range=${range}&camp=${f.key}`}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-medium transition-colors",
            value === f.key
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {f.label}
        </a>
      ))}
    </div>
  );
}
