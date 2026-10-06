import { cn } from "@/lib/utils";

export { SegmentedTrack } from "@/components/ui/segmented-track";

/**
 * Class recipe for segmented controls (2026 pastel skin, Przeglad-pastel
 * `.slide`): a translucent ink "chip" track with the selected segment as the
 * near-black "sel" pill (off-white in dark). Shared by the date range
 * picker, the nav and every filter toggle so they all match. Markup stays
 * with the caller (role="radiogroup" / role="radio", aria-pressed, etc.) -
 * the selected state is never colour-only because the caller marks it in
 * ARIA and the pill's fill/weight change together.
 *
 * For the sliding indicator, wrap the items in <SegmentedTrack> instead of a
 * plain element with `segmentedTrack` (same classes, plus the gliding pill).
 * This module stays server-safe: the recipe works in server components.
 */
export const segmentedTrack =
  "inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-chip p-1 [scrollbar-width:none]";

export function segmentedItem(active: boolean, className?: string) {
  return cn(
    // seg-item / seg-active: hooks for <SegmentedTrack>'s indicator.
    "seg-item relative flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-[background-color,color,box-shadow] duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
    active
      ? // The inset brand-green ring all but vanishes on the near-black
        // pill (~2:1); the lime dot colour keeps focus visible on it.
        "seg-active bg-anchor text-anchor-foreground shadow-[0_4px_14px_-6px_rgb(40_36_28/0.35)] focus-visible:ring-anchor-dot"
      : "text-ink-2 hover:bg-chip hover:text-foreground",
    className
  );
}
