// Presentational primitives for the client report "deck" — a premium 16:9 slide
// layout for the monthly PDF. Fixed light/dark palette (not theme tokens) so the
// deliverable looks identical in light mode, terminal mode and the printed PDF.
import { cn } from "@/lib/utils";

// Cohesive chart palette (indigo brand + supporting hues).
export const DECK_COLORS = [
  "#6366f1", // indigo
  "#14b8a6", // teal
  "#f59e0b", // amber
  "#0ea5e9", // sky
  "#f43f5e", // rose
  "#94a3b8", // slate
];

/** One 16:9 slide. On screen a card; in print a full landscape page. */
export function Slide({
  children,
  className,
  dark,
}: {
  children: React.ReactNode;
  className?: string;
  dark?: boolean;
}) {
  return (
    <div
      className={cn(
        "deck-slide relative mx-auto flex aspect-[16/9] w-full max-w-5xl flex-col overflow-hidden rounded-2xl shadow-lg",
        dark
          ? "bg-slate-900 text-white"
          : "border border-slate-200 bg-white text-slate-900",
        className
      )}
    >
      {children}
    </div>
  );
}

/** Branded cover slide (dark gradient, big title, period). */
export function CoverSlide({
  title,
  eyebrow,
  period,
}: {
  title: string;
  eyebrow?: string;
  period: string;
}) {
  return (
    <Slide dark className="justify-between p-12">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 120% at 100% 0%, rgba(99,102,241,0.45) 0%, rgba(15,23,42,0) 55%)",
        }}
      />
      <div className="relative flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-indigo-300">
        <span className="inline-block h-2 w-2 rounded-full bg-indigo-400" />
        Pato Agencja
      </div>
      <div className="relative">
        {eyebrow ? (
          <p className="mb-2 text-sm font-medium uppercase tracking-wider text-indigo-300">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-6xl font-bold leading-none tracking-tight">{title}</h1>
        <div className="mt-6 h-1 w-24 rounded-full bg-indigo-400" />
        <p className="mt-4 text-lg text-slate-300">{period}</p>
      </div>
      <div className="relative text-sm text-slate-400">
        Raport wyników kampanii online
      </div>
    </Slide>
  );
}

/** Centered section-divider slide (dark, accent line). */
export function DividerSlide({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <Slide dark className="items-center justify-center p-12 text-center">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(100% 100% at 0% 100%, rgba(20,184,166,0.28) 0%, rgba(15,23,42,0) 55%)",
        }}
      />
      <div className="relative">
        <div className="mx-auto mb-5 h-1 w-16 rounded-full bg-indigo-400" />
        <h2 className="text-5xl font-bold tracking-tight">{title}</h2>
        {subtitle ? <p className="mt-3 text-lg text-slate-300">{subtitle}</p> : null}
      </div>
    </Slide>
  );
}

/** Content slide: section eyebrow, title, body, footer (client · period · #). */
export function ContentSlide({
  title,
  subtitle,
  section,
  foot,
  children,
}: {
  title: string;
  subtitle?: string;
  section?: string;
  foot?: string;
  children: React.ReactNode;
}) {
  return (
    <Slide className="p-10">
      <div className="mb-5 shrink-0">
        {section ? (
          <p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-indigo-500">
            <span className="inline-block h-3 w-1 rounded-full bg-indigo-500" />
            {section}
          </p>
        ) : null}
        <h3 className="text-3xl font-bold tracking-tight">{title}</h3>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
      {foot ? (
        <div className="mt-4 flex shrink-0 items-center justify-between border-t border-slate-100 pt-3 text-[11px] text-slate-400">
          <span>{foot}</span>
          <span className="slide-pageno" />
        </div>
      ) : null}
    </Slide>
  );
}

/** Coloured delta pill with arrow. */
function DeltaPill({ text, tone }: { text: string; tone: "up" | "down" | "flat" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold",
        tone === "up" && "bg-emerald-50 text-emerald-600",
        tone === "down" && "bg-red-50 text-red-600",
        tone === "flat" && "bg-slate-100 text-slate-500"
      )}
    >
      {tone === "up" ? "▲" : tone === "down" ? "▼" : "→"} {text}
    </span>
  );
}

/** A large stat block with an accent bar and delta pill. */
export function Stat({
  label,
  value,
  sub,
  tone = "flat",
  accent = DECK_COLORS[0],
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down" | "flat";
  accent?: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <span
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: accent }}
      />
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1.5 text-[26px] font-bold leading-none tabular-nums tracking-tight">
        {value}
      </p>
      {sub ? (
        <div className="mt-2">
          <DeltaPill text={sub} tone={tone} />
        </div>
      ) : null}
    </div>
  );
}

