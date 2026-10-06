"use client";

import { useEffect, useRef, useState } from "react";

const NUM = /^(\D*?)(\d[\d \u00a0\u202f]*(?:,\d+)?)([\s\S]*)$/;
const ease = (t: number) => 1 - Math.pow(1 - t, 4);

function format(n: number, decimals: number, sep: string): string {
  const fixed = n.toFixed(decimals);
  const [int, frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  return frac ? `${grouped},${frac}` : grouped;
}

/**
 * Counts a formatted Polish figure up from zero ("43 885 zł", "0,95 zł",
 * "1,2 mln"): the number part animates, prefix/suffix stay. Server render
 * and reduced motion show the final text; anything unparseable is shown
 * as is. Plays on mount and whenever `text` changes (range switch).
 * Sibling of components/dashboard/animated-number.tsx (which takes a
 * number + formatter and flashes on change - use that for live tickers).
 */
export function CountUp({
  text,
  durationMs = 1300,
  delayMs = 0,
  className,
}: {
  text: string;
  durationMs?: number;
  delayMs?: number;
  className?: string;
}) {
  const [shown, setShown] = useState(text);
  const raf = useRef<number>();

  useEffect(() => {
    setShown(text);
    const m = NUM.exec(text);
    if (!m || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const [, pre, num, post] = m;
    const sepMatch = /[ \u00a0\u202f]/.exec(num);
    const sep = sepMatch ? sepMatch[0] : "\u00a0";
    const decimals = num.includes(",") ? num.split(",")[1].length : 0;
    const target = Number(num.replace(/[ \u00a0\u202f]/g, "").replace(",", "."));
    if (!Number.isFinite(target) || target === 0) return;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const t = Math.min(1, (now - start - delayMs) / durationMs);
      if (t < 0) {
        raf.current = requestAnimationFrame(tick);
        return;
      }
      setShown(t >= 1 ? text : `${pre}${format(target * ease(t), decimals, sep)}${post}`);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    setShown(`${pre}${format(0, decimals, sep)}${post}`);
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [text, durationMs, delayMs]);

  // The final value for assistive tech; the ticking digits are decoration.
  return (
    <span className={className}>
      <span aria-hidden>{shown}</span>
      <span className="sr-only">{text}</span>
    </span>
  );
}
