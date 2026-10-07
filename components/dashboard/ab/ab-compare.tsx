"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { Check, LineChart, X } from "lucide-react";

import { CreativeThumb } from "@/components/dashboard/creatives/creative-thumb";
import { monotonePath, niceStep } from "@/components/dashboard/trend-line-chart";
import { useModalFocus } from "@/components/dashboard/use-modal-focus";
import { SegmentedTrack, segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import type { AbAd } from "@/lib/ab/types";
import { cn } from "@/lib/utils";

import {
  VERDICT,
  adsWord,
  fmtCount,
  fmtCpa,
  fmtMoney,
  fmtProb,
  fmtRate,
  fmtRoas,
  formatOf,
  setShort,
} from "./ab-meta";
import { KindChip } from "./kind-chip";

// Up to four ads, told apart by line style rather than four hues (the
// dashboard's one-accent rule): lime solid, ink solid, dashed, dotted. The
// same sample sits under each column's thumbnail, so the legend is the table.
const SERIES: Array<{ stroke: string; width: number; dash?: string; glow?: boolean }> = [
  { stroke: "hsl(var(--lime-line))", width: 2.8, glow: true },
  { stroke: "var(--ink)", width: 2 },
  { stroke: "var(--ink-3)", width: 2, dash: "7 5" },
  { stroke: "var(--ink-2)", width: 2.8, dash: "0.1 6" },
];

function Swatch({ index, className }: { index: number; className?: string }) {
  const s = SERIES[index];
  return (
    <svg aria-hidden width="30" height="10" viewBox="0 0 30 10" className={cn("shrink-0 overflow-visible", className)}>
      <line
        x1="2"
        x2="28"
        y1="5"
        y2="5"
        stroke={s.stroke}
        strokeWidth={s.width}
        strokeDasharray={s.dash}
        strokeLinecap="round"
      />
    </svg>
  );
}

type Better = "higher" | "lower" | null;

interface Row {
  label: string;
  value: (a: AbAd) => number | null;
  fmt: (v: number | null) => string;
  better: Better;
  /** Built on purchases: a too-early ad's figure is noise, never "best". */
  purchaseBased?: boolean;
}

const money = (v: number | null) => (v == null ? "-" : fmtMoney(v));
const oneDecimal = (v: number | null) =>
  v == null ? "-" : v.toLocaleString("pl-PL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Indices holding the best value of a row (ties all win; all equal = none). */
function bestOf(ads: AbAd[], row: Row): Set<number> {
  if (!row.better) return new Set();
  const vals = ads
    .map((a, i) => ({ i, v: row.value(a) }))
    .filter(
      (x): x is { i: number; v: number } =>
        x.v != null && Number.isFinite(x.v) && !(row.purchaseBased && ads[x.i].verdict.kind === "too_early")
    );
  if (vals.length < 2) return new Set();
  const pick = row.better === "higher" ? Math.max : Math.min;
  const best = pick(...vals.map((x) => x.v));
  const winners = vals.filter((x) => Math.abs(x.v - best) <= Math.abs(best) * 1e-9);
  return winners.length === vals.length ? new Set() : new Set(winners.map((x) => x.i));
}

type Mode = "roas" | "purchases";

const MODE_LABEL: Record<Mode, string> = {
  roas: "Zwrot narastająco",
  purchases: "Zakupy dziennie",
};

const ddmm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/**
 * The window day by day for the compared ads: cumulative return (sales so
 * far / spend so far - settles as data builds up, so a lucky first day
 * doesn't dominate) or plain daily purchases. Hand-built SVG in the
 * TrendLineChart idiom: hairline guides, mono labels, crosshair + glass
 * tooltip; arrows step days when focused.
 */
function CompareChart({ ads, mode }: { ads: AbAd[]; mode: Mode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [active, setActive] = useState<number | null>(null);

  const dates = useMemo(
    () => Array.from(new Set(ads.flatMap((a) => a.daily.map((d) => d.date)))).sort(),
    [ads]
  );
  const plottable = dates.length >= 2;

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [plottable]);
  // null until the ad has spent anything: no line before it existed.
  const series = useMemo(
    () =>
      ads.map((a) => {
        const byDate = new Map(a.daily.map((d) => [d.date, d]));
        let spend = 0;
        let value = 0;
        return dates.map((date) => {
          const d = byDate.get(date);
          spend += d?.spend ?? 0;
          value += d?.value ?? 0;
          if (spend === 0) return null;
          return mode === "roas" ? value / spend : d?.purchases ?? 0;
        });
      }),
    [ads, dates, mode]
  );

  const fmt = (v: number) => (mode === "roas" ? fmtRoas(v) : fmtCount(v));
  const fmtAxis = (v: number) =>
    mode === "roas" ? `${v.toLocaleString("pl-PL", { maximumFractionDigits: 1 })}×` : fmtCount(v);

  const { ticks, top } = useMemo(() => {
    const max = Math.max(0, ...series.flat().filter((v): v is number => v != null));
    const step = niceStep((max || 1) / 4);
    const t = Math.max(step, Math.ceil((max * 1.06) / step) * step);
    const out: number[] = [];
    for (let v = 0; v <= t + step / 2; v += step) out.push(v);
    return { ticks: out, top: t };
  }, [series]);

  const n = dates.length;
  if (!plottable) {
    return (
      <p className="flex items-center gap-3 rounded-[20px] bg-chip px-4 py-4 text-sm text-ink-2">
        <LineChart className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
        Wykres pokazuje kolejne dni - wybierz okno dłuższe niż jeden dzień.
      </p>
    );
  }

  const { w: width, h: H } = size;
  const longest = Math.max(...ticks.map((v) => fmtAxis(v).length));
  const pad = { top: 12, right: 12, bottom: 26, left: Math.round(longest * 6.7 + 14) };
  const plotW = Math.max(1, width - pad.left - pad.right);
  const plotH = Math.max(1, H - pad.top - pad.bottom);
  const x = (i: number) => pad.left + (i * plotW) / (n - 1);
  const y = (v: number) => pad.top + plotH * (1 - v / top);
  // Every few days, always ending on the window's last day; the regular
  // label just before it steps aside when the two would collide.
  const labelStep = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 58))));
  const labels: number[] = [];
  for (let i = 0; i < n; i += labelStep) labels.push(i);
  if (labels[labels.length - 1] !== n - 1) {
    if (labels.length > 1 && n - 1 - labels[labels.length - 1] < labelStep / 2) labels.pop();
    labels.push(n - 1);
  }

  // Each series as runs of known days (a gap before the ad started).
  const paths = series.map((vals) => {
    const runs: Array<Array<{ x: number; y: number }>> = [];
    let run: Array<{ x: number; y: number }> = [];
    vals.forEach((v, i) => {
      if (v == null) {
        if (run.length) runs.push(run);
        run = [];
      } else run.push({ x: x(i), y: y(v) });
    });
    if (run.length) runs.push(run);
    return runs;
  });

  const pick = (clientX: number, rect: DOMRect) => {
    const rel = (clientX - rect.left - pad.left) / plotW;
    setActive(Math.min(n - 1, Math.max(0, Math.round(rel * (n - 1)))));
  };
  const onPointer = (e: PointerEvent<SVGRectElement>) => {
    const svg = e.currentTarget.ownerSVGElement;
    if (svg) pick(e.clientX, svg.getBoundingClientRect());
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const cur = active ?? n - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = active === null ? n - 1 : Math.min(n - 1, cur + 1);
    else if (e.key === "ArrowLeft") next = active === null ? n - 1 : Math.max(0, cur - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    if (next !== null) {
      e.preventDefault();
      setActive(next);
    }
  };

  const lastOf = (vals: Array<number | null>) => [...vals].reverse().find((v) => v != null) ?? null;
  const summary = `${MODE_LABEL[mode]} na koniec okna: ${ads
    .map((a, i) => {
      const last = lastOf(series[i]);
      return `${a.adName} ${last == null ? "brak danych" : fmt(last)}`;
    })
    .join(", ")}.`;

  const ax = active !== null ? x(active) : 0;
  const tipLeft = width > 0 && ax / width > 0.55;
  // The tooltip goes into the emptier band (above the highest line or below
  // the lowest at that day), so it never covers the lines being read.
  let tipTop = 4;
  if (active !== null) {
    const ys = series.map((s) => s[active]).filter((v): v is number => v != null).map(y);
    const tipH = 36 + 25 * ads.length;
    if (ys.length) {
      const hi = Math.min(...ys);
      const lo = Math.max(...ys);
      tipTop =
        hi - pad.top >= pad.top + plotH - lo
          ? Math.max(0, hi - tipH - 12)
          : Math.min(Math.max(0, H - tipH), lo + 12);
    }
  }

  return (
    <div ref={boxRef} className="relative h-60 w-full cursor-crosshair sm:h-72">
      {width > 0 && H > 0 ? (
        <svg
          width={width}
          height={H}
          role="img"
          aria-label={summary}
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
          className="block touch-pan-y select-none overflow-visible outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
        >
          {ticks.map((v) => (
            <g key={v}>
              <line x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
              <text
                x={pad.left - 10}
                y={y(v)}
                dy="0.32em"
                textAnchor="end"
                className="fill-[var(--ink-3)] font-mono text-[11px] tabular-nums"
              >
                {fmtAxis(v)}
              </text>
            </g>
          ))}
          {labels.map((i) => (
            <text
              key={dates[i]}
              x={x(i)}
              y={H - 6}
              textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
              className={cn(
                "font-mono text-[11px] tabular-nums",
                active === i ? "fill-foreground" : "fill-[var(--ink-3)]"
              )}
            >
              {ddmm(dates[i])}
            </text>
          ))}

          {active !== null ? (
            <line
              x1={ax}
              x2={ax}
              y1={pad.top}
              y2={pad.top + plotH}
              stroke="var(--ink-3)"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
          ) : null}

          {/* Drawn back to front so the lime line stays on top. */}
          {paths
            .map((runs, si) => ({ runs, si }))
            .reverse()
            .map(({ runs, si }) => {
              const s = SERIES[si];
              return (
                <g key={si}>
                  {runs.map((run, ri) =>
                    run.length === 1 ? (
                      <circle key={ri} cx={run[0].x} cy={run[0].y} r={3} fill={s.stroke} />
                    ) : (
                      <path
                        key={ri}
                        d={monotonePath(run)}
                        fill="none"
                        stroke={s.stroke}
                        strokeWidth={s.width}
                        strokeDasharray={s.dash}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="animate-fade"
                        style={
                          {
                            "--d": `${0.15 + si * 0.12}s`,
                            filter: s.glow ? "drop-shadow(0 4px 10px var(--lime-glow))" : undefined,
                          } as CSSProperties
                        }
                      />
                    )
                  )}
                  {active !== null && series[si][active] != null ? (
                    <circle
                      cx={ax}
                      cy={y(series[si][active]!)}
                      r={4.5}
                      fill={s.stroke}
                      className="stroke-background"
                      strokeWidth={2}
                    />
                  ) : null}
                </g>
              );
            })}

          <rect
            x={0}
            y={0}
            width={width}
            height={H}
            fill="transparent"
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse") setActive(null);
            }}
          />
        </svg>
      ) : null}

      {active !== null && width > 0 ? (
        <div
          aria-hidden
          className="glass-tip pointer-events-none absolute z-10 flex max-w-[15rem] flex-col gap-1.5 rounded-[16px] px-3.5 py-3 text-[12.5px] print:hidden"
          style={{
            left: ax,
            top: tipTop,
            transform: tipLeft ? "translateX(calc(-100% - 14px))" : "translateX(14px)",
          }}
        >
          <span className="font-mono text-[11px] tracking-[0.08em] text-ink-3">{ddmm(dates[active])}</span>
          {ads.map((a, i) => (
            <span key={a.adId} className="flex min-w-0 items-center gap-2">
              <Swatch index={i} />
              <span className="min-w-0 flex-1 truncate text-ink-2">{a.adName}</span>
              <b className="shrink-0 font-semibold tabular-nums">
                {series[i][active] == null ? "-" : fmt(series[i][active]!)}
              </b>
            </span>
          ))}
        </div>
      ) : null}

      <p className="sr-only" aria-live="polite">
        {active !== null
          ? `${ddmm(dates[active])}: ${ads
              .map((a, i) => `${a.adName} ${series[i][active] == null ? "brak danych" : fmt(series[i][active]!)}`)
              .join(", ")}`
          : ""}
      </p>
    </div>
  );
}

