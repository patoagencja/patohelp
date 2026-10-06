import Link from "next/link";
import { Check } from "lucide-react";

import { CountUp } from "@/components/ui/count-up";
import { Ping, type PingTone } from "@/components/ui/primitives";
import type { FlightMetric } from "@/lib/alerts/pacing";
import type { GoalTile, GoalTileStatus } from "@/lib/dashboard/campaign-goals";
import { plPlural } from "@/lib/dashboard/story";
import { cn } from "@/lib/utils";

/**
 * "Cele kampanii · na teraz": the running campaign / ad set goals as glass
 * KPI tiles (same family as the overview's tiles), shown at the top of
 * Alerty and under the overview's KPI row. Each tile answers "how far, where
 * should we be today, what does it take from here" and links to the goal's
 * card on Alerty. Server-safe; renders nothing when no goal is running.
 */

const METRIC_LABEL: Record<FlightMetric, string> = {
  clicks: "Kliknięcia linku",
  clicks_all: "Wszystkie kliknięcia",
  impressions: "Wyświetlenia",
  spend: "Wydatki",
  conversions: "Działania na stronie",
};

const STATUS: Record<
  GoalTileStatus,
  { label: string; tone: PingTone; fill: string; line: string }
> = {
  on_track: { label: "w planie", tone: "lime", fill: "share-fill", line: "stroke-[hsl(var(--lime-line))]" },
  behind: { label: "poniżej tempa", tone: "amber", fill: "share-fill-warn", line: "stroke-amber" },
  at_risk: { label: "zagrożony", tone: "coral", fill: "share-fill-bad", line: "stroke-coral" },
  done: { label: "cel osiągnięty", tone: "lime", fill: "share-fill", line: "stroke-[hsl(var(--lime-line))]" },
  ended: { label: "zakończony", tone: "muted", fill: "bg-chart-muted", line: "stroke-[var(--ink-3)]" },
};

// Non-breaking group separator: "10 215" must never wrap mid-number.
const group = (n: number) =>
  Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");

