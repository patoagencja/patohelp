import { Card, Grid, Metric, Text } from "@tremor/react";

import { formatNumberPL, formatPercent } from "@/lib/utils";

// TODO: avg session duration (not stored in ga4_daily yet) - showing average
// daily sessions instead.
export function EngagementMetrics({
  engagement,
  lang = "pl",
}: {
  engagement: {
    engagementRate: number;
    bounceRate: number;
    avgDailySessions: number;
  };
  lang?: "pl" | "en";
}) {
  const en = lang === "en";
  return (
    <Grid numItemsSm={3} className="gap-4">
      <Card>
        <Text>{en ? "Engagement rate" : "Współczynnik zaangażowania"}</Text>
        <Metric className="mt-2">
          {formatPercent(engagement.engagementRate, 1)}
        </Metric>
      </Card>
      <Card>
        <Text>{en ? "Bounce rate" : "Współczynnik odrzuceń"}</Text>
        <Metric className="mt-2">{formatPercent(engagement.bounceRate, 1)}</Metric>
      </Card>
      <Card>
        <Text>{en ? "Avg sessions / day" : "Średnio sesji dziennie"}</Text>
        <Metric className="mt-2">
          {formatNumberPL(engagement.avgDailySessions)}
        </Metric>
      </Card>
    </Grid>
  );
}
