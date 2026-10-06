// Presentational primitives for the client report "deck" - a premium 16:9 slide
// layout for the monthly PDF. v2 skin: slides are theme surfaces (white card /
// lifted charcoal in dark), cover and dividers use the near-black anchor, and
// charts use the earthy --chart-* palette. The printed PDF is always the light
// palette: globals.css re-points every token under @media print.
import { cn } from "@/lib/utils";

// CSS colour strings (not classes) because the charts below paint SVG strokes
// and inline bar fills. Same order as everywhere else: chart-1 is "the" series.
export const DECK_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--chart-6))",
];

const GRID = "hsl(var(--border))";
const TRACK = "hsl(var(--muted))";
const AXIS = "hsl(var(--muted-foreground))";

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
        "deck-slide relative mx-auto flex aspect-[16/9] w-full max-w-5xl flex-col overflow-hidden rounded-card shadow-raised",
        dark
          ? "bg-anchor text-anchor-foreground"
          : "border border-hairline bg-card text-card-foreground",
        className
      )}
    >
      {children}
    </div>
  );
}

/** Branded cover slide (dark gradient, big title, period, client logo/monogram). */
export function CoverSlide({
  title,
  eyebrow,
  period,
  monogram,
  logo,
}: {
  title: string;
  eyebrow?: string;
  period: string;
  monogram?: string;
  logo?: React.ReactNode;
}) {
  return (
    <Slide dark className="justify-between p-12">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 120% at 100% 0%, hsl(var(--lime) / 0.38) 0%, transparent 55%), radial-gradient(80% 90% at 70% 0%, hsl(var(--olive) / 0.22) 0%, transparent 60%)",
        }}
      />
      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-anchor-foreground/75">
          <span className="inline-block h-2 w-2 rounded-full bg-anchor-dot" />
          patoagencja
        </div>
        {logo ? (
          <span className="flex h-10 items-center text-anchor-foreground">{logo}</span>
        ) : monogram ? (
          <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-anchor-foreground/15 bg-anchor-foreground/10 text-sm font-bold tracking-wide text-anchor-foreground">
            {monogram}
          </span>
        ) : null}
      </div>
      <div className="relative">
        {eyebrow ? (
          <p className="mb-2 text-sm font-medium uppercase tracking-wider text-anchor-foreground/75">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-6xl font-bold leading-none tracking-tight">{title}</h1>
        <div className="mt-6 h-1.5 w-24 rounded-full bg-anchor-dot" />
        <p className="mt-4 text-lg text-anchor-foreground/80">{period}</p>
      </div>
      <div className="relative text-sm text-anchor-foreground/65">
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
            "radial-gradient(100% 100% at 0% 100%, hsl(var(--lime) / 0.28) 0%, transparent 55%)",
        }}
      />
      <div className="relative">
        <div className="mx-auto mb-5 h-1.5 w-16 rounded-full bg-anchor-dot" />
        <h2 className="text-5xl font-bold tracking-tight">{title}</h2>
        {subtitle ? <p className="mt-3 text-lg text-anchor-foreground/80">{subtitle}</p> : null}
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
          <p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            <span className="inline-block h-2 w-2 rounded-full bg-lime" />
            {section}
          </p>
        ) : null}
        <h3 className="text-3xl font-bold tracking-tight">{title}</h3>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
      {foot ? (
        <div className="mt-4 flex shrink-0 items-center justify-between border-t border-border pt-3 text-[11px] text-muted-foreground">
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
        tone === "up" && "bg-positive-soft text-positive",
        tone === "down" && "bg-negative-soft text-negative",
        tone === "flat" && "bg-muted text-muted-foreground"
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
    <div className="relative overflow-hidden rounded-2xl bg-muted/60 p-5">
      <span
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: accent }}
      />
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-[28px] font-medium leading-none tabular-nums tracking-[-0.03em]">
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

