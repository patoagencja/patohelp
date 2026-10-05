"use client";

import { useEffect, useRef, useState } from "react";
import { BadgeDelta, Card, Flex, Grid, SparkAreaChart, Text } from "@tremor/react";

import { AnimatedNumber } from "@/components/dashboard/animated-number";
import { MetricLabel } from "@/components/dashboard/info-tip";
import {
  GLOSSARY,
  describeChange,
  type ChangeTone,
  type GlossaryKey,
  type GoodWhen,
} from "@/lib/dashboard/glossary";
import type { DashboardKpis, Kpi, TrendPoint } from "@/lib/dashboard/metrics";
import {
  cn,
  formatMoneyPLN,
  formatNumberPL,
  formatPercent,
  formatPlnWhole,
} from "@/lib/utils";

// Same cut-off as the sentence ("podobnie jak wcześniej"), so the badge and
// the text under the number never tell two different stories.
const FLAT_THRESHOLD = 3;

// Tremor picks the arrow from deltaType and the colour from deltaType +
// isIncreasePositive, so a pricier click shows an UP arrow in RED. Neutral
// metrics (spend) and tiny moves get a gray badge - direction without verdict.
function deltaBadge(kpi: Kpi, goodWhen: GoodWhen) {
  if (kpi.deltaPercent === null || !Number.isFinite(kpi.deltaPercent)) return null;
  const rounded = Math.round(kpi.deltaPercent * 10) / 10;
  const deltaType = rounded > 0 ? "increase" : rounded < 0 ? "decrease" : "unchanged";
  const muted = goodWhen === "neutral" || Math.abs(rounded) < FLAT_THRESHOLD;
  return {
    deltaType,
    isIncreasePositive: goodWhen !== "lower",
    className: muted
      ? "bg-slate-50 text-slate-600 ring-slate-500 dark:text-slate-300"
      : undefined,
    label: `${rounded > 0 ? "+" : ""}${formatPercent(rounded, 1)}`,
  };
}

// Sparkline colour mirrors the delta judgement: green = good move, red = bad,
// indigo for neutral (spend). Keeps the whole card reading as one signal.
function sparkColor(kpi: Kpi, goodWhen: GoodWhen) {
  if (goodWhen === "neutral" || kpi.deltaPercent === null) return "indigo";
  const good = goodWhen === "higher" ? kpi.deltaPercent >= 0 : kpi.deltaPercent <= 0;
  return good ? "emerald" : "red";
}

