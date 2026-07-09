/* eslint-disable @next/next/no-img-element */
import { Card, Grid, Text, Title } from "@tremor/react";
import { ImageOff } from "lucide-react";

import { formatMoneyPLN, formatPercent } from "@/lib/utils";

export interface CreativeRow {
  adId: string;
  adName: string;
  thumbnailUrl: string | null;
  spendMinorUnits: number;
  ctr: number | null;
  cpcMinorUnits: number | null;
}

// Meta-only for now; Google Ads creatives are a TODO (no thumbnail API).
export function TopCreatives({ creatives }: { creatives: CreativeRow[] }) {
  return (
    <Card>
      <Title>Top 5 kreacji (Meta, ostatnie 30 dni)</Title>
      {creatives.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Dane o kreacjach pojawią się po pierwszej synchronizacji kreacji
          (cron co 6h).
        </p>
      ) : (
        <Grid numItemsSm={2} numItemsLg={5} className="mt-4 gap-4">
          {creatives.map((c) => (
            <div
              key={c.adId}
              className="overflow-hidden rounded-lg border border-border"
            >
              {c.thumbnailUrl ? (
                <img
                  src={c.thumbnailUrl}
                  alt={c.adName}
                  className="h-28 w-full bg-muted object-cover"
                />
              ) : (
                <div className="flex h-28 w-full items-center justify-center bg-muted">
                  <ImageOff className="h-6 w-6 text-muted-foreground" />
                </div>
              )}
              <div className="space-y-1 p-3">
                <p
                  className="truncate text-sm font-medium"
                  title={c.adName}
                >
                  {c.adName}
                </p>
                <Text className="text-xs">
                  Wydatki: {formatMoneyPLN(c.spendMinorUnits)}
                </Text>
                <Text className="text-xs">
                  CTR: {c.ctr != null ? formatPercent(c.ctr) : "-"} · CPC:{" "}
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
