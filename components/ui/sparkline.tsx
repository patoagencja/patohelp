import { useId } from "react";

import { cn } from "@/lib/utils";

const TONE: Record<SparklineTone, string> = {
  positive: "text-positive",
  negative: "text-negative",
  neutral: "text-chart-muted",
  accent: "text-chart-1",
};

export type SparklineTone = "positive" | "negative" | "neutral" | "accent";

function movingAverage(v: number[], w: number): number[] {
  if (w <= 1) return v;
  const h = Math.floor(w / 2);
  return v.map((_, i) => {
    const from = Math.max(0, i - h);
    const to = Math.min(v.length, i + h + 1);
    let sum = 0;
    for (let k = from; k < to; k++) sum += v[k];
    return sum / (to - from);
  });
}

/**
 * Tiny trend line for KPI tiles (benchmarks 1 / 2): no axes, a soft
 * gradient under the line, a dot on the last value. Purely decorative - the
 * tile's number and delta carry the meaning - so it is aria-hidden.
 * Stretches to its box (set the size with className, e.g. "h-10 w-28");
 * the stroke stays 1.75px at any width.
 */
export function Sparkline({
  data: raw,
  tone = "accent",
  className,
  fill = true,
  smooth = true,
}: {
  /** Oldest -> newest. Fewer than 2 points renders nothing. */
  data: number[];
  tone?: SparklineTone;
  className?: string;
  /** Soft gradient area under the line. */
  fill?: boolean;
  /**
   * Centered moving average (window ~n/8). A 30-day daily series is all
   * weekday zig-zag at this size; the tile only needs the direction.
   */
  smooth?: boolean;
}) {
  const gradId = useId();
  if (raw.length < 2) return null;
  const data = smooth ? movingAverage(raw, Math.max(1, Math.round(raw.length / 8))) : raw;
  const W = 100;
  const H = 32;
  const pad = 3;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const x = (i: number) => (i * W) / (data.length - 1);
  // Flat series sit mid-height instead of hugging the floor.
  const y = (v: number) =>
    max === min ? H / 2 : pad + (H - pad * 2) * (1 - (v - min) / span);
  const line = data.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join("");
  const area = `${line}L${W},${H}L0,${H}Z`;
  const lastY = y(data[data.length - 1]);

  return (
    <span aria-hidden className={cn("relative block", TONE[tone], className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full overflow-visible"
      >
        {fill ? (
          <>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity={0.22} />
                <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={area} fill={`url(#${gradId})`} />
          </>
        ) : null}
        <path
          d={line}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/* The end dot lives outside the stretched SVG so it stays round. */}
      <span
        className="absolute right-0 h-1.5 w-1.5 -translate-y-1/2 translate-x-1/2 rounded-full bg-current ring-2 ring-card"
        style={{ top: `${(lastY / H) * 100}%` }}
      />
    </span>
  );
}
