import { cn } from "@/lib/utils";

import type { KindMeta } from "./ab-meta";

/**
 * Verdict / action chip: icon + word on a meaning tint (lime = act on it,
 * coral = cut, amber = wearing out, grey = wait). The word carries the
 * meaning, so it reads the same in grey print and for colour-blind eyes.
 */
export function KindChip({
  meta,
  size = "md",
  className,
}: {
  meta: KindMeta;
  /** "sm" for dense rows and the compare columns. */
  size?: "sm" | "md";
  className?: string;
}) {
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full font-semibold",
        size === "md"
          ? "min-h-8 gap-1.5 whitespace-nowrap px-3 text-[13px]"
          : "min-h-6 gap-1 px-2.5 py-0.5 text-[12px] leading-tight",
        meta.chip,
        className
      )}
    >
      <Icon className={size === "md" ? "h-3.5 w-3.5 shrink-0" : "h-3 w-3 shrink-0"} strokeWidth={2.4} aria-hidden />
      {meta.label}
    </span>
  );
}
