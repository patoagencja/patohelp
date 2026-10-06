import Link from "next/link";

import { cn } from "@/lib/utils";

export interface SectionTab {
  href: string;
  label: string;
  /** True for the tab of the page being rendered. */
  active?: boolean;
}

/**
 * Underline tabs that switch between sibling routes of one place (Reklamy:
 * Kampanie | Kreacje). Plain links rather than client-side tabs: each tab
 * keeps its own URL, data loading and back-button behaviour, and the server
 * page simply marks which one it is.
 */
export function SectionTabs({
  tabs,
  label,
  className,
}: {
  tabs: SectionTab[];
  /** Accessible name of the tab group, e.g. "Widok reklam". */
  label: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn("border-b border-border", className)}>
      <ul className="-mb-px flex gap-6">
        {tabs.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              aria-current={t.active ? "page" : undefined}
              className={cn(
                "inline-flex h-10 items-center border-b-2 text-[15px] transition-colors focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                t.active
                  ? "border-foreground font-semibold text-foreground"
                  : "border-transparent font-medium text-muted-foreground hover:border-border hover:text-foreground"
              )}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The Reklamy place's two tabs. `query` is appended to both links so the
 * demo's ?lang=en (or the chosen date range) survives switching tabs.
 */
export function AdsSectionTabs({
  base,
  active,
  query = "",
  lang = "pl",
}: {
  /** Client root, e.g. "/dre" or "/demo-full". */
  base: string;
  active: "kampanie" | "kreacje";
  /** Search string including the leading "?", or "". */
  query?: string;
  lang?: "pl" | "en";
}) {
  const en = lang === "en";
  return (
    <SectionTabs
      label={en ? "Ads view" : "Widok reklam"}
      tabs={[
        {
          href: `${base}/reklamy${query}`,
          label: en ? "Campaigns" : "Kampanie",
          active: active === "kampanie",
        },
        {
          href: `${base}/kreacje${query}`,
          label: en ? "Creatives" : "Kreacje",
          active: active === "kreacje",
        },
      ]}
    />
  );
}
