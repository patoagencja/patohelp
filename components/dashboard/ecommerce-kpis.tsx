import { BadgeDelta, Card, Flex, Grid, SparkAreaChart, Text } from "@tremor/react";
import { ShoppingBag } from "lucide-react";

import type {
  EcommerceKpis as EcommerceKpisData,
  Kpi,
  TrendPoint,
} from "@/lib/dashboard/metrics";
import {
  formatMoneyPLN,
  formatNumberPL,
  formatPlnWhole,
  formatSignedPct,
} from "@/lib/utils";

type Direction = "good" | "bad";

function delta(kpi: Kpi, direction: Direction) {
  if (kpi.deltaPercent === null) return null;
  const rounded = Math.round(kpi.deltaPercent * 10) / 10;
  const deltaType =
    rounded === 0
      ? "unchanged"
      : (direction === "good" ? rounded > 0 : rounded < 0)
        ? "increase"
        : "decrease";
  return {
    deltaType,
    label: `${rounded > 0 ? "+" : ""}${rounded.toLocaleString("pl-PL", {
      maximumFractionDigits: 1,
    })}%`,
  };
}

function KpiTile({
  label,
  value,
  kpi,
  direction,
  spark,
  sparkColor,
  yoyRatio,
}: {
  label: string;
  value: string;
  kpi: Kpi;
  direction: Direction;
  spark?: number[];
  sparkColor?: "emerald" | "indigo" | "amber" | "sky";
  yoyRatio?: number | null;
}) {
  const d = delta(kpi, direction);
  const sparkData = (spark ?? []).map((v, i) => ({ i, v }));
  return (
    <Card className="transition-all hover:-translate-y-0.5 hover:shadow-md">
      <Flex justifyContent="between" alignItems="start">
        <Text>{label}</Text>
        {d ? (
          <BadgeDelta deltaType={d.deltaType as never} size="xs">
            {d.label}
          </BadgeDelta>
        ) : null}
      </Flex>
      {/* Value gets the full width; the sparkline sits under it. Side by side,
          four tiles next to the sidebar left the value ~5 characters and
          truncated it ("292 0…"). */}
      <p className="mt-2 whitespace-nowrap text-2xl font-bold tracking-tight text-foreground">
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
      <Text className="mt-1 text-xs">
        vs poprzedni okres
        {yoyRatio != null ? (
          <span
            className={
              yoyRatio >= 0
                ? "ml-2 inline-block whitespace-nowrap font-medium text-emerald-600 dark:text-emerald-400"
                : "ml-2 inline-block whitespace-nowrap font-medium text-rose-600 dark:text-rose-400"
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
  const t = trend ?? [];
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
          label="Przychód"
          value={formatPlnWhole(data.revenueMinorUnits.value)}
          kpi={data.revenueMinorUnits}
          direction="good"
          spark={revSeries}
          sparkColor="emerald"
          yoyRatio={yoyRevenue}
        />
        <KpiTile
          label="ROAS"
          value={`${roas.toLocaleString("pl-PL", { maximumFractionDigits: 2 })}×`}
          kpi={data.roas}
          direction="good"
          spark={roasSeries}
          sparkColor="indigo"
          yoyRatio={yoyRoas}
        />
        <KpiTile
          label="Transakcje"
          value={formatNumberPL(data.transactions.value)}
          kpi={data.transactions}
          direction="good"
          spark={txSeries}
          sparkColor="sky"
          yoyRatio={yoyTx}
        />
        <KpiTile
          label="Śr. wartość zamówienia"
          value={formatMoneyPLN(data.aovMinorUnits.value)}
          kpi={data.aovMinorUnits}
          direction="good"
          spark={aovSeries}
          sparkColor="amber"
          yoyRatio={yoyAov}
        />
      </Grid>
    </div>
  );
}
