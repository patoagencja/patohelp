"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A ranked list that shows its top few rows and keeps the rest one click
 * away ("Pokaż wszystkie"). The hidden rows stay in the DOM so printing /
 * "Pobierz PDF" still lists them all. Children must be <li> elements.
 */
export function ShowMoreList({
  initial = 5,
  children,
  className,
  moreLabel = "Pokaż wszystkie",
  lessLabel = "Pokaż mniej",
}: {
  initial?: number;
  children: ReactNode;
  className?: string;
  moreLabel?: string;
  lessLabel?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const items = Children.toArray(children);
  const hidden = items.length - initial;

  return (
    <>
      {/* Collapsed rows are only hidden on screen; paper gets the full list. */}
      <ol
        id={id}
        className={cn(
          "[&>[data-collapsed]]:hidden print:[&>[data-collapsed]]:flex",
          className
        )}
      >
        {items.map((item, i) =>
          i < initial || open || !isValidElement(item)
            ? item
            : cloneElement(item as React.ReactElement<Record<string, unknown>>, {
                "data-collapsed": "",
              })
        )}
      </ol>
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={id}
          data-print-hide
          // Soft pill (v2): same family as the segmented controls.
          className="mt-4 inline-flex items-center gap-1 self-start rounded-full bg-muted px-3.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-foreground/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? lessLabel : `${moreLabel} (${items.length})`}
          <ChevronDown
            className={cn("h-4 w-4 transition-transform motion-reduce:transition-none", open && "rotate-180")}
            aria-hidden
          />
        </button>
      ) : null}
    </>
  );
}
