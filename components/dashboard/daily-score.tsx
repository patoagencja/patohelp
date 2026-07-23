"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Flame, Sparkles } from "lucide-react";

import type { DailyScore, ScoreTier } from "@/lib/dashboard/score";
import { cn } from "@/lib/utils";

const TIER: Record<
  ScoreTier,
  { ring: string; text: string; glow: string; label: string }
> = {
  high: {
    ring: "#10b981",
    text: "text-emerald-500",
    glow: "shadow-[0_0_40px_-8px_rgba(16,185,129,0.5)]",
    label: "Świetna forma",
  },
  mid: {
    ring: "#f59e0b",
    text: "text-amber-500",
    glow: "shadow-[0_0_40px_-12px_rgba(245,158,11,0.4)]",
    label: "Solidnie",
  },
  low: {
    ring: "#f43f5e",
    text: "text-rose-500",
    glow: "shadow-[0_0_40px_-12px_rgba(244,63,94,0.35)]",
    label: "Do rozruszania",
  },
};

// Count a number up from 0 on mount - the little "nabijanie się" that makes the
// score feel alive every time you open the page.
function useCountUp(target: number, ms = 900): number {
  const [n, setN] = useState(0);
  const raf = useRef<number>();
  useEffect(() => {
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      setN(Math.round(eased * target));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [target, ms]);
  return n;
}

export function DailyScoreCard({ data }: { data: DailyScore }) {
  const tier = TIER[data.tier];
  const count = useCountUp(data.score);

  // Ring geometry.
  const R = 54;
  const C = 2 * Math.PI * R;
  const [offset, setOffset] = useState(C);
  useEffect(() => {
    // Draw the arc after mount so the CSS transition animates it in.
    const id = requestAnimationFrame(() =>
      setOffset(C * (1 - data.score / 100))
    );
    return () => cancelAnimationFrame(id);
  }, [C, data.score]);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border bg-card p-5 sm:p-6",
        tier.glow
      )}
    >
      {/* Positive shimmer sweep for a strong day. */}
      {data.tier === "high" ? (
        <div className="pointer-events-none absolute inset-0 animate-[shimmer_3s_ease-in-out_infinite] bg-[linear-gradient(110deg,transparent_35%,rgba(16,185,129,0.10)_50%,transparent_65%)] bg-[length:200%_100%]" />
      ) : null}

      <div className="relative flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-7">
        {/* Ring */}
        <div className="relative h-36 w-36 shrink-0">
          <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
            <circle
              cx="64"
              cy="64"
              r={R}
              fill="none"
              strokeWidth="10"
              className="stroke-muted"
            />
            <circle
              cx="64"
              cy="64"
              r={R}
              fill="none"
              strokeWidth="10"
              strokeLinecap="round"
              stroke={tier.ring}
              strokeDasharray={C}
              strokeDashoffset={offset}
              style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(0.22,1,0.36,1)" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={cn("font-mono text-4xl font-bold tabular-nums", tier.text)}>
              {count}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Puls
            </span>
          </div>
        </div>

        {/* Right side */}
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <div className="flex items-center justify-center gap-2 sm:justify-start">
            <span className={cn("text-sm font-semibold", tier.text)}>
              {tier.label}
            </span>
            {data.delta !== null && data.delta !== 0 ? (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-mono text-xs font-semibold",
                  data.delta > 0
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                )}
              >
                {data.delta > 0 ? (
                  <ArrowUpRight className="h-3 w-3" />
                ) : (
                  <ArrowDownRight className="h-3 w-3" />
                )}
                {data.delta > 0 ? "+" : ""}
                {data.delta} vs wczoraj
              </span>
            ) : null}
          </div>

          <p className="mt-1 text-lg font-semibold leading-snug">{data.headline}</p>

          {/* Streak + factor chips */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            {data.streak > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/10 px-2.5 py-1 text-xs font-semibold text-orange-600 dark:text-orange-400">
                <Flame className="h-3.5 w-3.5 animate-pulse" />
                {data.streak} {data.streak === 1 ? "dzień" : "dni"} serii
              </span>
            ) : null}
            {data.factors
              .filter((f) => f.deltaPct !== null)
              .map((f) => (
                <span
                  key={f.key}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 font-mono text-xs",
                    (f.deltaPct ?? 0) >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400"
                  )}
                >
                  {(f.deltaPct ?? 0) >= 0 ? (
                    <ArrowUpRight className="h-3 w-3" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3" />
                  )}
                  {f.label} {(f.deltaPct ?? 0) > 0 ? "+" : ""}
                  {f.deltaPct}%
                </span>
              ))}
          </div>
        </div>

        {data.tier === "high" ? (
          <Sparkles className="absolute right-3 top-3 h-5 w-5 animate-pulse text-emerald-400/70" />
        ) : null}
      </div>
    </div>
  );
}
