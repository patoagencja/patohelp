import { BadgeDelta, Card, Flex, Grid, SparkAreaChart, Text } from "@tremor/react";
import { ShoppingBag } from "lucide-react";

import { ECOM_TERMS, withoutToday } from "@/components/dashboard/ecom/plain";
import { MetricLabel } from "@/components/dashboard/info-tip";
import {
  GLOSSARY,
  describeChange,
  type ChangeTone,
  type GlossaryKey,
} from "@/lib/dashboard/glossary";
import type {
  EcommerceKpis as EcommerceKpisData,
  Kpi,
  TrendPoint,
} from "@/lib/dashboard/metrics";
import {
  cn,
  formatMoneyPLN,
  formatNumberPL,
  formatPlnWhole,
  formatSignedPct,
} from "@/lib/utils";

// Matches the "podobnie jak wcześniej" cut-off in describeChange so the badge
// and the sentence under the number agree.
const FLAT_THRESHOLD = 3;

// Every e-commerce KPI here is "higher is better", so Tremor's default
// increase=green / decrease=red mapping is right; tiny moves go gray.
function delta(kpi: Kpi) {
  if (kpi.deltaPercent === null) return null;
  const rounded = Math.round(kpi.deltaPercent * 10) / 10;
  const deltaType = rounded > 0 ? "increase" : rounded < 0 ? "decrease" : "unchanged";
  return {
    deltaType,
    className:
      Math.abs(rounded) < FLAT_THRESHOLD
        ? "bg-slate-50 text-slate-600 ring-slate-500 dark:text-slate-300"
        : undefined,
    label: `${rounded > 0 ? "+" : ""}${rounded.toLocaleString("pl-PL", {
      maximumFractionDigits: 1,
    })}%`,
  };
}

function KpiTile({
  metric,
  name,
  tone,
  value,
  kpi,
  spark,
  sparkColor,
  yoyRatio,
  thinBase = false,
}: {
  metric: GlossaryKey;
  /** Shorter label than the glossary's, where that one wraps in a tile. */
  name?: string;
  tone: ChangeTone;
  value: string;
  kpi: Kpi;
  spark?: number[];
  sparkColor?: "emerald" | "indigo" | "amber" | "sky";
  yoyRatio?: number | null;
  /** Previous period too small for a meaningful % - hide it. */
  thinBase?: boolean;
}) {
  const g = GLOSSARY[metric];
  const d = thinBase ? null : delta(kpi);
  const sparkData = (spark ?? []).map((v, i) => ({ i, v }));
  return (
    // z-index lift keeps an open ⓘ bubble above the neighbouring tiles.
    <Card className="transition-all focus-within:z-10 hover:z-10 hover:-translate-y-0.5 hover:shadow-md">
      {/* Fixed header height: a label that wraps to two lines in one tile
          would otherwise push its value below the neighbours' values. */}
      <Flex justifyContent="between" alignItems="start" className="gap-2 sm:min-h-[2.75rem]">
        <MetricLabel name={name ?? g.name} tag={g.short} explain={g.explain} />
        {d ? (
          <BadgeDelta
            deltaType={d.deltaType}
            size="xs"
            className={cn("tabular-nums", d.className)}
          >
            {d.label}
          </BadgeDelta>
        ) : null}
      </Flex>
      {/* Value gets the full width; the sparkline sits under it. Side by side,
          four tiles next to the sidebar left the value ~5 characters and
          truncated it ("292 0…"). */}
      <p className="mt-2 whitespace-nowrap text-2xl font-bold tabular-nums tracking-tight text-foreground">
        {value}
      </p>
      {sparkData.length > 1 ? (
        <SparkAreaChart
          data={sparkData}
          categories={["v"]}
          index="i"
          colors={[sparkColor ?? "emerald"]}
          className="mt-2 h-8 w-full"
        />
      ) : null}
      <Text className={cn("mt-1 text-xs", thinBase && "text-muted-foreground")}>
        {describeChange(kpi.deltaPercent, tone, { thinBase })}
        {yoyRatio != null ? (
          <span
            className={
              yoyRatio >= 0
                ? "ml-2 inline-block whitespace-nowrap font-medium tabular-nums text-emerald-600 dark:text-emerald-400"
                : "ml-2 inline-block whitespace-nowrap font-medium tabular-nums text-rose-600 dark:text-rose-400"
            }
            title="Ten sam okres rok temu (wyrównany do dni tygodnia)"
          >
            {formatSignedPct(yoyRatio)} r/r
          </span>
        ) : null}
      </Text>
    </Card>
  );
}