/** Horizontal bar list - thick rounded bars with a category dot + value. */
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
              <span className="flex items-center gap-2 text-muted-foreground">
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
            <span className="block h-3 w-full overflow-hidden rounded-full bg-muted">
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
  const r = 62;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex h-full items-center gap-8">
      <div className="relative h-44 w-44 shrink-0">
        <svg viewBox="0 0 160 160" className="h-full w-full">
          <g transform="rotate(-90 80 80)">
            <circle cx="80" cy="80" r={r} fill="none" style={{ stroke: TRACK }} strokeWidth="16" />
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
                  style={{ stroke: it.color ?? DECK_COLORS[idx % DECK_COLORS.length] }}
                  strokeWidth="16"
                  strokeDasharray={`${dash} ${circ - dash}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += dash;
              return el;
            })}
          </g>
        </svg>
        {/* Centre label as HTML so it never overflows the ring hole. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          {centerValue ? (
            <span className="text-lg font-semibold leading-tight tracking-tight text-foreground">
              {centerValue}
            </span>
          ) : null}
          {centerLabel ? (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {centerLabel}
            </span>
          ) : null}
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        {items.map((it, idx) => (
          <div key={it.label} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-muted-foreground">
              <span
                className="inline-block h-3 w-3 rounded-full"
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

/** Grid of top creatives with thumbnails for the report deck. */
export function CreativesGrid({
  items,
}: {
  items: Array<{
    name: string;
    thumbnailUrl: string | null;
    spendDisplay: string;
    ctrDisplay: string;
  }>;
}) {
  return (
    <div className="grid h-full grid-cols-4 gap-4">
      {items.map((c, i) => (
        <div
          key={i}
          className="flex flex-col overflow-hidden rounded-2xl bg-muted/60"
        >
          <div className="aspect-square w-full bg-muted">
            {c.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={c.thumbnailUrl}
                alt={c.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                brak podglądu
              </div>
            )}
          </div>
          <div className="flex flex-col gap-0.5 p-3">
            <span className="truncate text-xs font-medium" title={c.name}>
              {c.name}
            </span>
            <span className="text-xs text-muted-foreground">
              {c.spendDisplay} · CTR {c.ctrDisplay}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// Vertical axis tick column (max → min), rendered as HTML so text isn't
// distorted by the stretched SVG plot. Aligns with the plot's gridlines.
function TickCol({
  min,
  max,
  format,
  color = AXIS,
  align = "right",
}: {
  min: number;
  max: number;
  format: (n: number) => string;
  color?: string;
  align?: "left" | "right";
}) {
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max - f * (max - min));
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col justify-between py-[2px] text-[10px] tabular-nums",
        align === "right" ? "items-start" : "items-end"
      )}
      style={{ color }}
    >
      {ticks.map((t, i) => (
        <span key={i}>{format(t)}</span>
      ))}
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
      style={{ stroke: GRID }}
      strokeWidth={1}
      strokeDasharray="3 4"
      vectorEffect="non-scaling-stroke"
    />
  ));
}

/** Single-series area chart with gradient fill, gridlines and a right axis. */
export function LineChart({
  values,
  color = DECK_COLORS[0],
  format,
}: {
  values: number[];
  color?: string;
  format?: (n: number) => string;
}) {
  const w = 640;
  const h = 220;
  if (values.length === 0)
    return <p className="text-sm text-muted-foreground">Brak danych.</p>;
  const max = Math.max(...values);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const n = values.length;
  // Colours are CSS strings like "hsl(var(--chart-1))": keep only id-safe chars.
  const gid = `g-${color.replace(/[^a-z0-9]/gi, "")}`;
  const pts = values.map((v, i) => {
    const x = n > 1 ? (i / (n - 1)) * w : w / 2;
    const y = h - ((v - min) / range) * (h - 12) - 6;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = pts.join(" ");
  const svg = (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-full w-full">
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.28 }} />
          <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      {grid(w, h)}
      <polygon points={`0,${h} ${line} ${w},${h}`} fill={`url(#${gid})`} />
      <polyline
        points={line}
        fill="none"
        style={{ stroke: color }}
        strokeWidth={2.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
  if (!format) return svg;
  return (
    <div className="flex h-full gap-2">
      <div className="min-w-0 flex-1">{svg}</div>
      <TickCol min={min} max={max} format={format} color={color} align="right" />
    </div>
  );
}

/**
 * Two-series line chart with independent left/right axes (e.g. spend vs
 * sessions). Each series is scaled to its own [min,max] and gets a labelled
 * axis on its side, so both are readable despite different units.
 */
export function DualLineChart({
  a,
  b,
}: {
  a: { values: number[]; color?: string; format?: (n: number) => string };
  b: { values: number[]; color?: string; format?: (n: number) => string };
}) {
  const w = 640;
  const h = 220;
  const aColor = a.color ?? DECK_COLORS[0];
  const bColor = b.color ?? DECK_COLORS[1];
  const bounds = (values: number[]) => {
    const max = Math.max(...values, 0);
    const min = Math.min(...values, 0);
    return { min, max, range: max - min || 1 };
  };
  const ab = bounds(a.values);
  const bb = bounds(b.values);
  const path = (values: number[], bnd: { min: number; range: number }) => {
    if (values.length === 0) return "";
    const n = values.length;
    return values
      .map((v, i) => {
        const x = n > 1 ? (i / (n - 1)) * w : w / 2;
        const y = h - ((v - bnd.min) / bnd.range) * (h - 12) - 6;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  };
  return (
    <div className="flex h-full gap-2">
      {a.format ? (
        <TickCol min={ab.min} max={ab.max} format={a.format} color={aColor} align="left" />
      ) : null}
      <div className="min-w-0 flex-1">
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-full w-full">
          {grid(w, h)}
          <polyline
            points={path(a.values, ab)}
            fill="none"
            style={{ stroke: aColor }}
            strokeWidth={2.5}
            vectorEffect="non-scaling-stroke"
          />
          <polyline
            points={path(b.values, bb)}
            fill="none"
            style={{ stroke: bColor }}
            strokeWidth={2.5}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      {b.format ? (
        <TickCol min={bb.min} max={bb.max} format={b.format} color={bColor} align="right" />
      ) : null}
    </div>
  );
}
