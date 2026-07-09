import { Card, Grid, Metric, Text } from "@tremor/react";

import { formatNumberPL, formatPercent } from "@/lib/utils";

// TODO: avg session duration (not stored in ga4_daily yet) - showing average
// daily sessions instead.
export function EngagementMetrics({
  engagement,
}: {
  engagement: {
    engagementRate: number;
    bounceRate: number;
    avgDailySessions: number;
  };
}) {
  return (
    <Grid numItemsSm={3} className="gap-4">
      <Card>
        <Text>Współczynnik zaangażowania</Text>
        <Metric className="mt-2">
          {formatPercent(engagement.engagementRate, 1)}
        </Metric>
      </Card>
      <Card>
        <Text>Współczynnik odrzuceń</Text>
        <Metric className="mt-2">{formatPercent(engagement.bounceRate, 1)}</Metric>
      </Card>
      <Card>
        <Text>Średnio sesji dziennie</Text>
        <Metric className="mt-2">
          {formatNumberPL(engagement.avgDailySessions)}
        </Metric>
      </Card>
    </Grid>
  );
}
