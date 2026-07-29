"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Flame, Sparkles } from "lucide-react";

import type { DailyScore, ScoreRing, ScoreTier } from "@/lib/dashboard/score";
import { cn } from "@/lib/utils";

const TIER: Record<ScoreTier, { ring: string; text: string }> = {
  high: { ring: "#10b981", text: "text-emerald-500" },
  mid: { ring: "#f59e0b", text: "text-amber-500" },
  low: { ring: "#f43f5e", text: "text-rose-500" },
};

const CARD_GLOW: Record<ScoreTier, string> = {
  high: "shadow-[0_0_40px_-8px_rgba(16,185,129,0.5)]",
  mid: "shadow-[0_0_40px_-12px_rgba(245,158,11,0.4)]",
  low: "shadow-[0_0_40px_-12px_rgba(244,63,94,0.35)]",
};

// Count a number up from 0 on mount - the little "nabijanie się" per ring.
function useCountUp(target: number, ms = 950, delay = 0): number {
  const [n, setN] = useState(0);
  const raf = useRef<number>();
  useEffect(() => {
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now + delay;
      const t = Math.min(1, Math.max(0, (now - start) / ms));
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setN(Math.round(eased * target));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [target, ms, delay]);
  return n;
}

function Ring({
  ring,
  size,
  delay,
}: {
  ring: ScoreRing;
  size: number;
  delay: number;
}) {
  const tier = TIER[ring.tier];
  const count = useCountUp(ring.value, 950, delay);
  const stroke = size >= 128 ? 11 : 9;
  const R = size / 2 - stroke;
  const C = 2 * Math.PI * R;
  const [offset, setOffset] = useState(C);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOffset(C * (1 - ring.value / 100)));
    return () => cancelAnimationFrame(id);
  }, [C, ring.value]);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={R}
            fill="none"
            strokeWidth={stroke}
            className="stroke-muted"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={R}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            stroke={tier.ring}
            strokeDasharray={C}
            strokeDashoffset={offset}
            style={{
              transition: `stroke-dashoffset 1.1s cubic-bezier(0.22,1,0.36,1) ${delay}ms`,
            }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={cn(
              "font-mono font-bold tabular-nums",
              size >= 128 ? "text-4xl" : "text-2xl",
              tier.text
            )}
          >
            {count}
          </span>
        </div>
      </div>
      <span className="text-xs font-semibold text-muted-foreground">
        {ring.label}
      </span>
    </div>
  );
}

export function DailyScoreCard({
  data,
  lang = "pl",
}: {
  data: DailyScore;
  lang?: "pl" | "en";
}) {
  const en = lang === "en";
  const pulsLabel = en ? "Pulse · last 7 days" : "Puls · ostatnie 7 dni";
  const vsLabel = en ? "vs last week" : "vs poprzedni tydzień";
  const streakLabel = (n: number) =>
    en
      ? `${n} ${n === 1 ? "day" : "days"} streak`
      : `${n} ${n === 1 ? "dzień" : "dni"} serii`;
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border bg-card p-5 sm:p-6",
        CARD_GLOW[data.tier]
      )}
    >
      {data.tier === "high" ? (
        <div className="pointer-events-none absolute inset-0 animate-[shimmer_3s_ease-in-out_infinite] bg-[linear-gradient(110deg,transparent_35%,rgba(16,185,129,0.10)_50%,transparent_65%)] bg-[length:200%_100%]" />
      ) : null}

      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:gap-8">
        {/* Rings */}
        <div className="flex items-center justify-center gap-6 sm:gap-8">
          {data.rings.map((r, i) => (
            <Ring
              key={r.key}
              ring={r}
              size={i === 0 ? 128 : 96}
              delay={i * 140}
            />
          ))}
        </div>

        {/* Copy */}
        <div className="min-w-0 flex-1 text-center lg:text-left">
          <div className="flex items-center justify-center gap-2 lg:justify-start">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {pulsLabel}
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
                {data.delta} {vsLabel}
              </span>
            ) : null}
          </div>

          <p className="mt-1 text-lg font-semibold leading-snug">{data.headline}</p>

          <div className="mt-3 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
            {data.streak > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/10 px-2.5 py-1 text-xs font-semibold text-orange-600 dark:text-orange-400">
                <Flame className="h-3.5 w-3.5 animate-pulse" />
                {streakLabel(data.streak)}
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
