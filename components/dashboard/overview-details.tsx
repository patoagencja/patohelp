"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

const STORAGE_KEY = "pato:overview-details";

/**
 * The overview's single "Pokaż szczegóły" disclosure: the first screen keeps
 * the few things everyone needs, the rest (records, what the agency did, the
 * daily score, every other metric) is one clearly labelled click away.
 *
 * - Closed by default; the choice is remembered per browser.
 * - The content is always in the DOM and only hidden on screen, so print
 *   (the PDF for the board) always includes it.
 * - A link to an anchor inside (e.g. #dzialania from the agency to-do list)
 *   opens it and scrolls there.
 * - Presentation mode skips it while closed (no "click to expand" slide);
 *   opened, it becomes one more slide.
 */
export function OverviewDetails({
  summary,
  children,
}: {
  /** What is inside, in a few words - shown next to the button. */
  summary?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const persist = (v: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {
      // Private mode / blocked storage: the toggle still works this visit.
    }
  };

  const openForHash = useCallback(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return false;
    let target: Element | null = null;
    try {
      target = contentRef.current?.querySelector(`#${CSS.escape(decodeURIComponent(hash))}`) ?? null;
    } catch {
      target = null;
    }
    if (!target) return false;
    setOpen(true);
    // Wait for the content to be displayed before scrolling to it.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => target?.scrollIntoView({ block: "start" }))
    );
    return true;
  }, []);

  useEffect(() => {
    if (!openForHash()) {
      try {
        if (localStorage.getItem(STORAGE_KEY) === "1") setOpen(true);
      } catch {
        // Ignore - closed is the safe default.
      }
    }
    window.addEventListener("hashchange", openForHash);
    return () => window.removeEventListener("hashchange", openForHash);
  }, [openForHash]);

  return (
    // Closed + presenting: hidden (so it is no slide). Not data-present-hide:
    // print hides that too, and the PDF must carry the details.
    <div className={cn("space-y-6", !open && "[html[data-present=true]_&]:hidden")}>
      <button
        type="button"
        data-print-hide
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen((v) => {
            persist(!v);
            return !v;
          });
        }}
        className="flex w-full items-center justify-between gap-3 rounded-card border border-hairline bg-card px-5 py-4 text-left shadow-card transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0">
          <span className="block text-base font-semibold text-foreground">
            {open ? "Ukryj szczegóły" : "Pokaż szczegóły"}
          </span>
          {summary ? (
            <span className="mt-0.5 block text-sm text-muted-foreground">{summary}</span>
          ) : null}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "h-5 w-5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
            open && "rotate-180"
          )}
        />
      </button>
      <div
        id={id}
        ref={contentRef}
        // Hidden on screen only: the printed report always carries details.
        className={cn("space-y-8", !open && "hidden print:block")}
      >
        {children}
      </div>
    </div>
  );
}