/** Horizontal bar list — thick rounded bars with a category dot + value. */
export function BarList({
  items,
}: {
  items: Array<{ label: string; value: number; display: string; color?: string }>;
}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="space-y-4">
      {items.map((it, idx) => {
        const color = it.color ?? DECK_COLORS[idx % DECK_COLORS.length];
        return (
          <div key={it.label} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-slate-600">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: color }}
                />
                <span className="truncate" title={it.label}>
                  {it.label}
                </span>
              </span>
              <span className="font-semibold tabular-nums">{it.display}</span>
            </div>
            <span className="block h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.max((it.value / max) * 100, 2)}%`,
                  background: color,
                }}
              />
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Donut chart with legend and a centre total. */
export function Donut({
  items,
  centerLabel,
  centerValue,
}: {
  items: Array<{ label: string; value: number; display: string; color?: string }>;
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const r = 60;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex h-full items-center gap-8">
      <svg viewBox="0 0 160 160" className="h-44 w-44 shrink-0">
        <g transform="rotate(-90 80 80)">
          <circle cx="80" cy="80" r={r} fill="none" stroke="#f1f5f9" strokeWidth="20" />
          {items.map((it, idx) => {
            const frac = it.value / total;
            const dash = frac * circ;
            const el = (
              <circle
                key={it.label}
                cx="80"
                cy="80"
                r={r}
                fill="none"
                stroke={it.color ?? DECK_COLORS[idx % DECK_COLORS.length]}
                strokeWidth="20"
                strokeDasharray={`${dash} ${circ - dash}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return el;
          })}
        </g>
        {centerValue ? (
          <text
            x="80"
            y="76"
            textAnchor="middle"
            className="fill-slate-900"
            style={{ fontSize: 22, fontWeight: 700 }}
          >
            {centerValue}
          </text>
        ) : null}
        {centerLabel ? (
          <text
            x="80"
            y="96"
            textAnchor="middle"
            className="fill-slate-400"
            style={{ fontSize: 10 }}
          >
            {centerLabel}
          </text>
        ) : null}
      </svg>
      <div className="min-w-0 flex-1 space-y-3">
        {items.map((it, idx) => (
          <div key={it.label} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-slate-600">
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{ background: it.color ?? DECK_COLORS[idx % DECK_COLORS.length] }}
              />
              {it.label}
            </span>
            <span className="font-semibold tabular-nums">{it.display}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Shared axis grid for the line charts.
function grid(w: number, h: number) {
  return [0.25, 0.5, 0.75].map((f) => (
    <line
      key={f}
      x1={0}
      x2={w}
      y1={h * f}
      y2={h * f}
      stroke="#f1f5f9"
      strokeWidth={1}
    />
  ));
}

/** Single-series area chart with gradient fill and gridlines. */
export function LineChart({
  values,
  color = DECK_COLORS[0],
}: {
  values: number[];
  color?: string;
}) {
  const w = 640;
  const h = 220;
  if (values.length === 0)
    return <p className="text-sm text-slate-400">Brak danych.</p>;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const n = values.length;
  const gid = `g-${color.replace("#", "")}`;
  const pts = values.map((v, i) => {
    const x = n > 1 ? (i / (n - 1)) * w : w / 2;
    const y = h - ((v - min) / range) * (h - 12) - 6;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = pts.join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-full w-full">
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {grid(w, h)}
      <polygon points={`0,${h} ${line} ${w},${h}`} fill={`url(#${gid})`} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Two-series line chart (each normalised) with gridlines. */
export function DualLineChart({
  a,
  b,
}: {
  a: { values: number[]; color?: string };
  b: { values: number[]; color?: string };
}) {
  const w = 640;
  const h = 220;
  const path = (values: number[]) => {
    if (values.length === 0) return "";
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;
    const n = values.length;
    return values
      .map((v, i) => {
        const x = n > 1 ? (i / (n - 1)) * w : w / 2;
        const y = h - ((v - min) / range) * (h - 12) - 6;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  };
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-full w-full">
      {grid(w, h)}
      <polyline
        points={path(a.values)}
        fill="none"
        stroke={a.color ?? DECK_COLORS[0]}
        strokeWidth={2.5}
        vectorEffect="non-scaling-stroke"
      />
      <polyline
        points={path(b.values)}
        fill="none"
        stroke={b.color ?? DECK_COLORS[1]}
        strokeWidth={2.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
