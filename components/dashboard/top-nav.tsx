"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { buildNav, findActive, findSection, topNavItems } from "@/components/dashboard/nav-items";
import { SegmentedTrack, segmentedItem } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

/**
 * The floating bar's section switcher: a sliding segmented pill of links
 * (Przegląd · [Sezon] · [Sprzedaż] · Reklamy · Strona · Alerty). Kreacje
 * lights up Reklamy. aria-current carries the selection for assistive tech;
 * the pill fill + contrast carry it visually. The guided tour points at this
 * nav (aria-label "Sekcje").
 */
export function TopNav({
  base,
  isEcommerce,
  isSeasonal = false,
  isAgency,
  omit = [],
  className,
}: {
  base: string;
  isEcommerce: boolean;
  isSeasonal?: boolean;
  isAgency: boolean;
  omit?: string[];
  className?: string;
}) {
  const pathname = usePathname();
  const sp = useSearchParams();
  // The public demo keeps its language switch across tabs.
  const suffix = sp.get("lang") === "en" ? "?lang=en" : "";
  const groups = buildNav({ base, isEcommerce, isSeasonal, isAgency, omit });
  const items = topNavItems(groups);
  const section = findSection(groups, findActive(groups, pathname, base));

  return (
    <SegmentedTrack as="nav" aria-label="Sekcje" className={cn("flex rounded-full bg-chip p-1", className)}>
      {items.map((item) => {
        const on = section?.href === item.href;
        return (
          <Link
            key={item.href}
            href={`${item.href}${suffix}`}
            aria-current={on ? "page" : undefined}
            className={segmentedItem(
              on,
              "min-h-11 justify-center px-3.5 text-sm xl:px-4"
            )}
          >
            {item.short ?? item.label}
          </Link>
        );
      })}
    </SegmentedTrack>
  );
}

/** Phone header: the current page's short name ("Przegląd"). */
export function PageName({
  base,
  isEcommerce,
  isSeasonal = false,
  isAgency,
  className,
}: {
  base: string;
  isEcommerce: boolean;
  isSeasonal?: boolean;
  isAgency: boolean;
  className?: string;
}) {
  const pathname = usePathname();
  const page = findActive(buildNav({ base, isEcommerce, isSeasonal, isAgency }), pathname, base);
  if (!page) return null;
  return <span className={className}>{page.short ?? page.label}</span>;
}
