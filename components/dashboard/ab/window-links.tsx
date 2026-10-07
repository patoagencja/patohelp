"use client";

import { useEffect, useState, useTransition, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { SegmentedTrack, segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

export interface WindowLink {
  key: string;
  href: string;
  label: string;
  /** The dates behind the label, for the tooltip. */
  title?: string;
}

/**
 * The period (Dziś · 3 dni · ... · Cały sezon) as real links, so each
 * period has its own URL and works before hydration. A plain click
 * navigates in a transition instead: the current tests stay on screen,
 * dimmed (data-pending, as in DateRangePicker), until the new period has
 * streamed in - no skeleton flash between two periods.
 */
export function AbWindowLinks({ items, current }: { items: WindowLink[]; current: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (pending) root.dataset.pending = "true";
    else {
      delete root.dataset.pending;
      setTarget(null);
    }
    return () => {
      delete root.dataset.pending;
    };
  }, [pending]);

  const onClick = (e: MouseEvent<HTMLAnchorElement>, item: WindowLink) => {
    // New tab / window keeps the browser's own behaviour.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    if (item.key === current) return;
    setTarget(item.key);
    startTransition(() => router.push(item.href, { scroll: false }));
  };

  return (
    // A block, not a flex row: as a flex item the track would refuse to
    // shrink below its six segments and widen the whole phone layout. On
    // phones it wraps to two rows: sideways scrolling hid "Cały sezon"
    // off-screen with no cue that it was there.
    <nav aria-label="Okres porównania" className="min-w-0 max-w-full">
      <SegmentedTrack
        as="ul"
        className={cn(segmentedTrack, "min-w-0 max-sm:flex-wrap max-sm:overflow-visible max-sm:rounded-[24px]")}
      >
        {items.map((item) => {
          const active = (target ?? current) === item.key;
          return (
            <li key={item.key} className="flex">
              <Link
                href={item.href}
                scroll={false}
                title={item.title}
                aria-current={item.key === current ? "true" : undefined}
                onClick={(e) => onClick(e, item)}
                className={segmentedItem(active, "min-h-11 px-4")}
              >
                {pending && target === item.key ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : null}
                {item.label}
              </Link>
            </li>
          );
        })}
      </SegmentedTrack>
    </nav>
  );
}
