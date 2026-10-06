import { useId, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export type GaugeTone = "good" | "warn" | "bad" | "neutral";

// Striped fills, matching .bg-stripes bars. Token colours only.
const FILL: Record<GaugeTone, string> = {
  good: "fill-lime",
  neutral: "fill-olive",
  warn: "fill-warning-fill",
  bad: "fill-negative",
};

const R = 84;
const CX = 100;
const CY = 100;

function point(f: number, r = R) {
  const a = Math.PI * (1 - Math.min(1, Math.max(0, f)));
  return { x: CX + r * Math.cos(a), y: CY - r * Math.sin(a) };
}

/**
 * Half-donut gauge (benchmarks 1 / 5) for "how far along is the main goal":
 * a soft track, a striped fill in the tone colour with rounded ends, an
 * optional tick where we should be today, and the caller's content (big
 * percent, value) in the middle. The SVG is decorative - put the
 * role="progressbar" + aria-value* on a wrapper (see PlanCard).
 */
export function HalfGauge({
  pct,
  marker = null,
  tone = "good",
  children,
  className,
}: {
  /** 0-100. */
  pct: number;
  /** Plan position for today, 0-100; null hides the tick. */
  marker?: number | null;
  tone?: GaugeTone;
  /** Centered under the arc's apex (e.g. the big percent). */
  children?: ReactNode;
  className?: string;
}) {
  const id = useId();
  const f = Math.min(100, Math.max(0, pct)) / 100;
  const start = point(0);
  const end = point(f);
  const track = `M${start.x},${start.y} A${R},${R} 0 0 1 ${point(1).x},${point(1).y}`;
  const fill = `M${start.x},${start.y} A${R},${R} 0 0 1 ${end.x.toFixed(2)},${end.y.toFixed(2)}`;
  const m = marker === null ? null : marker / 100;

  return (
    <div className={cn("relative mx-auto w-full max-w-[15rem]", className)}>
      <svg viewBox="0 0 200 112" aria-hidden className="block w-full overflow-visible">
        <defs>
          <pattern
            id={id}
            width="9"
            height="9"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="9" height="9" className={FILL[tone]} />
            <rect width="3.5" height="9" style={{ fill: "hsl(var(--stripe))" }} />
          </pattern>
        </defs>
        <path d={track} fill="none" strokeWidth={18} strokeLinecap="round" className="stroke-muted" />
        {f > 0.005 ? (
          <path
            d={fill}
            fill="none"
            stroke={`url(#${id})`}
            strokeWidth={18}
            strokeLinecap="round"
          />
        ) : null}
        {m !== null ? (
          <line
            x1={point(m, R - 15).x}
            y1={point(m, R - 15).y}
            x2={point(m, R + 15).x}
            y2={point(m, R + 15).y}
            strokeWidth={3}
            strokeLinecap="round"
            className="stroke-foreground"
          />
        ) : null}
      </svg>
      {children ? (
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center text-center">
          {children}
        </div>
      ) : null}
    </div>
  );
}
