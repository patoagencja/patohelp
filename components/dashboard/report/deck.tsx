// Presentational primitives for the client report "deck" - a premium 16:9 slide
// layout for the monthly PDF. 2026 pastel skin: content slides are glass
// cards with mono kickers and light-weight numbers; the cover and dividers
// are a small dark "stage" (the presentation look: dark canvas, pastel
// glows, grain) in both themes - they carry `.dark`, so the tokens inside
// re-point locally. The printed PDF is always the light palette:
// globals.css re-points every token (also under .dark) in @media print.
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

const GRID = "var(--line)";
const TRACK = "var(--chip)";
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
        "deck-slide relative mx-auto flex aspect-[16/9] w-full max-w-5xl flex-col overflow-hidden rounded-glass",
        dark
          ? "dark bg-background text-foreground shadow-raised"
          : "glass text-card-foreground",
        className
      )}
    >
      {children}
    </div>
  );
}

/** The dark stage behind the cover and dividers: pastel glows + grain. */
function Stage({ variant = "cover" }: { variant?: "cover" | "divider" }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 print:hidden">
      <span
        className={cn(
          "absolute rounded-full bg-lime/30 blur-[90px]",
          variant === "cover" ? "-left-[12%] -top-[40%] h-[90%] w-[60%]" : "-bottom-[45%] -left-[10%] h-[90%] w-[55%]"
        )}
      />
      <span className="absolute -right-[12%] -top-[30%] h-[80%] w-[45%] rounded-full bg-coral/20 blur-[90px]" />
      <span className="absolute -bottom-[50%] left-[38%] h-[85%] w-[50%] rounded-full bg-violet/25 blur-[90px]" />
      <span className="absolute inset-0 bg-[radial-gradient(var(--dots)_1px,transparent_1.3px)] bg-[length:26px_26px] [mask-image:radial-gradient(80%_80%_at_50%_40%,black,transparent)]" />
    </div>
  );
}

/** Branded cover slide (dark stage, giant light title, period, client logo/monogram). */
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
      <Stage />
      <div className="relative flex items-center justify-between">
        <div className="kick flex items-center gap-2.5 !text-[13px] !text-ink-2">
          <span className="ping ping-lime ping-still" aria-hidden />
          patoagencja
        </div>
        {logo ? (
          <span className="flex h-10 items-center text-foreground">{logo}</span>
        ) : monogram ? (
          <span className="glass flex h-12 w-12 items-center justify-center !rounded-2xl font-mono text-sm font-medium tracking-[0.08em] text-foreground">
            {monogram}
          </span>
        ) : null}
      </div>
      <div className="relative">
        {eyebrow ? <p className="kick mb-4 !text-[13px]">{eyebrow}</p> : null}
        <h1 className="num-grad text-[88px] font-light leading-[0.92] tracking-[-0.055em]">{title}</h1>
        <p className="mt-6 inline-flex items-center gap-3 font-mono text-[15px] tracking-[0.04em] text-ink-2">
          <span aria-hidden className="h-[3px] w-12 rounded-full bg-lime shadow-lime-glow" />
          {period}
        </p>
      </div>
      <div className="relative text-sm text-ink-3">Raport wyników kampanii online</div>
    </Slide>
  );
}

/** Centered section-divider slide (dark stage, light title). */
export function DividerSlide({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <Slide dark className="items-center justify-center p-12 text-center">
      <Stage variant="divider" />
      <div className="relative">
        <p className="kick mb-5 inline-flex items-center gap-2.5 !text-[13px]">
          <span className="ping ping-lime ping-still" aria-hidden />
          Sekcja
        </p>
        <h2 className="num-grad text-[64px] font-light leading-none tracking-[-0.05em]">{title}</h2>
        {subtitle ? (
          <p className="mt-5 font-mono text-[15px] tracking-[0.04em] text-ink-2">{subtitle}</p>
        ) : null}
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
          <p className="kick mb-2 flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-lime" aria-hidden />
            {section}
          </p>
        ) : null}
        <h3 className="text-[30px] font-medium leading-tight tracking-[-0.035em]">{title}</h3>
        {subtitle ? <p className="mt-1 text-sm text-ink-3">{subtitle}</p> : null}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
      {foot ? (
        <div className="mt-4 flex shrink-0 items-center justify-between border-t border-line pt-3 font-mono text-[11px] tracking-[0.04em] text-ink-3">
          <span>{foot}</span>
          <span className="slide-pageno" />
        </div>
      ) : null}
    </Slide>
  );
}

/** Delta pill: colour says good/bad (`tone`), the arrow follows the sign of
 *  the number - a cheaper click is "-6,9%" with a down arrow, in green. */
function DeltaPill({ text, tone }: { text: string; tone: "up" | "down" | "flat" }) {
  const arrow = /^[-\u2212]/.test(text) ? "▼" : /^\+/.test(text) ? "▲" : "→";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
        tone === "up" && "bg-positive-soft text-positive",
        tone === "down" && "bg-negative-soft text-negative",
        tone === "flat" && "bg-chip text-ink-2"
      )}
    >
      <span aria-hidden>{arrow}</span> {text}
    </span>
  );
}

/** A large stat block: dot + label, big number, delta pill at the bottom
 *  (same anatomy as the dashboard's KPI tiles). */
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
    <div className="flex min-w-0 flex-col rounded-[22px] bg-chip p-5">
      <p className="kick flex items-center gap-2 !text-[11px]">
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ background: accent }}
        />
        <span className="truncate">{label}</span>
      </p>
      <p className="mt-3 text-[36px] font-light leading-none tabular-nums tracking-[-0.045em]">
        {value}
      </p>
      {sub ? (
        <div className="mt-auto pt-3">
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
              <span className="flex min-w-0 items-center gap-2 text-ink-2">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: color }}
                />
                <span className="truncate" title={it.label}>
                  {it.label}
                </span>
              </span>
              <span className="font-medium tabular-nums">{it.display}</span>
            </div>
            <span className="block h-2.5 w-full overflow-hidden rounded-full bg-chip">
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
            <span className="text-xl font-light leading-tight tracking-[-0.03em] text-foreground">
              {centerValue}
            </span>
          ) : null}
          {centerLabel ? (
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">
              {centerLabel}
            </span>
          ) : null}
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        {items.map((it, idx) => (
          <div key={it.label} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-ink-2">
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ background: it.color ?? DECK_COLORS[idx % DECK_COLORS.length] }}
              />
              {it.label}
            </span>
            <span className="font-medium tabular-nums">{it.display}</span>
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
          className="flex flex-col overflow-hidden rounded-[22px] bg-chip"
        >
          <div className="aspect-square w-full bg-chip">
            {c.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={c.thumbnailUrl}
                alt={c.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-ink-3">
                brak podglądu
              </div>
            )}
          </div>
          <div className="flex flex-col gap-0.5 p-3">
            <span className="truncate text-xs font-medium" title={c.name}>
              {c.name}
            </span>
            <span className="text-xs text-ink-3">
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
