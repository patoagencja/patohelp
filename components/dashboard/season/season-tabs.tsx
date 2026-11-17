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
 * Shops also get "Wynik": the season day by day, revenue minus every ad
 * channel (it lives under Sprzedaż, `resultHref` points there).
 */
export function SeasonTabs({
  base,
  active,
  resultHref,
}: {
  base: string;
  active: SeasonTab;
  /** "/<slug>/wynik?range=season" for a shop; absent for other clients. */
  resultHref?: string;
}) {
  const tabs: Array<{ key: string; href: string; label: string }> = [
    ...TABS.map((t) => ({ key: t.slug === "" ? "sezon" : t.slug.slice(1), href: `${base}${t.slug}`, label: t.label })),
    ...(resultHref ? [{ key: "wynik", href: resultHref, label: "Wynik" }] : []),
  ];
  return (
    <nav aria-label="Widoki sezonu" className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-chip p-1 [scrollbar-width:none]">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={on ? "page" : undefined}
            title={t.key === "wynik" ? "Wynik dzień po dniu: przychód minus wszystkie reklamy" : undefined}
            className={cn(
              "inline-flex min-h-10 shrink-0 items-center rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