function KpiCard({
  metric,
  tone,
  value,
  format,
  kpi,
  series,
  hint,
  thinBase = false,
  lang,
}: {
  metric: GlossaryKey;
  tone: ChangeTone;
  value: number;
  format: (n: number) => string;
  kpi: Kpi;
  series: number[];
  hint?: string;
  /** Previous period too small for a meaningful % - hide it. */
  thinBase?: boolean;
  lang: "pl" | "en";
}) {
  const g = GLOSSARY[metric];
  const en = lang === "en";
  const delta = hint || thinBase ? null : deltaBadge(kpi, g.goodWhen);
  // No baseline means the leading zeros are "before we had data", not real
  // zero days; drawn, they make day 1 of a new client look like a rocket.
  const firstNonZero = series.findIndex((v) => v > 0);
  const trimmed =
    kpi.previous === 0 && firstNonZero > 0 ? series.slice(firstNonZero) : series;
  const hasSpark = !hint && trimmed.length >= 2 && trimmed.some((v) => v > 0);
  const data = trimmed.map((v, i) => ({ i, v }));
  const subtitle = hint ?? describeChange(kpi.deltaPercent, tone, { thinBase, lang });

  // Flash the whole card green/red when the value changes (e.g. auto-refresh).
  const prevRef = useRef(value);
  const [cardFlash, setCardFlash] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (prevRef.current === value) return;
    setCardFlash(value > prevRef.current ? "up" : "down");
    prevRef.current = value;
    const t = setTimeout(() => setCardFlash(null), 700);
    return () => clearTimeout(t);
  }, [value]);

  return (
    <Card
      className={cn(
        // z-index lift keeps an open ⓘ bubble above the neighbouring cards.
        "group transition-all duration-200 focus-within:z-10 hover:z-10 hover:-translate-y-0.5 hover:shadow-md hover:ring-1 hover:ring-primary/20",
        cardFlash === "up" && "ring-2 ring-emerald-500/60",
        cardFlash === "down" && "ring-2 ring-red-500/60"
      )}
    >
      <Flex justifyContent="between" alignItems="start" className="gap-2">
        <MetricLabel
          name={en ? g.en.name : g.name}
          tag={en ? (g.en.short ?? g.short) : g.short}
          explain={en ? g.en.explain : g.explain}
          lang={lang}
        />
        {delta ? (
          <BadgeDelta
            deltaType={delta.deltaType}
            isIncreasePositive={delta.isIncreasePositive}
            size="xs"
            className={cn("tabular-nums", delta.className)}
          >
            {delta.label}
          </BadgeDelta>
        ) : null}
      </Flex>

      <Flex justifyContent="between" alignItems="end" className="mt-2 gap-2">
        <AnimatedNumber
          value={value}
          format={format}
          className="min-w-0 flex-1 truncate text-2xl font-bold tabular-nums tracking-tight text-foreground"
        />
        {hasSpark ? (
          <SparkAreaChart
            data={data}
            index="i"
            categories={["v"]}
            colors={[sparkColor(kpi, g.goodWhen)]}
            className="h-8 w-16 shrink-0 animate-[soft-pulse_2.8s_ease-in-out_infinite] sm:w-20"
          />
        ) : null}
      </Flex>

      <Text className={cn("mt-1 text-xs", (hint || thinBase) && "text-muted-foreground")}>
        {subtitle}
      </Text>
    </Card>
  );
}

// Below these previous-period counts a % change is mostly noise (+200% on
// 3 conversions), so the card says "not enough data" instead.
const MIN_PREV_CLICKS = 50;
const MIN_PREV_SESSIONS = 50;
const MIN_PREV_CONVERSIONS = 10;
// 100 zł in grosze: "+1 900%" against a 5 zł test day says nothing.
const MIN_PREV_SPEND = 10_000;

const DASH = () => "-";

