import { Card } from "@/components/ui/card";

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
    <Card className="rounded-glass p-6 sm:p-7">
      {/* Sorted by spend, not results - "najlepsze" put an ad the Kreacje tab
          flags as worn out ("Do odświeżenia") on the "best" list. */}
      <p className="kick">{en ? "Meta · last 30 days" : "Meta · ostatnie 30 dni"}</p>
      <h2 className="mt-2 text-[22px] font-medium tracking-[-0.03em]">
        {en ? "Ads with the biggest budget" : "Reklamy z największym budżetem"}
      </h2>
      <p className="mt-1 text-sm text-ink-2">
        {en
          ? "Which ones work best (and which need refreshing) - see the Creatives tab."
          : "Które działają najlepiej, a które trzeba odświeżyć - w zakładce Kreacje."}
      </p>
      {creatives.length === 0 ? (
        <p className="mt-3 text-sm text-ink-2">
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
              className="w-[70%] min-w-0 shrink-0 snap-start overflow-hidden rounded-[22px] bg-chip sm:w-auto"
            >
              <CreativeThumb
                src={c.thumbnailUrl}
                name={c.adName}
                lang={lang}
                className="h-28 w-full rounded-none"
              />
              <div className="space-y-1 p-3.5">
                <p
                  className="truncate text-sm font-medium"
                  title={c.adName}
                >
                  {c.adName}
                </p>
                <p className="text-xs tabular-nums text-ink-2">
                  {en ? "Spend" : "Wydatki"}: {formatPlnWhole(c.spendMinorUnits)}
                </p>
                <p className="text-xs tabular-nums text-ink-2">
                  {en ? "Click rate" : "Klikalność"}:{" "}
                  {c.ctr != null ? formatPercent(c.ctr) : "-"} ·{" "}
                  {en ? "Per click" : "Za klik"}:{" "}
                  {c.cpcMinorUnits != null
                    ? formatMoneyPLN(c.cpcMinorUnits)
                    : "-"}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
