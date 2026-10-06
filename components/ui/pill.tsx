import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

// Subtle status/label pills. Soft tinted fill, no border, sentence case.
// Every tone reads from v2 tokens (app/globals.css); text is >= 4.5:1 on its
// own tint in both themes.
const pillVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        neutral: "bg-muted text-muted-foreground",
        accent: "bg-accent text-accent-foreground",
        positive: "bg-positive-soft text-positive",
        negative: "bg-negative-soft text-negative",
        warning: "bg-warning-soft text-warning",
        /** AI-generated content (Analiza AI chip). */
        ai: "bg-ai-soft text-ai",
        /** Solid signature lime: the one highlighted value (e.g. "+16%"). */
        lime: "bg-lime text-lime-foreground",
        /** Near-black selected/primary chip. */
        anchor: "bg-anchor text-anchor-foreground",
        /** White chip floating on a tinted or grey surface. */
        surface: "bg-card text-foreground shadow-card",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
);

export interface PillProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof pillVariants> {}

export function Pill({ className, tone, ...props }: PillProps) {
  return <span className={cn(pillVariants({ tone }), className)} {...props} />;
}

export type DeltaTone = "good" | "bad" | "flat";

const DELTA_TONE: Record<DeltaTone, NonNullable<PillProps["tone"]>> = {
  good: "positive",
  bad: "negative",
  flat: "neutral",
};

/**
 * The small floating delta pill of a KPI tile (benchmarks 1 / 4): arrow +
 * short change. `tone` is the judgement (good/bad news), `direction` where
 * the number went - a cheaper click is good news pointing down. Arrows (and
 * the words in `children`) keep the meaning without colour.
 */
export function DeltaPill({
  tone,
  direction,
  children,
  className,
  ...props
}: {
  tone: DeltaTone;
  /** null = flat / no direction (renders a dash). */
  direction: "up" | "down" | null;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLSpanElement>) {
  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;
  return (
    <Pill
      tone={DELTA_TONE[tone]}
      className={cn("gap-0.5 px-2 py-0.5 text-[13px] font-semibold tabular-nums [&_svg]:size-3.5", className)}
      {...props}
    >
      <Icon aria-hidden strokeWidth={2.5} />
      {children}
    </Pill>
  );
}

export { pillVariants };
