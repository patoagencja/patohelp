import { cn } from "@/lib/utils";

import type { KindMeta } from "./ab-meta";

/**
 * Verdict / proposal tag: a small tinted icon disc + the word in its tone
 * (lime = sells better, coral = cut, amber = wearing out, grey = wait). No
 * filled capsule on purpose: a filled "Wyłącz" pill read as a button that
 * would switch the ad off, and these are labels, never controls. The word
 * carries the meaning, so it reads the same in grey print and for
 * colour-blind eyes.
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
        "inline-flex min-w-0 items-center font-semibold leading-tight",
        size === "md" ? "gap-2 text-[13px]" : "gap-1.5 text-[12px]",
        meta.text,
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid shrink-0 place-items-center rounded-full",
          size === "md" ? "h-6 w-6" : "h-5 w-5",
          meta.disc
        )}
      >
        <Icon className={size === "md" ? "h-3.5 w-3.5" : "h-3 w-3"} strokeWidth={2.4} />
      </span>
      <span className="min-w-0">{meta.label}</span>
    </span>
  );
}
