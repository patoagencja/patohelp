import { BadgeDelta, Card, Flex, Grid, Metric, Text } from "@tremor/react";

import type { DashboardKpis, Kpi } from "@/lib/dashboard/metrics";
import { formatMoneyPLN, formatNumberPL, formatPercent } from "@/lib/utils";

// How an increase should be judged for each metric.
type Direction = "good" | "bad" | "neutral";

// Green when the change is good for the client, red when bad, gray for
// neutral metrics (spend) — the arrow still shows the direction.
function deltaBadge(kpi: Kpi, direction: Direction) {
  if (kpi.deltaPercent === null) return null;
  const rounded = Math.round(kpi.deltaPercent * 10) / 10;

  const deltaType =
    rounded === 0 || direction === "neutral"
      ? "unchanged"
      : (direction === "good" ? rounded > 0 : rounded < 0)
        ? "increase" // green
        : "decrease"; // red

  return {
    deltaType,
    showArrow: rounded > 0 ? "▲" : rounded < 0 ? "▼" : "",
    label: `${rounded > 0 ? "+" : ""}${formatPercent(rounded, 1)}`,
  };
}

function KpiCard({
  label,
  value,
  kpi,
  direction,
  hint,
}: {
  label: string;
  value: string;
  kpi: Kpi;
  direction: Direction;
  hint?: string;
}) {
  const delta = hint ? null : deltaBadge(kpi, direction);
  return (
    <Card>
      <Text>{label}</Text>
      <Flex justifyContent="between" alignItems="baseline" className="mt-2">
        <Metric className="truncate">{value}</Metric>
        {delta ? (
          <BadgeDelta deltaType={delta.deltaType as never} size="xs">
            {`${delta.showArrow} ${delta.label}`.trim()}
          </BadgeDelta>
        ) : null}
      </Flex>
      <Text className="mt-1 text-xs">{hint ?? "vs poprzedni okres"}</Text>
    </Card>
  );
}

export function KpiCards({ kpis }: { kpis: DashboardKpis }) {
  const noSessions = kpis.sessions.value === 0 && kpis.sessions.previous === 0;
  const noConversions =
    kpis.conversions.value === 0 && kpis.conversions.previous === 0;

  return (
    <Grid numItemsSm={2} numItemsLg={3} className="gap-4">
      <KpiCard
        label="Wydatki"
        value={formatMoneyPLN(kpis.spendMinorUnits.value)}
        kpi={kpis.spendMinorUnits}
        direction="neutral"
      />
      <KpiCard
        label="Kliknięcia"
        value={formatNumberPL(kpis.clicks.value)}
        kpi={kpis.clicks}
        direction="good"
      />
      <KpiCard
        label="Sesje (GA4)"
        value={noSessions ? "—" : formatNumberPL(kpis.sessions.value)}
        kpi={kpis.sessions}
        direction="good"
        hint={noSessions ? "po podłączeniu GA4" : undefined}
      />
      <KpiCard
        label="Średni CTR"
        value={formatPercent(kpis.ctr.value)}
        kpi={kpis.ctr}
        direction="good"
      />
      <KpiCard
        label="Średni CPC"
        value={formatMoneyPLN(Math.round(kpis.cpcMinorUnits.value))}
        kpi={kpis.cpcMinorUnits}
        direction="bad"
      />
      <KpiCard
        label="Konwersje"
        value={noConversions ? "—" : formatNumberPL(kpis.conversions.value)}
        kpi={kpis.conversions}
        direction="good"
        hint={noConversions ? "brak zdarzeń konwersji" : undefined}
      />
    </Grid>
  );
}
