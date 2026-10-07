import Link from "next/link";

import { SegmentedTrack, segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

export interface SectionTab {
  href: string;
  label: string;
  /** True for the tab of the page being rendered. */
  active?: boolean;
}

/**
 * Tabs that switch between sibling routes of one place (Reklamy: Kampanie |
 * Kreacje), drawn like the segmented controls (v2): a soft pill track with
 * the current tab as the near-black anchor pill. Plain links rather than
 * client-side tabs: each tab keeps its own URL, data loading and
 * back-button behaviour, and the server page simply marks which one it is.
 * The current tab is marked with aria-current and a bolder label too, so
 * the fill is never the only cue.
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
    <nav aria-label={label} className={cn("flex", className)} data-print-hide>
      {/* Sliding ink pill (2026): the indicator glides between the tabs;
          SSR still paints the current tab itself. */}
      <SegmentedTrack as="ul" className={segmentedTrack}>
        {tabs.map((t) => (
          <li key={t.href} className="flex">
            <Link
              href={t.href}
              aria-current={t.active ? "page" : undefined}
              className={segmentedItem(
                Boolean(t.active),
                cn("min-h-11 px-[18px] text-[15px]", t.active && "font-semibold")
              )}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </SegmentedTrack>
    </nav>
  );
}

/**
 * The Reklamy place's tabs. `query` is appended to every link so the demo's
 * ?lang=en (or the chosen date range) survives switching tabs. "Testy
 * kreacji" judges ads by purchases and sales, so only shops and seasonal
 * sellers get it (`showTests`); engagement clients never see ROAS.
 */
export function AdsSectionTabs({
  base,
  active,
  query = "",
  lang = "pl",
  showTests = false,
}: {
  /** Client root, e.g. "/dre" or "/demo-full". */
  base: string;
  active: "kampanie" | "kreacje" | "testy";
  /** Search string including the leading "?", or "". */
  query?: string;
  lang?: "pl" | "en";
  showTests?: boolean;
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
        ...(showTests || active === "testy"
          ? [
              {
                href: `${base}/kreacje/testy${query}`,
                label: en ? "Creative tests" : "Testy kreacji",
                active: active === "testy",
              },
            ]
          : []),
      ]}
    />
  );
}