/**
 * Side by side comparison of 2-4 ads: a column per ad (thumbnail, the line
 * style it has in the chart, verdict) and one row per number, the best
 * value of each judged row marked. A modal sheet - full screen on phones -
 * with a focus trap; Escape or the backdrop closes it.
 */
export function AbCompare({
  ads,
  windowLabel,
  onClose,
  onRemove,
}: {
  ads: AbAd[];
  windowLabel: string;
  onClose: () => void;
  onRemove: (adId: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [mode, setMode] = useState<Mode>("roas");
  useModalFocus(panelRef, true, onClose);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const sameSet = ads.every((a) => a.adsetId === ads[0].adsetId);
  const rows: Row[] = useMemo(() => {
    const list: Row[] = [
      {
        label: sameSet ? "Szansa, że najlepsza w zestawie" : "Szansa, że najlepsza (każda w swoim zestawie)",
        value: (a) => a.probBest,
        fmt: fmtProb,
        // Across ad sets the chances answer different questions.
        better: sameSet ? "higher" : null,
      },
      { label: "Wydatki", value: (a) => a.totals.spend, fmt: money, better: null },
      { label: "Sprzedaż z reklamy", value: (a) => a.totals.value, fmt: money, better: null },
      { label: "Zakupy", value: (a) => a.totals.purchases, fmt: (v) => (v == null ? "-" : fmtCount(v)), better: null },
      { label: "Koszt zakupu", value: (a) => a.rates.cpa, fmt: fmtCpa, better: "lower", purchaseBased: true },
      { label: "Zwrot z reklam", value: (a) => a.rates.roas, fmt: fmtRoas, better: "higher", purchaseBased: true },
      {
        label: "Zakupy na 100 kliknięć",
        value: (a) => (a.rates.cvr == null ? null : a.rates.cvr * 100),
        fmt: oneDecimal,
        better: "higher",
        purchaseBased: true,
      },
      { label: "Klikalność", value: (a) => a.rates.ctr, fmt: (v) => fmtRate(v), better: "higher" },
      { label: "Ile razy 1 osoba ją widziała", value: (a) => a.totals.frequency, fmt: oneDecimal, better: null },
    ];
    if (ads.some((a) => a.rates.hookRate != null)) {
      list.push({
        label: "Obejrzało 3 s filmu",
        value: (a) => a.rates.hookRate,
        fmt: (v) => fmtRate(v, 0),
        better: "higher",
      });
    }
    return list;
  }, [ads, sameSet]);

  const cols = { "--n": ads.length } as CSSProperties;
  const grid =
    "grid gap-x-2 sm:gap-x-4 [grid-template-columns:repeat(var(--n),minmax(0,1fr))] sm:[grid-template-columns:12rem_repeat(var(--n),minmax(0,1fr))]";

  return (
    <div
      className="fixed inset-0 z-50 !m-0 flex items-stretch justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-6 print:hidden"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="relative flex h-full w-full flex-col overflow-hidden bg-background shadow-raised animate-in fade-in slide-in-from-bottom-6 motion-reduce:animate-none sm:h-auto sm:max-h-[92vh] sm:max-w-5xl sm:rounded-glass"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 pb-4 pt-[calc(1rem+env(safe-area-inset-top))] sm:px-7 sm:pt-5">
          <div className="min-w-0">
            <p className="kick">Porównanie · {windowLabel.toLowerCase()}</p>
            <h2 id={titleId} className="mt-1.5 text-[20px] font-medium tracking-[-0.02em] sm:text-[22px]">
              {ads.length} {adsWord(ads.length)} obok siebie
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij porównanie"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-chip transition-[background-color,transform] hover:bg-[var(--chip-hover)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:active:scale-100"
          >
            <X className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </header>

        <div className="flex-1 space-y-8 overflow-y-auto px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-5 sm:px-7 sm:pb-7 sm:pt-6">
          <div role="table" aria-label="Porównanie liczb" style={cols}>
            <div role="row" className={cn(grid, "items-start pb-4")}>
              <span role="columnheader" className="hidden text-[13px] leading-snug text-ink-3 sm:block">
                Najlepsza wartość w wierszu ma znaczek{" "}
                <span className="inline-flex items-center gap-1 rounded-full bg-lime-soft px-1.5 font-medium text-foreground">
                  <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                  tak
                </span>
                . Wydatków nie oceniamy - to decyzja, nie wynik.
              </span>
              {ads.map((a, i) => (
                <div role="columnheader" key={a.adId} className="min-w-0 space-y-2">
                  <CreativeThumb
                    src={a.thumbnailUrl}
                    name={a.adName}
                    format={formatOf(a)}
                    compact
                    className="aspect-[4/5] h-auto w-full rounded-[16px] sm:aspect-auto sm:h-32"
                  />
                  <Swatch index={i} />
                  <p className="line-clamp-3 break-words text-[13.5px] font-medium leading-snug sm:text-[14.5px]">
                    {a.adName}
                  </p>
                  <p className="break-words text-[12px] leading-snug text-ink-3">{setShort(a.adsetName, a.market)}</p>
                  <button
                    type="button"
                    onClick={() => onRemove(a.adId)}
                    className="-ml-2 inline-flex min-h-9 items-center gap-1 rounded-full px-2 text-[12.5px] font-medium text-ink-3 hover:bg-chip hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                    Usuń<span className="sr-only"> z porównania: {a.adName}</span>
                  </button>
                </div>
              ))}
            </div>

            <div role="row" className={cn(grid, "gap-y-1.5 border-t border-line py-3")}>
              <span role="rowheader" className="col-span-full text-[12px] text-ink-3 sm:col-span-1 sm:self-center sm:text-[13.5px] sm:text-ink-2">
                Werdykt
              </span>
              {ads.map((a) => (
                <div role="cell" key={a.adId} className="min-w-0">
                  {/* A quarter of a phone is ~85px: "Za wcześnie" needs the
                      tighter chip there. */}
                  <KindChip
                    meta={VERDICT[a.verdict.kind]}
                    size="sm"
                    className="max-w-full px-2 text-[11.5px] sm:px-2.5 sm:text-[12px]"
                  />
                </div>
              ))}
            </div>

            {rows.map((row) => {
              const best = bestOf(ads, row);
              return (
                <div role="row" key={row.label} className={cn(grid, "gap-y-1.5 border-t border-line py-3")}>
                  <span
                    role="rowheader"
                    className="col-span-full text-[12px] text-ink-3 sm:col-span-1 sm:self-center sm:text-[13.5px] sm:text-ink-2"
                  >
                    {row.label}
                  </span>
                  {ads.map((a, i) => {
                    const v = row.value(a);
                    const isBest = best.has(i);
                    const noisy = row.purchaseBased && a.verdict.kind === "too_early" && v != null;
                    return (
                      <div role="cell" key={a.adId} className="min-w-0">
                        <span
                          className={cn(
                            "inline-flex max-w-full items-center gap-1 rounded-[10px] text-[14.5px] tabular-nums sm:text-[15.5px]",
                            isBest
                              ? "bg-lime-soft px-2 py-0.5 font-semibold text-foreground"
                              : "py-0.5 font-medium",
                            noisy && "text-ink-3"
                          )}
                        >
                          {isBest ? <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={3} aria-hidden /> : null}
                          <span className="truncate">{row.fmt(v)}</span>
                          {isBest ? <span className="sr-only"> (najlepsza)</span> : null}
                        </span>
                        {noisy ? <span className="block text-[11px] text-ink-3">mało zakupów</span> : null}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <section aria-label="Dzień po dniu" className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-[17px] font-medium tracking-[-0.015em]">Dzień po dniu</h3>
                <p className="mt-0.5 text-[13px] text-ink-3">
                  {mode === "roas"
                    ? "Sprzedaż od początku okna podzielona przez wydatki - im wyżej, tym lepiej."
                    : "Ile zakupów przyniosła każda reklama danego dnia."}
                </p>
              </div>
              <SegmentedTrack
                role="group"
                aria-label="Co pokazać na wykresie"
                className={cn(segmentedTrack, "min-w-0")}
              >
                {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={mode === m}
                    onClick={() => setMode(m)}
                    className={segmentedItem(mode === m, "min-h-11 px-3.5")}
                  >
                    {MODE_LABEL[m]}
                  </button>
                ))}
              </SegmentedTrack>
            </div>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-ink-2">
              {ads.map((a, i) => (
                <li key={a.adId} className="flex min-w-0 items-center gap-2">
                  <Swatch index={i} />
                  <span className="truncate">{a.adName}</span>
                  <span className="shrink-0 text-ink-3">({setShort(a.adsetName, a.market)})</span>
                </li>
              ))}
            </ul>
            <CompareChart ads={ads} mode={mode} />
          </section>
        </div>
      </div>
    </div>
  );
}
