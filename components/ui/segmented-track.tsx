"use client";

import { useEffect, useLayoutEffect, useRef, type ElementType, type HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

// useLayoutEffect warns on the server; the indicator is client-only anyway.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The 2026 sliding segmented control (Przeglad-pastel `.slide`): one ink
 * "sel" pill glides (spring) under whichever item is active. Drop-in for the
 * `segmentedTrack` class recipe: render the same `segmentedItem(active)`
 * buttons/links inside, as children (directly or inside <li>).
 *
 * How it stays robust:
 * - The active item is found by the `seg-active` class segmentedItem()
 *   adds, so callers keep their own markup and ARIA (radio, aria-pressed,
 *   aria-current).
 * - Until the indicator has been measured (SSR, before hydration) the
 *   active item paints its own fill, so there is never a frame without a
 *   selection. After that `data-sliding="on"` hands the fill to the pill.
 * - Measured on every render and on resize (variable-width items, wrap).
 * - Reduced motion: no transition (globals.css), it just jumps.
 * - Too wide for its box (the date ranges on a phone), the track scrolls:
 *   `data-more` names the edge(s) with more items and globals.css fades
 *   that edge out, so a cut-off "Poprzedni" reads as "scroll for more"
 *   rather than as the last option. An active item that starts out of
 *   view is scrolled into it once.
 */
export function SegmentedTrack({
  as: Tag = "div",
  className,
  children,
  ...rest
}: {
  as?: "div" | "nav" | "ul";
} & HTMLAttributes<HTMLElement>) {
  const ref = useRef<HTMLElement>(null);
  const indRef = useRef<HTMLElement>(null);
  const placed = useRef(false);

  // Which edges hide items; 1px of slack for sub-pixel widths.
  const edges = () => {
    const track = ref.current;
    if (!track) return;
    // Only a track that can scroll gets a fade: content overflowing a
    // non-scrolling one is a layout bug a fade would only hide.
    const scrolls = /auto|scroll/.test(getComputedStyle(track).overflowX);
    const max = scrolls ? track.scrollWidth - track.clientWidth : 0;
    const more = [
      max > 1 && track.scrollLeft > 1 ? "start" : "",
      max > 1 && track.scrollLeft < max - 1 ? "end" : "",
    ]
      .filter(Boolean)
      .join(" ");
    if (more) track.setAttribute("data-more", more);
    else track.removeAttribute("data-more");
  };

  const measure = () => {
    const track = ref.current;
    const ind = indRef.current;
    if (!track || !ind) return;
    edges();
    const active = track.querySelector<HTMLElement>(".seg-active");
    if (!active || active.offsetWidth === 0) {
      ind.style.opacity = "0";
      track.removeAttribute("data-sliding");
      return;
    }
    // offsetLeft/Top are relative to the track (it is `relative`), and in
    // its scroll coordinates, so a scrolling track carries the pill along.
    let x = 0;
    let y = 0;
    for (let el: HTMLElement | null = active; el && el !== track; el = el.offsetParent as HTMLElement | null) {
      x += el.offsetLeft;
      y += el.offsetTop;
    }
    const first = !placed.current;
    if (first) ind.style.transition = "none";
    ind.style.opacity = "1";
    ind.style.width = `${active.offsetWidth}px`;
    ind.style.height = `${active.offsetHeight}px`;
    ind.style.transform = `translate(${x}px, ${y}px)`;
    track.setAttribute("data-sliding", "on");
    if (first) {
      placed.current = true;
      // A picked "Poprzedni" past a phone's edge: bring it into view (the
      // track only - scrollIntoView would also move the page).
      if (x + active.offsetWidth > track.scrollLeft + track.clientWidth || x < track.scrollLeft) {
        track.scrollLeft = Math.max(0, x - 24);
        edges();
      }
      // Re-enable the spring after this frame.
      requestAnimationFrame(() => {
        if (indRef.current) indRef.current.style.transition = "";
      });
    }
  };

  useIsoLayoutEffect(measure);

  useEffect(() => {
    const track = ref.current;
    if (!track) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(track);
    track.addEventListener("scroll", edges, { passive: true });
    // Fonts swapping in change item widths.
    document.fonts?.ready.then(() => measure()).catch(() => {});
    return () => {
      ro.disconnect();
      track.removeEventListener("scroll", edges);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const Comp = Tag as ElementType;
  const Ind = (Tag === "ul" ? "li" : "span") as ElementType;
  return (
    <Comp ref={ref} className={cn("seg-track relative", className)} {...rest}>
      <Ind ref={indRef} aria-hidden role={Tag === "ul" ? "presentation" : undefined} className="seg-indicator" style={{ opacity: 0 }} />
      {children}
    </Comp>
  );
}
