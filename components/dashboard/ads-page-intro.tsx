import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { InfoTip } from "@/components/dashboard/info-tip";
import {
  GLOSSARY,
  describeChange,
  type ChangeTone,
  type GlossaryKey,
} from "@/lib/dashboard/glossary";
import { CountUp } from "@/components/ui/count-up";
import type { DeltaTone } from "@/components/ui/pill";
import type { DashboardKpis, Kpi, TrendPoint } from "@/lib/dashboard/metrics";
import { cn, formatMoneyPLN, formatNumberPL, formatPercent } from "@/lib/utils";

type Lang = "pl" | "en";

// Below these previous-period bases a % change is noise (+300% on 4 clicks),
// so the tile says "not enough data" instead. Same cut-offs as KpiCards.
const MIN_PREV_CLICKS = 50;
// 100 zł in grosze.
const MIN_PREV_SPEND = 10_000;
// describeChange calls anything under this "about the same"; keep it grey.
const FLAT_THRESHOLD = 3;

// Tile labels are shorter than the glossary names ("Wydatki na reklamy"):
// the whole page is about ads, and two tiles share a phone row.
const TILE_LABEL: Record<Lang, Partial<Record<GlossaryKey, string>>> = {
  pl: { spend: "Wydatki", clicks: "Kliknięcia", cpc: "Koszt kliknięcia", ctr: "Klikalność" },
  en: { spend: "Spend", clicks: "Clicks", cpc: "Cost per click", ctr: "Click rate" },
};

