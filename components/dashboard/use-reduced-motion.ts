"use client";

import { useEffect, useState } from "react";

/**
 * Live `prefers-reduced-motion` for JS-driven animation (Tremor's
 * showAnimation, count-ups) that CSS `motion-reduce:` variants can't reach.
 * Starts as "reduced" so the server render and first paint never animate.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
