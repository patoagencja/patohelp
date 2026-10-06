import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { DeltaPill, type DeltaTone } from "@/components/ui/pill";
import { Sparkline, type SparklineTone } from "@/components/ui/sparkline";
import { cn } from "@/lib/utils";

/**
 * One KPI tile (v2 skin, benchmarks 1 / 4): label, a big confident number,
 * a small floating delta pill and, optionally, a sparkline bottom-right.
 * Shared by the overview, Sprzedaż and Strona www rows so all read the same:
 * the number is the loudest thing, everything else is quiet.
 *
 * `selected` flips the tile to the near-black anchor surface (the overview's
 * tiles act as the chart's tabs); tokens are re-pointed by .surface-anchor,
 * so children need no special casing.
 */
export function MetricTile({
  label,
  value,
  delta,
  sparkline,
  sparkTone = "accent",
  selected = false,
  overlay,
  children,
  className,
}: {
  /** Usually a MetricLabel (name + ⓘ). */
  label: ReactNode;
  value: ReactNode;
  /** <MetricDelta> (pill + words) or any small node under the number. */
  delta?: ReactNode;
  /** Daily values, oldest -> newest; decorative (aria-hidden). */
  sparkline?: number[];
  sparkTone?: SparklineTone;
  selected?: boolean;
  /** Absolutely positioned layer (e.g. the whole-tile button). */
  overlay?: ReactNode;
  /** Extra context lines under the number (comparison, meaning). */
  children?: ReactNode;
  className?: string;
}) {
  const hasSpark = Boolean(sparkline && sparkline.length > 1);
  return (
    // z-index lift keeps an open ⓘ bubble above the neighbouring tiles.
    <Card
      className={cn(
        "relative flex min-w-0 flex-col p-4 transition-[box-shadow,background-color] duration-200 focus-within:z-10 hover:z-10 sm:p-5",
        selected && "surface-anchor shadow-raised",
        className
      )}
    >
      {overlay}
      {/* With an overlay button the content lets clicks through to it; the
          label's ⓘ stays clickable above it. */}
      <div
        className={cn(
          "relative flex flex-1 flex-col",
          overlay && "pointer-events-none [&_button]:pointer-events-auto [&_a]:pointer-events-auto"
        )}
      >
        <div className="min-h-[1.25rem]">{label}</div>
        <p className="mt-2 truncate text-[1.75rem] font-medium leading-none tracking-[-0.03em] tabular-nums text-foreground sm:text-metric">
          {value}
        </p>
        {delta || hasSpark ? (
          <div className="mt-3 flex items-end justify-between gap-2">
            <div className="min-w-0">{delta}</div>
            {hasSpark ? (
              <Sparkline
                data={sparkline!}
                tone={sparkTone}
                className={cn(
                  // Phones: two tiles per row leave no room - the chart right
                  // below shows the trend anyway.
                  "mb-1 hidden h-9 w-20 shrink-0 sm:block",
                  // On the anchor surface the line takes the lime dot colour.
                  selected && "!text-anchor-dot"
                )}
              />
            ) : null}
          </div>
        ) : null}
        {children ? (
          <div className="mt-2 space-y-1 text-[13px] leading-snug">{children}</div>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * "↗ 16%  więcej niż wcześniej": the delta as a pill + the plain words.
 * Accepts the story's phrased change ("o 16% więcej niż wcześniej") and
 * lifts the percentage into the pill; text without a % goes in whole.
 */
export function MetricDelta({
  text,
  tone,
  direction,
}: {
  text: string;
  tone: DeltaTone;
  direction: "up" | "down" | null;
}) {
  const m = /^o (\d+(?:[.,]\d+)?\s?%)\s+(.*)$/.exec(text);
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] leading-snug text-muted-foreground">
      <DeltaPill tone={tone} direction={direction}>
        {m ? m[1] : text}
      </DeltaPill>
      {m ? <span>{m[2]}</span> : null}
    </p>
  );
}
