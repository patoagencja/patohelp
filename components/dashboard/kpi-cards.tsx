import { BadgeDelta, Card, Flex, Grid, Metric, Text } from "@tremor/react";

import type { DashboardKpis, Kpi } from "@/lib/dashboard/metrics";
import { formatMoneyPLN, formatNumberPL, formatPercent } from "@/lib/utils";

function deltaProps(kpi: Kpi) {
  if (kpi.deltaPercent === null) return null;
  const rounded = Math.round(kpi.deltaPercent * 10) / 10;
  const deltaType =
    rounded > 0 ? "moderateIncrease" : rounded < 0 ? "moderateDecrease" : "unchanged";
  return { deltaType, label: `${rounded > 0 ? "+" : ""}${formatPercent(rounded, 1)}` };
}

function KpiCard({
  label,
  value,
  kpi,
  muted,
}: {
  label: string;
  value: string;
  kpi: Kpi;
  muted?: boolean;
}) {
  const delta = muted ? null : deltaProps(kpi);
  return (
    <Card>
      <Text>{label}</Text>
      <Flex justifyContent="between" alignItems="baseline" className="mt-2">
        <Metric>{value}</Metric>
        {delta ? (
          <BadgeDelta deltaType={delta.deltaType as never} size="xs">
            {delta.label}
          </BadgeDelta>
        ) : null}
      </Flex>
      <Text className="mt-1 text-xs">
        {muted ? "po podłączeniu GA4" : "vs poprzedni miesiąc"}
      </Text>
    </Card>
  );
}

export function KpiCards({ kpis }: { kpis: DashboardKpis }) {
  const sessionsMissing = kpis.sessions.value === 0;

  return (
    <Grid numItemsSm={2} numItemsLg={4} className="gap-4">
      <KpiCard
        label="Wydatki (ten miesiąc)"
        value={formatMoneyPLN(kpis.spendMinorUnits.value)}
        kpi={kpis.spendMinorUnits}
      />
      <KpiCard
        label="Kliknięcia"
        value={formatNumberPL(kpis.clicks.value)}
        kpi={kpis.clicks}
      />
      <KpiCard
        label="Sesje (GA4)"
        value={sessionsMissing ? "—" : formatNumberPL(kpis.sessions.value)}
        kpi={kpis.sessions}
        muted={sessionsMissing}
      />
      <KpiCard
        label="Średni CTR"
        value={formatPercent(kpis.ctr.value)}
        kpi={kpis.ctr}
      />
    </Grid>
  );
}
