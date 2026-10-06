"use client";

import { useEffect, useId, useState } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The page's single "Pokaż szczegóły" (progressive disclosure): the first
 * screen answers the main question, everything for the curious sits behind
 * one clearly labelled click. Closed by default; the choice is remembered
 * per page in this browser. The content stays in the DOM while closed so
 * print / "Pobierz PDF" still includes it (hidden on screen only).
 */
export function DetailsDisclosure({
  storageKey,
  summary,
  openLabel = "Pokaż szczegóły",
  closeLabel = "Ukryj szczegóły",
  children,
  className,
}: {
  /** localStorage key, e.g. "pato:details:reklamy". */
  storageKey: string;
  /** One muted line naming what's inside, so nobody has to open it to find out. */
  summary?: React.ReactNode;
  openLabel?: string;
  closeLabel?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const contentId = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(storageKey) === "1") setOpen(true);
    } catch {
      // Private mode / blocked storage: just start closed.
    }
  }, [storageKey]);

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        // Not remembering the choice is fine.
      }
      return next;
    });
  };

  return (
    <section className={cn("space-y-6", className)}>
      <div data-print-hide>
        {/* Same disclosure surface as the overview's "Pokaż szczegóły": a
            white card row with a round chevron that turns into the anchor
            pill on hover. */}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={contentId}
          className="group flex w-full items-center justify-between gap-3 rounded-card bg-card px-5 py-4 text-left shadow-card transition-shadow hover:shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-6"
        >
          <span className="min-w-0">
            <span className="block text-base font-semibold text-foreground">
              {open ? closeLabel : openLabel}
            </span>
            {summary && !open ? (
              <span className="mt-0.5 block text-sm text-muted-foreground">{summary}</span>
            ) : null}
          </span>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground transition-colors group-hover:bg-anchor group-hover:text-anchor-foreground">
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform duration-200 motion-reduce:transition-none",
                open && "rotate-180"
              )}
              aria-hidden
            />
          </span>
        </button>
      </div>
      <div
        id={contentId}
        className={cn("space-y-6", open ? "block" : "hidden print:block")}
      >
        {children}
      </div>
    </section>
  );
}
