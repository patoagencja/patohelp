// Presentational primitives for the client report "deck" — a 16:9 slide layout
// that mirrors the agency's monthly Google-Slides PDF. Deliberately uses a
// fixed light palette (not theme tokens) so the deliverable looks identical in
// light mode, terminal/dark mode and in the printed PDF.
import { cn } from "@/lib/utils";

// Teal/orange to echo the reference deck's chart palette.
export const DECK_COLORS = ["#0e7490", "#ea7317", "#3b82f6", "#14b8a6", "#94a3b8"];

/** One 16:9 slide. On screen it's a card; in print it becomes a full page. */
export function Slide({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "deck-slide relative mx-auto flex aspect-[16/9] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-10 text-slate-900 shadow-sm",
        className
      )}
    >
      {children}
    </div>
  );
}

/** Centered section-divider slide (title + period), like the reference deck. */
export function DividerSlide({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <Slide className="items-center justify-center text-center">
      <h2 className="text-5xl font-semibold tracking-tight">{title}</h2>
      {subtitle ? <p className="mt-3 text-lg text-slate-500">{subtitle}</p> : null}
    </Slide>
  );
}

/** Content slide: big top-left title, optional subtitle, then body. */
export function ContentSlide({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Slide>
      <div className="mb-6 shrink-0">
        <h3 className="text-3xl font-semibold tracking-tight">{title}</h3>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </Slide>
  );
}

/** A large stat block (value + label + optional delta/sub). */
export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down" | "flat";
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight">{value}</p>
      {sub ? (
        <p
          className={cn(
            "mt-0.5 text-sm font-medium",
            tone === "up" && "text-emerald-600",
            tone === "down" && "text-red-600",
            (!tone || tone === "flat") && "text-slate-500"
          )}
        >
          {sub}
        </p>
      ) : null}
    </div>
  );
}

/** Horizontal bar list — used for traffic sources, devices, platform split. */
export function BarList({
  items,
}: {
  items: Array<{ label: string; value: number; display: string; color?: string }>;
}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="space-y-3">
      {items.map((it, idx) => (
        <div key={it.label} className="flex items-center gap-3 text-sm">
          <span className="w-32 shrink-0 truncate text-slate-600" title={it.label}>
            {it.label}
          </span>
          <span className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${Math.max((it.value / max) * 100, 2)}%`,
                background: it.color ?? DECK_COLORS[idx % DECK_COLORS.length],
              }}
            />
          </span>
          <span className="w-28 shrink-0 text-right font-medium tabular-nums">
            {it.display}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Simple SVG line chart (single series) for trends. */
export function LineChart({
  values,
  color = DECK_COLORS[0],
  height = 200,
}: {
  values: number[];
  color?: string;
  height?: number;
}) {
  const w = 640;
  const h = height;
  if (values.length === 0) {
    return <p className="text-sm text-slate-400">Brak danych.</p>;
  }
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const n = values.length;
  const pts = values.map((v, i) => {
    const x = n > 1 ? (i / (n - 1)) * w : w / 2;
    const y = h - ((v - min) / range) * (h - 8) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = pts.join(" ");
  const area = `0,${h} ${line} ${w},${h}`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="h-full w-full"
      aria-hidden
    >
      <polygon points={area} fill={color} opacity={0.1} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Two-series overlay line chart (e.g. spend vs sessions), each normalised. */
export function DualLineChart({
  a,
  b,
  height = 220,
}: {
  a: { values: number[]; color?: string };
  b: { values: number[]; color?: string };
  height?: number;
}) {
  const w = 640;
  const h = height;
  const path = (values: number[]) => {
    if (values.length === 0) return "";
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;
    const n = values.length;
    return values
      .map((v, i) => {
        const x = n > 1 ? (i / (n - 1)) * w : w / 2;
        const y = h - ((v - min) / range) * (h - 8) - 4;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  };
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="h-full w-full"
      aria-hidden
    >
      <polyline
        points={path(a.values)}
        fill="none"
        stroke={a.color ?? DECK_COLORS[0]}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
      <polyline
        points={path(b.values)}
        fill="none"
        stroke={b.color ?? DECK_COLORS[1]}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
