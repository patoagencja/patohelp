import { InfoTip } from "@/components/dashboard/info-tip";
import {
  GLOSSARY,
  describeChange,
  type ChangeTone,
  type GlossaryKey,
} from "@/lib/dashboard/glossary";
import type { DashboardKpis, Kpi } from "@/lib/dashboard/metrics";
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
 * Colour the change by whether it is good news, not by its sign: a pricier
 * click is red even though the number went up, and spend is never judged.
 */
function changeTone(kpi: Kpi, metric: GlossaryKey, thinBase: boolean): string {
  const d = kpi.deltaPercent;
  const goodWhen = GLOSSARY[metric].goodWhen;
  if (thinBase || d === null || !Number.isFinite(d) || goodWhen === "neutral") {
    return "text-muted-foreground";
  }
  if (Math.abs(d) < FLAT_THRESHOLD) return "text-muted-foreground";
  const good = goodWhen === "lower" ? d < 0 : d > 0;
  return good
    ? "text-emerald-700 dark:text-emerald-400"
    : "text-red-700 dark:text-red-400";
}

function Tile({
  metric,
  tone,
  value,
  kpi,
  hint,
  thinBase,
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
  lang: Lang;
}) {
  const g = GLOSSARY[metric];
  const en = lang === "en";
  const tag = en ? (g.en.short ?? g.short) : g.short;
  const change = hint ?? describeChange(kpi.deltaPercent, tone, { thinBase, lang });
  const d = kpi.deltaPercent;
  const arrow =
    hint || thinBase || d === null || !Number.isFinite(d) || Math.abs(d) < FLAT_THRESHOLD
      ? null
      : d > 0
        ? "▲"
        : "▼";

  return (
    // z-index lift keeps an open ⓘ bubble above the neighbouring tiles.
    <div className="surface relative flex min-w-0 flex-col gap-2 p-4 focus-within:z-10 hover:z-10 sm:p-5">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-sm font-medium text-foreground">
          {TILE_LABEL[lang][metric] ?? (en ? g.en.name : g.name)}
        </span>
        {/* The CTR/CPC tag people hear from platforms; no room on phones. */}
        {tag ? (
          <span className="hidden rounded bg-muted px-1.5 py-px text-[11px] font-medium text-muted-foreground sm:inline">
            {tag}
          </span>
        ) : null}
        <InfoTip label={tag ?? (en ? g.en.name : g.name)} text={en ? g.en.explain : g.explain} lang={lang} />
      </div>
      <p className="truncate text-2xl font-semibold tabular-nums tracking-tight text-foreground sm:text-metric">
        {value}
      </p>
      <p
        className={cn(
          "text-sm leading-snug",
          hint ? "text-muted-foreground" : changeTone(kpi, metric, thinBase)
        )}
      >
        {arrow ? (
          <span aria-hidden className="mr-1 text-[0.7em]">
            {arrow}
          </span>
        ) : null}
        {change}
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
  lang = "pl",
}: {
  kpis: DashboardKpis;
  lang?: Lang;
}) {
  const en = lang === "en";
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
          tone="amount"
          value={noAds ? "-" : formatNumberPL(kpis.clicks.value)}
          kpi={kpis.clicks}
          hint={clicksHint}
          thinBase={thinClicks}
          lang={lang}
        />
        <Tile
          metric="cpc"
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
