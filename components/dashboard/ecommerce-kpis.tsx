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
  if (kpi.deltaPercent === null || !Number.isFinite(kpi.deltaPercent)) return null;
  const rounded = Math.round(kpi.deltaPercent * 10) / 10;
  const deltaType = rounded > 0 ? "increase" : rounded < 0 ? "decrease" : "unchanged";
  return {
    deltaType,
    // Tremor's emerald/red-600 badge text is ~3.4:1 on its tint; -700 is AA.
    className:
      Math.abs(rounded) < FLAT_THRESHOLD
        ? "bg-slate-50 text-slate-600 ring-slate-500 dark:text-slate-300"
        : rounded > 0
          ? "text-emerald-700 dark:text-emerald-400"
          : "text-red-700 dark:text-red-400",
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
  // Zero this period against a real baseline means missing data here, so no
  // "-100%" badge; the sentence below still explains it.
  const d = thinBase || kpi.value === 0 ? null : delta(kpi);
  const sparkData = (spark ?? []).map((v, i) => ({ i, v }));
  return (
    // z-index lift keeps an open ⓘ bubble above the neighbouring tiles.
    <Card className="transition-all focus-within:z-10 hover:z-10 hover:-translate-y-0.5 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0">
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
          aria-hidden
          data={sparkData}
          categories={["v"]}
          index="i"
          colors={[sparkColor ?? "emerald"]}
          className="mt-2 h-8 w-full"
        />
      ) : null}
      <Text className={cn("mt-1 text-xs", thinBase && "text-muted-foreground")}>
        {kpi.value === 0 && kpi.previous > 0
          ? "brak danych w tym okresie"
          : describeChange(kpi.deltaPercent, tone, { thinBase })}
        {yoyRatio != null ? (
          <span
            className={
              yoyRatio >= 0
                ? "ml-2 inline-block whitespace-nowrap font-medium tabular-nums text-emerald-700 dark:text-emerald-400"
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
  // "-100% r/r" on a period with no sales yet is a tracking gap, not news.
  const yoyRevenue = yoy && curRevenue > 0 ? ratio(curRevenue, yoy.revenue) : null;
  const yoyTx = yoy && curTx > 0 ? ratio(curTx, yoy.transactions) : null;
  const yoyRoas =
    yoy && spend && spend > 0 && yoy.spend > 0
      ? ratio(curRevenue / spend, yoy.revenue / yoy.spend)
      : null;
  const yoyAov =
    yoy && curTx > 0 && yoy.transactions > 0
      ? ratio(curRevenue / curTx, yoy.revenue / yoy.transactions)
      : null;
  const thinBase = data.transactions.previous < MIN_PREV_TRANSACTIONS;
  // A shop with no purchase events at all (tracking not set up, or the first
  // sync still running): four tiles of "0 zł / 0× / 0" look like a dead shop.
  const noSalesData =
    curRevenue === 0 &&
    curTx === 0 &&
    data.revenueMinorUnits.previous === 0 &&
    data.transactions.previous === 0;
  const hasSpend = (spend ?? 0) > 0;
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
        Wyniki sklepu w wybranym okresie
      </h2>
      {noSalesData ? (
        <Card className="flex items-start gap-3">
          <ShoppingBag className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Sprzedaż pojawi się tutaj, gdy Google Analytics zarejestruje pierwsze
            zamówienia - wymaga to włączonego śledzenia zakupów w sklepie.
          </p>
        </Card>
      ) : (
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
          // Return on zero spend is undefined, not "0×" (overview passes no
          // spend - there the stored ROAS of 0 means the same thing).
          value={
            (spend !== undefined && !hasSpend) || (spend === undefined && roas === 0)
              ? "-"
              : `${roas.toLocaleString("pl-PL", { maximumFractionDigits: 2 })}×`
          }
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
          value={curTx > 0 ? formatMoneyPLN(data.aovMinorUnits.value) : "-"}
          kpi={data.aovMinorUnits}
          thinBase={thinBase}
          spark={aovSeries}
          sparkColor="amber"
          yoyRatio={yoyAov}
        />
      </Grid>
      )}
    </div>
  );
}
