"use client";

import { useEffect } from "react";

/**
 * Cursor spotlight for glass cards (Przeglad-pastel `.gl::after`). ONE
 * passive pointermove listener on the document, rAF-throttled, writes
 * --mx/--my on the glass card under the pointer only (the design's demo
 * updated every card on every move - a layout read per card per event).
 * Fine pointers only; off for reduced motion; renders nothing.
 */
export function Spotlight() {
  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!fine.matches || still.matches) return;
    let current: HTMLElement | null = null;
    let last: PointerEvent | null = null;
    let raf = 0;
    const clear = (el: HTMLElement | null) => {
      el?.style.removeProperty("--mx");
      el?.style.removeProperty("--my");
    };
    const apply = () => {
      raf = 0;
      const e = last;
      if (!e) return;
      const hit = e.target instanceof Element ? e.target.closest<HTMLElement>(".glass, .surface") : null;
      const target = hit && !hit.classList.contains("surface-anchor") ? hit : null;
      if (current && current !== target) clear(current);
      current = target;
      if (!target) return;
      const r = target.getBoundingClientRect();
      target.style.setProperty("--mx", `${Math.round(e.clientX - r.left)}px`);
      target.style.setProperty("--my", `${Math.round(e.clientY - r.top)}px`);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      last = e;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      clear(current);
      current = null;
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
      clear(current);
    };
  }, []);
  return null;
}
