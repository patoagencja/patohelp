import Link from "next/link";

import { cn } from "@/lib/utils";

const TABS = [
  { slug: "", label: "Sezon" },
  { slug: "/budzet", label: "Budżet" },
  { slug: "/rynki", label: "Rynki" },
] as const;

export type SeasonTab = "sezon" | "budzet" | "rynki";

/**
 * Sub-navigation inside "Sezon": the season, its budget, its markets. One
 * top-level tab instead of three - the client bar already holds five.
 */
export function SeasonTabs({ base, active }: { base: string; active: SeasonTab }) {
  return (
    <nav aria-label="Widoki sezonu" className="flex w-fit gap-1 rounded-full bg-chip p-1">
      {TABS.map((t) => {
        const key: SeasonTab = t.slug === "" ? "sezon" : (t.slug.slice(1) as SeasonTab);
        const on = key === active;
        return (
          <Link
            key={t.slug}
            href={`${base}${t.slug}`}
            aria-current={on ? "page" : undefined}
            className={cn(
              "inline-flex min-h-10 items-center rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "bg-anchor text-anchor-foreground" : "text-ink-2 hover:bg-[var(--chip-hover)] hover:text-foreground"
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