// Always group thousands ("7 581 zł"): pl-PL Intl skips grouping for 4-digit
// numbers, which looks inconsistent next to 5-digit figures.
function wholePln(minorUnits: number): string {
  const n = Math.round(minorUnits / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${n} zł`;
}

/**
 * Judge the change by whether it is good news, not by its sign: a pricier
 * click is bad even though the number went up, and spend is never judged.
 */
function changeTone(kpi: Kpi, metric: GlossaryKey, thinBase: boolean): DeltaTone {
  const d = kpi.deltaPercent;
  const goodWhen = GLOSSARY[metric].goodWhen;
  if (thinBase || d === null || !Number.isFinite(d) || goodWhen === "neutral") return "flat";
  if (Math.abs(d) < FLAT_THRESHOLD) return "flat";
  const good = goodWhen === "lower" ? d < 0 : d > 0;
  return good ? "good" : "bad";
}

// Delta colour = the judgement (spend is a decision, never judged: ink).
const DELTA_TONE: Record<DeltaTone, string> = {
  good: "text-positive",
  bad: "text-negative",
  flat: "text-ink-2",
};

/** Sparkline path in a 200x40 box (Przeglad-pastel tile). */
function sparkPath(v: number[]): string | null {
  if (v.length < 2) return null;
  const mn = Math.min(...v);
  const mx = Math.max(...v);
  const span = mx - mn || 1;
  return v
    .map(
      (p, j) =>
        `${j ? "L" : "M"}${((j * 200) / (v.length - 1)).toFixed(1)} ${(mx === mn ? 20 : 37 - ((p - mn) / span) * 34).toFixed(1)}`
    )
    .join(" ");
}

/**
 * One 2026 KPI tile (Reklamy board `.kpi` in the pastel skin): mono label +
 * CPC/CTR tag + ⓘ, the judged delta on the right, a big light number that
 * counts up, a drawn sparkline and the change in words. Not a button: on
 * this page the chart below is fixed (cost per click), so a "selectable"
 * tile would promise something that doesn't happen.
 */
function Tile({
  metric,
  tone,
  value,
  kpi,
  hint,
  thinBase,
  series,
  lang,
  index,
}: {
  metric: GlossaryKey;
  tone: ChangeTone;
  /** Formatted headline, or "-" when there is nothing to show. */
  value: string;
  kpi: Kpi;
  /** Replaces the change sentence (no data yet, no clicks...). */
  hint?: string;
  thinBase: boolean;
  /** Daily values for the sparkline, oldest -> newest (decorative). */
  series?: number[];
  lang: Lang;
  index: number;
}) {
  const g = GLOSSARY[metric];
  const en = lang === "en";
  const tag = en ? (g.en.short ?? g.short) : g.short;
  const name = TILE_LABEL[lang][metric] ?? (en ? g.en.name : g.name);
  const change = hint ?? describeChange(kpi.deltaPercent, tone, { thinBase, lang });
  const d = kpi.deltaPercent;
  const moved =
    !hint && !thinBase && d !== null && Number.isFinite(d) && Math.abs(d) >= FLAT_THRESHOLD;
  const judged = changeTone(kpi, metric, thinBase);
  // The corner carries "↗ 16%", the line under the sparkline says what it
  // means ("więcej niż wcześniej"), so colour is never the only cue.
  const pct = moved ? `${Math.round(Math.abs(d!)).toLocaleString(en ? "en-GB" : "pl-PL")}%` : null;
  const words = pct ? change.replace(/^(o\s)?\d[\d\s.,]*%\s*/, "") : change;
  const unit = /^(.*?)\s?(zł)$/.exec(value);
  const spark = hint || value === "-" ? null : sparkPath(series ?? []);

  return (
    <div
      className="glass glass-blur relative flex min-w-0 flex-col gap-3 rounded-tile p-4 pb-[18px] transition-transform duration-500 [transition-timing-function:cubic-bezier(.34,1.56,.64,1)] focus-within:z-10 hover:z-10 animate-rise motion-safe:hover:-translate-y-[4px] sm:gap-4 sm:p-[22px] sm:pb-5"
      style={{ "--d": `${0.2 + index * 0.08}s` } as React.CSSProperties}
    >
      {/* Phones: room for a two-line label, so the numbers line up. */}
      <div className="flex min-h-[30px] items-start justify-between gap-2 sm:min-h-0 sm:items-center">
        <span className="flex min-w-0 items-center gap-1.5">
          {/* Phones: two tiles share a row, so a long label wraps instead
              of being cut to "KOSZT KL…". */}
          <span className="kick min-w-0 break-words text-[11px] leading-[1.35] tracking-[0.08em] sm:truncate sm:leading-4 xl:text-[11.5px] xl:tracking-[0.12em]">
            {name}
          </span>
          {/* The CTR/CPC tag people hear from platforms; no room on phones. */}
          {tag ? (
            <span className="hidden h-[18px] items-center rounded-full bg-chip px-1.5 font-mono text-[10px] tracking-[0.06em] text-ink-2 sm:inline-flex">
              {tag}
            </span>
          ) : null}
          <InfoTip label={tag ?? name} text={en ? g.en.explain : g.explain} lang={lang} className="shrink-0" />
        </span>
        {pct ? (
          <span
            aria-hidden
            className={cn(
              "hidden shrink-0 items-center gap-0.5 text-[13.5px] font-semibold tabular-nums sm:inline-flex",
              DELTA_TONE[judged]
            )}
          >
            {d! > 0 ? (
              <ArrowUpRight className="h-[13px] w-[13px]" strokeWidth={2.4} />
            ) : (
              <ArrowDownRight className="h-[13px] w-[13px]" strokeWidth={2.4} />
            )}
            {pct}
          </span>
        ) : null}
      </div>
      <p className="truncate text-[1.875rem] font-light leading-none tracking-[-0.05em] tabular-nums sm:text-[2.5rem] xl:text-[2.75rem]">
        {value === "-" ? (
          <span className="text-ink-3">-</span>
        ) : unit ? (
          <>
            <CountUp text={unit[1]} delayMs={200 + index * 80} />
            <small className="ml-[3px] text-[0.48em] tracking-[-0.02em]">{unit[2]}</small>
          </>
        ) : (
          <CountUp text={value} delayMs={200 + index * 80} />
        )}
      </p>
      {spark ? (
        <svg aria-hidden width="100%" height="40" viewBox="0 0 200 40" preserveAspectRatio="none" className="overflow-visible">
          <path
            d={spark}
            pathLength={1}
            fill="none"
            // Spend is never judged: it draws in the page's lime.
            stroke={
              metric === "spend" || judged === "good"
                ? "hsl(var(--lime-line))"
                : judged === "bad"
                  ? "hsl(var(--negative))"
                  : "var(--ink-3)"
            }
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="draw-path animate-draw"
            style={{ "--d": `${0.7 + index * 0.12}s` } as React.CSSProperties}
          />
        </svg>
      ) : null}
      <p className="text-[13px] leading-snug text-ink-3">
        {/* sm+: the corner figure is visual and screen readers get it here;
            phones have no room in the corner, so it leads the line. */}
        {pct ? (
          <span
            className={cn(
              "mr-1 inline-flex items-center gap-0.5 font-semibold tabular-nums sm:sr-only",
              DELTA_TONE[judged]
            )}
          >
            {d! > 0 ? (
              <ArrowUpRight className="h-3 w-3" strokeWidth={2.4} aria-hidden />
            ) : (
              <ArrowDownRight className="h-3 w-3" strokeWidth={2.4} aria-hidden />
            )}
            {pct}
          </span>
        ) : null}
        {words}
      </p>
    </div>
  );
}

/**
 * The four numbers that answer "where does the money go and what do we get":
 * spend, clicks, cost per click and click rate, each with its change vs the
 * previous period in words. Nothing else on the Reklamy page repeats them.
 */
export function AdsKpiTiles({
  kpis,
  trend,
  lang = "pl",
}: {
  kpis: DashboardKpis;
  /** The page's daily trend (already loaded) - feeds the tile sparklines. */
  trend?: TrendPoint[];
  lang?: Lang;
}) {
  const en = lang === "en";
  const days = trend ?? [];
  // Ratio days without a denominator have no value; skip, don't plot a 0.
  const series = {
    spend: days.map((p) => p.spendMinorUnits),
    clicks: days.map((p) => p.clicks),
    cpc: days.filter((p) => p.clicks > 0).map((p) => p.spendMinorUnits / p.clicks),
    ctr: days.filter((p) => p.impressions > 0).map((p) => (p.clicks / p.impressions) * 100),
  };
  const afterAds = en
    ? "Ad data appears after the first sync"
    : "Dane pojawią się po pierwszej synchronizacji";
  const noAds =
    kpis.spendMinorUnits.value === 0 &&
    kpis.spendMinorUnits.previous === 0 &&
    kpis.clicks.value === 0 &&
    kpis.clicks.previous === 0;
  const noSpend = kpis.spendMinorUnits.value === 0;
  const noClicks = kpis.clicks.value === 0;
  // CTR and CPC are ratios over clicks, so they inherit the clicks guard.
  const thinClicks = kpis.clicks.previous < MIN_PREV_CLICKS;

  const spendHint = noAds
    ? afterAds
    : noSpend
      ? en
        ? "no ad spend in this period"
        : "brak wydatków w tym okresie"
      : undefined;
  const clicksHint = noAds
    ? afterAds
    : noClicks
      ? en
        ? "no ad clicks in this period"
        : "brak kliknięć w tym okresie"
      : undefined;

  return (
    <section aria-label={en ? "Key numbers" : "Najważniejsze liczby"}>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Tile
          metric="spend"
          index={0}
          series={series.spend}
          tone="amount"
          // Whole złoty: grosze on a five-digit budget is noise.
          value={noAds ? "-" : wholePln(kpis.spendMinorUnits.value)}
          kpi={kpis.spendMinorUnits}
          hint={spendHint}
          thinBase={kpis.spendMinorUnits.previous < MIN_PREV_SPEND}
          lang={lang}
        />
        <Tile
          metric="clicks"
          index={1}
          series={series.clicks}
          tone="amount"
          value={noAds ? "-" : formatNumberPL(kpis.clicks.value)}
          kpi={kpis.clicks}
          hint={clicksHint}
          thinBase={thinClicks}
          lang={lang}
        />
        <Tile
          metric="cpc"
          index={2}
          series={series.cpc}
          tone="cost"
          // CPC keeps grosze: 1,47 zł vs 1,52 zł is the whole story here.
          value={noAds || noClicks ? "-" : formatMoneyPLN(Math.round(kpis.cpcMinorUnits.value))}
          kpi={kpis.cpcMinorUnits}
          hint={noAds ? afterAds : noClicks ? clicksHint : undefined}
          thinBase={thinClicks}
          lang={lang}
        />
        <Tile
          metric="ctr"
          index={3}
          series={series.ctr}
          tone="rate"
          value={noAds ? "-" : formatPercent(kpis.ctr.value)}
          kpi={kpis.ctr}
          hint={noAds ? afterAds : undefined}
          thinBase={thinClicks}
          lang={lang}
        />
      </div>
    </section>
  );
}

/**
 * Reklamy / Kreacje page opening (board `.hdr`, pastel skin): a mono kicker,
 * a big light title and one plain sentence, the page's period control on the
 * right, and the Kampanie | Kreacje tabs under it. One block, so it stays
 * the first presentation slide together with the tabs.
 */
export function AdsPageHeader({
  kicker,
  title,
  lead,
  actions,
  tabs,
}: {
  kicker?: React.ReactNode;
  title: React.ReactNode;
  lead?: React.ReactNode;
  /** Right-aligned controls (date range or the fixed period). */
  actions?: React.ReactNode;
  /** The <AdsSectionTabs>. */
  tabs?: React.ReactNode;
}) {
  return (
    <div className="space-y-6 animate-rise sm:space-y-7" style={{ "--d": ".05s" } as React.CSSProperties}>
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-5 pt-2 sm:pt-4">
        <div className="min-w-0">
          {kicker ? <p className="kick">{kicker}</p> : null}
          <h1 className="mt-2.5 text-[2.5rem] font-light leading-[1.02] tracking-[-0.05em] text-foreground sm:text-[3.25rem]">
            {title}
          </h1>
          {lead ? <p className="mt-2.5 max-w-2xl text-base leading-relaxed text-ink-2">{lead}</p> : null}
        </div>
        {actions ? (
          // min-w-0 lets the date segments scroll inside a phone screen
          // instead of widening the page.
          <div
            className="flex min-w-0 max-w-full shrink-0 flex-wrap items-center gap-2 [&>*]:min-w-0 [&>*]:max-w-full"
            data-print-hide
          >
            {actions}
          </div>
        ) : null}
      </header>
      {tabs}
    </div>
  );
}
