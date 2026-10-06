import { cn } from "@/lib/utils";

/**
 * Class recipe for iOS-style segmented controls: a grey track with the
 * selected segment raised as a white (dark: lighter grey) chip. Shared by
 * the date range picker and any phase-2 filter toggles so they all match.
 * Markup stays with the caller (role="radiogroup" / role="radio" etc.).
 */
export const segmentedTrack =
  "inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-xl bg-muted p-1";

export function segmentedItem(active: boolean, className?: string) {
  return cn(
    "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[0.6rem] px-3 py-1.5 text-sm font-medium transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
    active
      ? "bg-segment text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.08),0_1px_6px_-1px_rgb(0_0_0/0.06)]"
      : "text-muted-foreground hover:text-foreground",
    className
  );
}
