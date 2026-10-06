import { cn } from "@/lib/utils";

/**
 * Class recipe for segmented controls (v2 skin, benchmark 4): a soft pill
 * track with the selected segment as the near-black "anchor" pill (inverts
 * to off-white in dark). Shared by the date range picker and every filter
 * toggle so they all match. Markup stays with the caller
 * (role="radiogroup" / role="radio", aria-pressed, etc.) - the selected
 * state is never colour-only because the caller marks it in ARIA and the
 * pill's fill/weight change together.
 */
export const segmentedTrack =
  "inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-muted p-1";

export function segmentedItem(active: boolean, className?: string) {
  return cn(
    "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
    active
      ? "bg-anchor text-anchor-foreground shadow-[0_1px_2px_rgb(0_0_0/0.12),0_4px_10px_-4px_rgb(0_0_0/0.25)]"
      : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
    className
  );
}
