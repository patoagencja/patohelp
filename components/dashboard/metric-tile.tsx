import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * One KPI tile: label, the number, and one line saying what it means or how
 * it moved. Shared by the Sprzedaż and Strona www rows so both read the same:
 * the number is the loudest thing, everything else is quiet.
 */
export function MetricTile({
  label,
  value,
  children,
  className,
}: {
  /** Usually a MetricLabel (name + ⓘ). */
  label: ReactNode;
  value: ReactNode;
  /** Comparison / meaning lines under the number. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    // z-index lift keeps an open ⓘ bubble above the neighbouring tiles.
    <Card
      className={cn(
        "relative flex min-w-0 flex-col p-4 focus-within:z-10 hover:z-10 sm:p-5",
        className
      )}
    >
      <div className="min-h-[1.25rem]">{label}</div>
      <p className="mt-2 truncate text-2xl font-semibold tabular-nums tracking-tight text-foreground sm:text-metric">
        {value}
      </p>
      {children ? <div className="mt-2 space-y-1 text-[13px] leading-snug">{children}</div> : null}
    </Card>
  );
}
