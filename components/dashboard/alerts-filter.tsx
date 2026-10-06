"use client";

import { useState } from "react";

import { SegmentedTrack, segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

export interface AlertFilterGroup {
  key: string;
  /** "Pilne" - the segment shows "Pilne · 2". */
  label: string;
  count: number;
  /** The server-rendered group section. */
  node: React.ReactNode;
}

/**
 * The Alerty board's severity filter (Wszystkie · Pilne · Ważne ·
 * Informacja). The groups stay server-rendered; this only decides which are
 * shown. It returns a fragment so the header row and every group remain
 * separate top-level children of the page - one slide each in presentation
 * mode (a hidden group drops out of the deck, it has no client rects).
 * Print always shows every group.
 */
export function AlertsFilter({
  header,
  groups,
  allLabel,
  ariaLabel,
}: {
  header: React.ReactNode;
  groups: AlertFilterGroup[];
  allLabel: string;
  ariaLabel: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const total = groups.reduce((n, g) => n + g.count, 0);
  const options = [{ key: null as string | null, label: allLabel, count: total }, ...groups];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-6">
        {header}
        {groups.length > 1 ? (
          <SegmentedTrack
            role="group"
            aria-label={ariaLabel}
            data-print-hide
            className={cn(segmentedTrack, "animate-rise [--d:.3s] print:hidden")}
          >
            {options.map((o) => {
              const on = active === o.key;
              return (
                <button
                  key={o.key ?? "all"}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setActive(o.key)}
                  className={segmentedItem(on, "min-h-11 px-3 text-[13px] sm:px-4 sm:text-sm")}
                >
                  {o.label}
                  <span className={cn("-ml-0.5 tabular-nums", on ? "opacity-70" : "text-ink-3")}>· {o.count}</span>
                </button>
              );
            })}
          </SegmentedTrack>
        ) : null}
      </div>
      {groups.map((g) => (
        <div key={g.key} className={cn(active !== null && active !== g.key && "hidden print:block")}>
          {g.node}
        </div>
      ))}
    </>
  );
}
