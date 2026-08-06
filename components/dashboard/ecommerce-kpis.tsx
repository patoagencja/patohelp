import { BadgeDelta, Card, Flex, Grid, SparkAreaChart, Text } from "@tremor/react";
import { ShoppingBag } from "lucide-react";

import type {
  EcommerceKpis as EcommerceKpisData,
  Kpi,
  TrendPoint,
} from "@/lib/dashboard/metrics";
import { formatMoneyPLN, formatNumberPL } from "@/lib/utils";

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
}: {
  label: string;
  value: string;
  kpi: Kpi;
  direction: Direction;
  spark?: number[];
  sparkColor?: "emerald" | "indigo" | "amber" | "sky";
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
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="truncate text-2xl font-bold tracking-tight text-foreground">
          {value}
        </p>
        {sparkData.length > 1 ? (
          <SparkAreaChart
            data={sparkData}
            categories={["v"]}
            index="i"
            colors={[sparkColor ?? "emerald"]}
            className="h-9 w-24 shrink-0"
          />
        ) : null}
      </div>
      <Text className="mt-1 text-xs">vs poprzedni okres</Text>
    </Card>
  );
}

// Revenue-first KPI row for e-commerce clients: revenue, ROAS, transactions,
// average order value. Sourced from GA4 purchases + ad spend. When the daily
// trend is provided each tile gets a sparkline of its own series.
export function EcommerceKpis({
  data,
  trend,
}: {
  data: EcommerceKpisData;
  trend?: TrendPoint[];
}) {
  const roas = data.roas.value / 100; // stored ×100
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
          value={formatMoneyPLN(data.revenueMinorUnits.value)}
          kpi={data.revenueMinorUnits}
          direction="good"
          spark={revSeries}
          sparkColor="emerald"
        />
        <KpiTile
          label="ROAS"
          value={`${roas.toLocaleString("pl-PL", { maximumFractionDigits: 2 })}×`}
          kpi={data.roas}
          direction="good"
          spark={roasSeries}
          sparkColor="indigo"
        />
        <KpiTile
          label="Transakcje"
          value={formatNumberPL(data.transactions.value)}
          kpi={data.transactions}
          direction="good"
          spark={txSeries}
          sparkColor="sky"
        />
        <KpiTile
          label="Śr. wartość zamówienia"
          value={formatMoneyPLN(data.aovMinorUnits.value)}
          kpi={data.aovMinorUnits}
          direction="good"
          spark={aovSeries}
          sparkColor="amber"
        />
      </Grid>
    </div>
  );
}