export function KpiCards({
  kpis,
  trend,
  lang = "pl",
}: {
  kpis: DashboardKpis;
  trend: TrendPoint[];
  lang?: "pl" | "en";
}) {
  const en = lang === "en";
  const L = {
    afterGa4: en
      ? "Google Analytics data appears after the first sync"
      : "Dane z Google Analytics pojawią się po pierwszej synchronizacji",
    ga4Gap: en
      ? "no new Google Analytics data in this period"
      : "brak nowych danych z Google Analytics w tym okresie",
    afterAds: en
      ? "Ad data appears after the first sync"
      : "Dane z reklam pojawią się po pierwszej synchronizacji",
    noSpend: en ? "no ad spend in this period" : "brak wydatków na reklamy w tym okresie",
    noClicks: en ? "no ad clicks in this period" : "brak kliknięć w reklamy w tym okresie",
    noImpressions: en
      ? "ads were not shown in this period"
      : "reklamy nie wyświetlały się w tym okresie",
    noConv: en ? "no conversion events" : "brak zdarzeń konwersji",
  };
  const impressions = trend.reduce((a, t) => a + t.impressions, 0);
  // No ads history at all (new client, Google/Meta not connected yet) vs ads
  // that simply had a quiet period - the hint should say which.
  const noAds =
    kpis.spendMinorUnits.value === 0 &&
    kpis.spendMinorUnits.previous === 0 &&
    kpis.clicks.value === 0 &&
    kpis.clicks.previous === 0 &&
    impressions === 0;
  const noSessions = kpis.sessions.value === 0 && kpis.sessions.previous === 0;
  // Sessions don't drop to exactly zero on a live site - that's a sync gap,
  // and "-100%" would be a false alarm.
  const sessionsGap = kpis.sessions.value === 0 && kpis.sessions.previous > 0;
  const noConversions =
    kpis.conversions.value === 0 && kpis.conversions.previous === 0;
  // CTR and CPC are ratios over clicks, so they inherit the clicks guard.
  const thinClicks = kpis.clicks.previous < MIN_PREV_CLICKS;
  const noClicks = kpis.clicks.value === 0;

  // A zero this period against a non-zero baseline would print "-100%";
  // an explanation in words is both kinder and more accurate.
  const spendHint = noAds ? L.afterAds : kpis.spendMinorUnits.value === 0 ? L.noSpend : undefined;
  const clicksHint = noAds ? L.afterAds : noClicks ? L.noClicks : undefined;
  const sessionsHint = noSessions ? L.afterGa4 : sessionsGap ? L.ga4Gap : undefined;
  const ctrHint = noAds ? L.afterAds : impressions === 0 ? L.noImpressions : undefined;
  // CPC of zero clicks is undefined, not "0,00 zł, 100% cheaper".
  const cpcHint = noAds ? L.afterAds : noClicks ? L.noClicks : undefined;

  // Per-day series for each metric so every card carries its own sparkline.
  const spendSeries = trend.map((t) => t.spendMinorUnits / 100);
  const clicksSeries = trend.map((t) => t.clicks);
  const sessionsSeries = trend.map((t) => t.sessions);
  const conversionsSeries = trend.map((t) => t.conversions);
  const ctrSeries = trend.map((t) =>
    t.impressions > 0 ? (t.clicks / t.impressions) * 100 : 0
  );
  const cpcSeries = trend.map((t) =>
    t.clicks > 0 ? t.spendMinorUnits / t.clicks / 100 : 0
  );

  return (
    <Grid numItemsSm={2} numItemsLg={3} className="gap-4">
      <KpiCard
        metric="spend"
        tone="amount"
        value={kpis.spendMinorUnits.value}
        // Headline in whole złoty - grosze on a five-digit budget is noise.
        format={noAds ? DASH : (n) => formatPlnWhole(Math.round(n))}
        kpi={kpis.spendMinorUnits}
        series={spendSeries}
        hint={spendHint}
        thinBase={kpis.spendMinorUnits.previous < MIN_PREV_SPEND}
        lang={lang}
      />
      <KpiCard
        metric="clicks"
        tone="amount"
        value={kpis.clicks.value}
        format={noAds ? DASH : formatNumberPL}
        kpi={kpis.clicks}
        series={clicksSeries}
        hint={clicksHint}
        thinBase={thinClicks}
        lang={lang}
      />
      <KpiCard
        metric="sessions"
        tone="amount"
        value={kpis.sessions.value}
        format={noSessions || sessionsGap ? DASH : formatNumberPL}
        kpi={kpis.sessions}
        series={sessionsSeries}
        hint={sessionsHint}
        thinBase={kpis.sessions.previous < MIN_PREV_SESSIONS}
        lang={lang}
      />
      <KpiCard
        metric="ctr"
        tone="rate"
        value={kpis.ctr.value}
        format={ctrHint ? DASH : (n) => formatPercent(n)}
        kpi={kpis.ctr}
        series={ctrSeries}
        hint={ctrHint}
        thinBase={thinClicks}
        lang={lang}
      />
      <KpiCard
        metric="cpc"
        tone="cost"
        value={kpis.cpcMinorUnits.value}
        // CPC stays with grosze: 1,47 zł vs 1,52 zł is the whole story here.
        format={cpcHint ? DASH : (n) => formatMoneyPLN(Math.round(n))}
        kpi={kpis.cpcMinorUnits}
        series={cpcSeries}
        hint={cpcHint}
        thinBase={thinClicks}
        lang={lang}
      />
      <KpiCard
        metric="conversions"
        tone="amount"
        value={kpis.conversions.value}
        format={noConversions ? DASH : formatNumberPL}
        kpi={kpis.conversions}
        series={conversionsSeries}
        hint={kpis.conversions.value === 0 ? L.noConv : undefined}
        thinBase={kpis.conversions.previous < MIN_PREV_CONVERSIONS}
        lang={lang}
      />
    </Grid>
  );
}