/** Tile-sized figure: "312", "12 400", "312 tys.", "1,2 mln" (spend: whole zł). */
function figure(metric: FlightMetric, v: number): string {
  const n = metric === "spend" ? v / 100 : v;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".", ",").replace(/,0$/, "")} mln`;
  if (n >= 100_000) return `${group(n / 1000)} tys.`;
  return group(n);
}

/** Per-day pace: "412", "140 zł" (the tile names the metric); tiny counts keep a decimal. */
function perDay(metric: FlightMetric, v: number, up = false): string {
  const n = metric === "spend" ? v / 100 : v;
  const r = up ? Math.ceil(n) : Math.round(n);
  if (r === 0 && n > 0) return `${n.toFixed(1).replace(".", ",")}${metric === "spend" ? " zł" : ""}`;
  return metric === "spend" ? `${group(r)} zł` : group(r);
}

/** "2026-10-20" -> "20.10". */
const shortDate = (iso: string) => `${Number(iso.slice(8, 10))}.${iso.slice(5, 7)}`;

function kicker(g: GoalTile): string {
  const level = !g.adsetName
    ? "Cel kampanii"
    : g.provider === "google_ads"
      ? "Grupa reklam"
      : "Zestaw reklam";
  return `${level} · do ${shortDate(g.endDate)}`;
}

function secondary(g: GoalTile): string {
  if (g.adsetName) return `kampania ${g.campaignName}`;
  const where = g.provider === "google_ads" ? "Google Ads" : g.provider === "meta_ads" ? "Meta" : null;
  return where ? `${where} · cała kampania` : "cała kampania";
}

/** Cumulative delivery vs the ideal straight line, in a 200x44 box. */
function Spark({ g }: { g: GoalTile }) {
  const W = 200;
  const H = 44;
  const top = 4;
  const last = g.cumulative[g.cumulative.length - 1] ?? 0;
  const max = Math.max(g.target, last, 1);
  const y = (v: number) => H - 2 - (v / max) * (H - 2 - top);
  const x = (day: number) => (day / g.totalDays) * W;
  const ideal = `M0 ${y(0).toFixed(1)} L${W} ${y(g.target).toFixed(1)}`;
  const pts = [`M0 ${y(0).toFixed(1)}`, ...g.cumulative.map((v, i) => `L${x(i + 1).toFixed(1)} ${y(v).toFixed(1)}`)];
  const meta = STATUS[g.status];
  return (
    <svg
      aria-hidden
      width="100%"
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="pointer-events-none relative overflow-visible"
    >
      <path
        d={ideal}
        fill="none"
        stroke="var(--prev)"
        strokeWidth={1.5}
        strokeDasharray="4 4"
        vectorEffect="non-scaling-stroke"
      />
      {g.cumulative.length > 0 ? (
        <path
          d={pts.join(" ")}
          pathLength={1}
          fill="none"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          className={cn("draw-path animate-draw", meta.line)}
          style={{ "--d": ".9s" } as React.CSSProperties}
        />
      ) : null}
    </svg>
  );
}

function StatusBadge({ status }: { status: GoalTileStatus }) {
  const meta = STATUS[status];
  return (
    <span className="inline-flex min-h-8 items-center gap-2 rounded-full bg-chip py-0.5 pl-2.5 pr-3 text-[13px] font-medium text-foreground">
      {status === "done" ? (
        <span aria-hidden className="grid h-4 w-4 place-items-center rounded-full bg-lime text-lime-foreground">
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      ) : (
        <Ping tone={meta.tone} still={status === "ended"} />
      )}
      {meta.label}
    </span>
  );
}

const OVERLAY =
  "absolute inset-0 z-[1] rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function Tile({ g, href, index }: { g: GoalTile; href: string; index: number }) {
  const meta = STATUS[g.status];
  const title = g.adsetName ?? g.campaignName;
  const running = g.daysRemaining > 0;
  const pct = Math.min(g.realizedPct * 100, 100);
  const plan = g.expectedPct * 100;
  const showMarker = running && g.status !== "done";
  const unit = g.metric === "spend" ? " zł" : "";

  const right = running
    ? `zostało ${g.daysRemaining} ${plPlural(g.daysRemaining, "dzień", "dni", "dni")}`
    : `koniec ${shortDate(g.endDate)}`;
  const footer =
    g.status === "done"
      ? g.achievedOn
        ? `osiągnięty ${shortDate(g.achievedOn)} · ${Math.round(g.realizedPct * 100)}% celu`
        : `${Math.round(g.realizedPct * 100)}% celu`
      : g.status === "ended"
        ? `zrealizowano ${Math.round(g.realizedPct * 100)}% celu`
        : g.neededPerDay !== null
          ? `potrzeba ok. ${perDay(g.metric, g.neededPerDay, true)} dziennie (dotąd ${perDay(g.metric, g.avgPerDay)})`
          : null;
  const summary = `${title}: ${figure(g.metric, g.realized)}${unit} z ${figure(g.metric, g.target)}${unit}, ${METRIC_LABEL[g.metric].toLowerCase()}, ${meta.label}`;

  return (
    <article
      role="listitem"
      className="glass glass-blur relative flex w-[16.5rem] shrink-0 snap-start flex-col gap-3.5 rounded-tile p-5 pb-[18px] transition-[transform,box-shadow] duration-500 [transition-timing-function:cubic-bezier(.34,1.56,.64,1)] focus-within:z-10 hover:z-10 animate-rise motion-safe:hover:-translate-y-[5px] sm:w-auto sm:p-[22px] sm:pb-5"
      style={{ "--d": `${0.3 + index * 0.08}s` } as React.CSSProperties}
    >
      {/* The whole tile opens the goal's card on Alerty. Same-page anchors
          stay plain <a>: only a real fragment navigation sets :target, which
          rings the card (Next's Link uses pushState). */}
      {href.startsWith("#") ? (
        <a href={href} aria-label={`${summary}. Pokaż szczegóły celu`} className={OVERLAY} />
      ) : (
        <Link href={href} aria-label={`${summary}. Pokaż szczegóły celu`} className={OVERLAY} />
      )}
      <div className="pointer-events-none relative min-w-0">
        <p className="kick truncate text-[11px] tracking-[0.08em] tabular-nums xl:tracking-[0.12em]">{kicker(g)}</p>
        <h3 className="mt-2 truncate text-[15px] font-medium leading-snug tracking-[-0.01em]" title={title}>
          {title}
        </h3>
        <p className="truncate text-[13px] text-ink-3" title={secondary(g)}>
          {secondary(g)}
        </p>
      </div>

      <div className="pointer-events-none relative">
        <p className="text-[13px] text-ink-2">{METRIC_LABEL[g.metric]}</p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 leading-none tabular-nums">
          <span className="text-[2.25rem] font-light tracking-[-0.055em] sm:text-[2.5rem]">
            <CountUp text={figure(g.metric, g.realized)} delayMs={250 + index * 80} />
          </span>
          <span className="text-[15px] text-ink-3">
            / {figure(g.metric, g.target)}
            {unit}
          </span>
        </p>
      </div>

      {/* Realized fill + a dark tick where the linear plan says we should be today. */}
      <div
        role="img"
        aria-label={`Zrealizowano ${Math.round(g.realizedPct * 100)}% celu${showMarker ? `, tu powinniśmy być dziś: ${Math.round(plan)}%` : ""}`}
        className="pointer-events-none relative h-2.5 w-full rounded-full bg-chip"
      >
        <span
          className={cn("block h-full origin-left rounded-full animate-grow", meta.fill)}
          style={{ width: `${Math.max(pct, 1)}%`, "--d": ".6s" } as React.CSSProperties}
        />
        {showMarker ? (
          <span
            aria-hidden
            className="absolute -top-[5px] h-5 w-[3px] -translate-x-1/2 rounded-full bg-foreground ring-2 ring-background/60"
            style={{ left: `${Math.min(Math.max(plan, 1.5), 98.5)}%` }}
          />
        ) : null}
      </div>

      <div className="pointer-events-none relative flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <StatusBadge status={g.status} />
        <span className="text-[13px] text-ink-3 tabular-nums">{right}</span>
      </div>

      <Spark g={g} />

      {footer ? (
        <p className="pointer-events-none relative -mt-1 text-[13px] leading-snug text-ink-3 tabular-nums">{footer}</p>
      ) : null}
    </article>
  );
}

export function GoalTiles({
  goals,
  baseHref = "",
  className,
}: {
  goals: GoalTile[];
  /** "" on Alerty (in-page anchors), "/<slug>/alerty" elsewhere. */
  baseHref?: string;
  className?: string;
}) {
  if (goals.length === 0) return null;
  return (
    <section aria-labelledby="cele-teraz" className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 id="cele-teraz" className="kick">
          Cele kampanii · na teraz
        </h2>
        <p className="flex items-center gap-2 text-xs text-ink-3">
          <span aria-hidden className="h-3.5 w-[3px] rounded-full bg-foreground" />
          kreska = tu powinniśmy być dziś
          <span aria-hidden className="ml-2 w-4 border-t-[1.5px] border-dashed border-prev" />
          równe tempo
        </p>
      </div>
      {/* Phones: a swipeable carousel (like the KPI tiles); sm+: a grid. */}
      <div
        role="list"
        aria-label="Cele kampanii"
        className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 pt-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:snap-none sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4 print:mx-0 print:grid print:grid-cols-2 print:overflow-visible print:px-0"
      >
        {goals.map((g, i) => (
          <Tile key={g.id} g={g} index={i} href={`${baseHref}#cel-${g.id}`} />
        ))}
      </div>
    </section>
  );
}