// Fewer orders than this last period and every e-commerce % (revenue, ROAS,
// AOV) swings on one or two baskets - say "not enough data" instead.
const MIN_PREV_TRANSACTIONS = 10;

/** Same window last year, used for the r/r line under each tile. */
export interface EcommerceYoY {
  revenue: number;
  transactions: number;
  spend: number;
}

const ratio = (cur: number, prev: number) => (prev > 0 ? cur / prev - 1 : null);

// Revenue-first KPI row for e-commerce clients: revenue, ROAS, transactions,
// average order value. Sourced from GA4 purchases + ad spend. When the daily
// trend is provided each tile gets a sparkline of its own series.
export function EcommerceKpis({
  data,
  trend,
  yoy,
  spend,
}: {
  data: EcommerceKpisData;
  trend?: TrendPoint[];
  /** Last year's same window; omit when last year's data is too thin. */
  yoy?: EcommerceYoY | null;
  /** Current-window ad spend (grosze), needed for the ROAS r/r line. */
  spend?: number;
}) {
  const roas = data.roas.value / 100; // stored ×100
  const curRevenue = data.revenueMinorUnits.value;
  const curTx = data.transactions.value;
  const yoyRevenue = yoy ? ratio(curRevenue, yoy.revenue) : null;
  const yoyTx = yoy ? ratio(curTx, yoy.transactions) : null;
  const yoyRoas =
    yoy && spend && spend > 0 && yoy.spend > 0
      ? ratio(curRevenue / spend, yoy.revenue / yoy.spend)
      : null;
  const yoyAov =
    yoy && curTx > 0 && yoy.transactions > 0
      ? ratio(curRevenue / curTx, yoy.revenue / yoy.transactions)
      : null;
  const thinBase = data.transactions.previous < MIN_PREV_TRANSACTIONS;
  // Sparklines stop at yesterday: today's half-synced day reads as a crash.
  const t = withoutToday(trend ?? []);
  const revSeries = t.map((p) => p.revenueMinorUnits / 100);
  const roasSeries = t.map((p) =>
    p.spendMinorUnits > 0 ? p.revenueMinorUnits / p.spendMinorUnits : 0
  );
  const txSeries = t.map((p) => p.transactions ?? 0);
  const aovSeries = t.map((p) =>
    (p.transactions ?? 0) > 0 ? p.revenueMinorUnits / 100 / p.transactions! : 0
  );
  return (
    <div>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <ShoppingBag className="h-4 w-4 text-emerald-500" />
        Sprzedaż (e-commerce)
      </h2>
      <Grid numItemsSm={2} numItemsLg={4} className="gap-4">
        <KpiTile
          metric="revenue"
          tone="amount"
          value={formatPlnWhole(data.revenueMinorUnits.value)}
          kpi={data.revenueMinorUnits}
          thinBase={thinBase}
          spark={revSeries}
          sparkColor="emerald"
          yoyRatio={yoyRevenue}
        />
        <KpiTile
          metric="roas"
          tone="rate"
          value={`${roas.toLocaleString("pl-PL", { maximumFractionDigits: 2 })}×`}
          kpi={data.roas}
          thinBase={thinBase}
          spark={roasSeries}
          sparkColor="indigo"
          yoyRatio={yoyRoas}
        />
        <KpiTile
          metric="transactions"
          tone="amount"
          value={formatNumberPL(data.transactions.value)}
          kpi={data.transactions}
          thinBase={thinBase}
          spark={txSeries}
          sparkColor="sky"
          yoyRatio={yoyTx}
        />
        <KpiTile
          metric="aov"
          name={ECOM_TERMS.aov.name}
          tone="amount"
          value={formatMoneyPLN(data.aovMinorUnits.value)}
          kpi={data.aovMinorUnits}
          thinBase={thinBase}
          spark={aovSeries}
          sparkColor="amber"
          yoyRatio={yoyAov}
        />
      </Grid>
    </div>
  );
}
