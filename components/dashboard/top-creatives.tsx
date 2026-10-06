import { Card, Text } from "@tremor/react";

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
      {/* Sorted by spend, not results - "najlepsze" put an ad the Kreacje tab
          flags as worn out ("Do odświeżenia") on the "best" list. */}
      <h2 className="text-section-title">
        {en
          ? "Ads with the biggest budget (Meta, last 30 days)"
          : "Reklamy z największym budżetem (Meta, ostatnie 30 dni)"}
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {en
          ? "Which ones work best (and which need refreshing) - see the Creatives tab."
          : "Które działają najlepiej, a które trzeba odświeżyć - w zakładce Kreacje."}
      </p>
      {creatives.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {en
            ? "Creative data appears after the first creatives sync."
            : "Dane o reklamach pojawią się po pierwszej synchronizacji (odświeżamy je co 6 godzin)."}
        </p>
      ) : (
        // Phones: a swipeable row (five stacked thumbnails were ~1 200 px of
        // scrolling); sm+ keeps the grid.
        <div className="-mx-1 mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-5">
          {creatives.map((c) => (
            <div
              key={c.adId}
              className="w-[70%] min-w-0 shrink-0 snap-start overflow-hidden rounded-2xl bg-muted/60 sm:w-auto"
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
        </div>
      )}
    </Card>
  );
}
