"use client";

import { Info } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

// Keep the bubble this far from the viewport edges on small phones.
const EDGE_GAP = 8;

/**
 * Small ⓘ "toggletip" explaining a metric in plain words. Opens on mouse
 * hover (desktop) and on tap/click (touch has no hover), closes on outside
 * click or Escape. Hand-rolled because the stack has no popover primitive and
 * adding Radix for one bubble isn't worth a dependency.
 */
export function InfoTip({
  label,
  text,
  lang = "pl",
  className,
}: {
  /** What is being explained - used for the button's accessible name. */
  label: string;
  text: string;
  lang?: "pl" | "en";
  className?: string;
}) {
  const id = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const [open, setOpen] = useState(false);
  // A click "pins" the bubble so moving the mouse away doesn't close it.
  const [pinned, setPinned] = useState(false);
  const [place, setPlace] = useState<{ side: "top" | "bottom"; shift: number }>({
    side: "top",
    shift: 0,
  });

  const close = useCallback(() => {
    setOpen(false);
    setPinned(false);
  }, []);

  // Measure before paint so the bubble never flashes off-screen: prefer above
  // (it then overlaps the previous row, which paints underneath), flip below
  // when there's no room, and slide sideways to stay inside the viewport.
  useLayoutEffect(() => {
    if (!open) return;
    const btn = buttonRef.current;
    const bubble = bubbleRef.current;
    if (!btn || !bubble) return;
    const b = btn.getBoundingClientRect();
    const h = bubble.offsetHeight;
    const w = bubble.offsetWidth;
    const side = b.top - h - EDGE_GAP < 0 ? "bottom" : "top";
    const center = b.left + b.width / 2;
    const left = center - w / 2;
    const right = center + w / 2;
    const vw = document.documentElement.clientWidth;
    let shift = 0;
    if (left < EDGE_GAP) shift = EDGE_GAP - left;
    else if (right > vw - EDGE_GAP) shift = vw - EDGE_GAP - right;
    setPlace({ side, shift });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close();
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  return (
    <span
      ref={wrapRef}
      className={cn("relative inline-flex", className)}
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        clearTimeout(closeTimer.current);
        setOpen(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse" || pinned) return;
        // Short grace period so the pointer can cross the gap to the bubble.
        closeTimer.current = setTimeout(() => setOpen(false), 120);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={lang === "en" ? `What is ${label}?` : `Co to znaczy: ${label}?`}
        aria-expanded={open}
        aria-describedby={id}
        onClick={() => {
          if (pinned) {
            close();
          } else {
            setOpen(true);
            setPinned(true);
          }
        }}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      <span
        ref={bubbleRef}
        id={id}
        role="tooltip"
        style={{ transform: `translateX(calc(-50% + ${place.shift}px))` }}
        className={cn(
          "absolute left-1/2 z-50 w-max max-w-[min(16rem,calc(100vw-1rem))] rounded-lg border border-border bg-popover px-3 py-2 text-left text-xs font-normal leading-relaxed text-popover-foreground shadow-lg",
          place.side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
          // display:none (not just invisible) so a closed bubble near the
          // right edge can't widen the page and cause horizontal scroll.
          !open && "hidden"
        )}
      >
        {text}
      </span>
    </span>
  );
}

/**
 * KPI card heading: friendly name first, the industry abbreviation as a small
 * muted tag (people still hear "CTR" from platforms and agencies), then the ⓘ.
 */
export function MetricLabel({
  name,
  tag,
  explain,
  lang = "pl",
  className,
}: {
  name: string;
  tag?: string | null;
  explain: string;
  lang?: "pl" | "en";
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5", className)}>
      <span className="text-sm font-medium text-foreground">
        {name}
      </span>
      {tag ? (
        <span className="rounded bg-muted px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {tag}
        </span>
      ) : null}
      <InfoTip label={tag ?? name} text={explain} lang={lang} />
    </span>
  );
}
