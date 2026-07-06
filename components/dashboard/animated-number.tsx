"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

// easeOutCubic — fast start, gentle settle. The "slot machine" feel that makes
// trading apps addictive comes from the number racing up then easing in.
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * A number that counts up to `value` on mount and animates (with a brief
 * green/red flash) whenever `value` changes — e.g. after a refresh. `format`
 * turns the live numeric into the displayed string every frame.
 */
export function AnimatedNumber({
  value,
  format,
  durationMs = 900,
  className,
}: {
  value: number;
  format: (n: number) => string;
  durationMs?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const fromRef = useRef(0); // start each animation from 0 on first paint
  const rafRef = useRef<number>();

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) {
      setDisplay(to);
      return;
    }

    setFlash(to > from ? "up" : "down");
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1);
      setDisplay(from + (to - from) * ease(t));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
        setTimeout(() => setFlash(null), 500);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, durationMs]);

  return (
    <span
      className={cn(
        "tabular-nums transition-colors duration-300",
        flash === "up" && "text-emerald-500",
        flash === "down" && "text-red-500",
        className
      )}
    >
      {format(display)}
    </span>
  );
}
