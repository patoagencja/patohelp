import { InfoTip } from "@/components/dashboard/info-tip";
import {
  GLOSSARY,
  describeChange,
  type ChangeTone,
  type GlossaryKey,
} from "@/lib/dashboard/glossary";
import { MetricTile } from "@/components/dashboard/metric-tile";
import { DeltaPill, type DeltaTone } from "@/components/ui/pill";
import type { SparklineTone } from "@/components/ui/sparkline";
import type { DashboardKpis, Kpi, TrendPoint } from "@/lib/dashboard/metrics";
import { formatMoneyPLN, formatNumberPL, formatPercent } from "@/lib/utils";

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

// Sparkline colour = the delta's judgement; spend (never judged) draws in
// the "this period" green so the row doesn't read as four grey squiggles.
const SPARK_TONE: Record<DeltaTone, SparklineTone> = {
  good: "positive",
  bad: "negative",
  flat: "neutral",
};

function Tile({
  metric,
  tone,
  value,
  kpi,
  hint,
  thinBase,
  series,
  lang,
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
}) {
  const g = GLOSSARY[metric];
  const en = lang === "en";
  const tag = en ? (g.en.short ?? g.short) : g.short;
  const change = hint ?? describeChange(kpi.deltaPercent, tone, { thinBase, lang });
  const d = kpi.deltaPercent;
  const moved =
    !hint && !thinBase && d !== null && Number.isFinite(d) && Math.abs(d) >= FLAT_THRESHOLD;
  const judged = changeTone(kpi, metric, thinBase);
  // The pill carries "16%", the words after it say what that means
  // ("więcej niż wcześniej"), so colour is never the only cue.
  const pct = moved ? `${Math.round(Math.abs(d!)).toLocaleString(en ? "en-GB" : "pl-PL")}%` : null;
  const words = pct ? change.replace(/^(o\s)?\d[\d\s.,]*%\s*/, "") : change;

  return (
    <MetricTile
      label={
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium leading-5 text-muted-foreground">
            {TILE_LABEL[lang][metric] ?? (en ? g.en.name : g.name)}
          </span>
          {/* The CTR/CPC tag people hear from platforms; no room on phones. */}
          {tag ? (
            <span
              data-caps
              className="hidden rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:inline"
            >
              {tag}
            </span>
          ) : null}
          <InfoTip
            label={tag ?? (en ? g.en.name : g.name)}
            text={en ? g.en.explain : g.explain}
            lang={lang}
            className="shrink-0"
          />
        </span>
      }
      value={value}
      delta={
        pct ? (
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] leading-snug text-muted-foreground">
            <DeltaPill tone={judged} direction={d! > 0 ? "up" : "down"}>
              {pct}
            </DeltaPill>
            <span>{words}</span>
          </p>
        ) : (
          <p className="text-[13px] leading-snug text-muted-foreground">{change}</p>
        )
      }
      sparkline={hint || value === "-" ? undefined : series}
      sparkTone={metric === "spend" ? "accent" : SPARK_TONE[judged]}
    />
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
