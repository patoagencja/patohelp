import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Subtle status/label pills. Soft tinted fill, no border, sentence case.
// Text shades are chosen for >= 4.5:1 on their own tint in both themes.
const pillVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        neutral: "bg-muted text-muted-foreground",
        accent: "bg-accent text-accent-foreground",
        positive: "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300",
        negative: "bg-red-500/10 text-red-700 dark:bg-red-400/10 dark:text-red-300",
        warning: "bg-amber-500/15 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300",
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

export { pillVariants };
