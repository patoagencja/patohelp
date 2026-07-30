import { BadgeDelta, Card, Flex, Grid, Text } from "@tremor/react";
import { ShoppingBag } from "lucide-react";

import type { EcommerceKpis as EcommerceKpisData, Kpi } from "@/lib/dashboard/metrics";
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
}: {
  label: string;
  value: string;
  kpi: Kpi;
  direction: Direction;
}) {
  const d = delta(kpi, direction);
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
      <p className="mt-2 truncate text-2xl font-bold tracking-tight text-foreground">
        {value}
      </p>
      <Text className="mt-1 text-xs">vs poprzedni okres</Text>
    </Card>
  );
}

// Revenue-first KPI row for e-commerce clients: revenue, ROAS, transactions,
// average order value. Sourced from GA4 purchases + ad spend.
export function EcommerceKpis({ data }: { data: EcommerceKpisData }) {
  const roas = data.roas.value / 100; // stored ×100
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
        />
        <KpiTile
          label="ROAS"
          value={`${roas.toLocaleString("pl-PL", { maximumFractionDigits: 2 })}×`}
          kpi={data.roas}
          direction="good"
        />
        <KpiTile
          label="Transakcje"
          value={formatNumberPL(data.transactions.value)}
          kpi={data.transactions}
          direction="good"
        />
        <KpiTile
          label="Śr. wartość zamówienia"
          value={formatMoneyPLN(data.aovMinorUnits.value)}
          kpi={data.aovMinorUnits}
          direction="good"
        />
      </Grid>
    </div>
  );
}
