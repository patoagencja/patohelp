import { Card, Grid, Text } from "@tremor/react";

import { CreativeThumb } from "@/components/dashboard/creatives/creative-thumb";
import { formatMoneyPLN, formatPlnWhole, formatPercent } from "@/lib/utils";

export interface CreativeRow {
  adId: string;
  adName: string;
  thumbnailUrl: string | null;
  spendMinorUnits: number;
  ctr: number | null;
  cpcMinorUnits: number | null;
}

// Meta-only for now; Google Ads creatives are a TODO (no thumbnail API).
export function TopCreatives({
  creatives,
  lang = "pl",
}: {
  creatives: CreativeRow[];
  lang?: "pl" | "en";
}) {
  const en = lang === "en";
  return (
    <Card>
      <h2 className="text-base font-semibold">
        {en ? "Top 5 creatives (Meta, last 30 days)" : "Top 5 kreacji (Meta, ostatnie 30 dni)"}
      </h2>
      {creatives.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {en
            ? "Creative data appears after the first creatives sync."
            : "Dane o kreacjach pojawią się po pierwszej synchronizacji kreacji (odświeżamy je co 6 godzin)."}
        </p>
      ) : (
        <Grid numItemsSm={2} numItemsLg={5} className="mt-4 gap-4">
          {creatives.map((c) => (
            <div
              key={c.adId}
              className="min-w-0 overflow-hidden rounded-lg border border-border"
            >
              <CreativeThumb
                src={c.thumbnailUrl}
                name={c.adName}
                lang={lang}
                className="h-28 w-full rounded-none"
              />
              <div className="space-y-1 p-3">
                <p
                  className="truncate text-sm font-medium"
                  title={c.adName}
                >
                  {c.adName}
                </p>
                <Text className="text-xs tabular-nums">
                  {en ? "Spend" : "Wydatki"}: {formatPlnWhole(c.spendMinorUnits)}
                </Text>
                <Text className="text-xs tabular-nums">
                  {en ? "Click rate" : "Klikalność"}:{" "}
                  {c.ctr != null ? formatPercent(c.ctr) : "-"} ·{" "}
                  {en ? "Per click" : "Za klik"}:{" "}
                  {c.cpcMinorUnits != null
                    ? formatMoneyPLN(c.cpcMinorUnits)
                    : "-"}
                </Text>
              </div>
            </div>
          ))}
        </Grid>
      )}
    </Card>
  );
}
