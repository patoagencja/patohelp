import { AD_PROVIDER_SHORT } from "@/lib/types";
import { CampaignPositions } from "@/components/dashboard/campaign-positions";
import { CostTrends } from "@/components/dashboard/cost-trends";
import { PlatformSplit } from "@/components/dashboard/platform-split";
import { getDemoDashboard } from "@/lib/demo/data";
import { formatMoneyPLN, formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default function DemoFullReklamy({
  searchParams,
}: {
  searchParams: { lang?: string };
}) {
  const lang = searchParams.lang === "en" ? "en" : "pl";
  const en = lang === "en";
  const d = getDemoDashboard(lang);

  // Pair each creative with a plausible platform for the little badge.
  const ads = d.creativesFull.map((c, i) => ({
    ...c,
    provider: (i % 3 === 2 ? "google_ads" : "meta_ads") as "meta_ads" | "google_ads",
  }));

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">{en ? "Ads" : "Reklamy"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {en
            ? `Meta and Google campaigns in one place · ${d.rangeLabel}`
            : `Kampanie Meta i Google w jednym miejscu · ${d.rangeLabel}`}
        </p>
      </div>

      <CampaignPositions campaigns={d.campaigns} lang={lang} />

      {/* Example ads gallery */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
          {en ? "Active ads" : "Aktywne reklamy"}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ads.map((c) => (
            <div
              key={c.adId}
              className="overflow-hidden rounded-xl border border-border bg-card"
            >
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={c.thumbnailUrl ?? ""}
                  alt={c.name}
                  className="aspect-square w-full bg-muted object-cover"
                />
                <span className="absolute left-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">
                  {AD_PROVIDER_SHORT[c.provider]}
                </span>
              </div>
              <div className="space-y-1.5 p-3">
                <p className="truncate text-sm font-medium" title={c.name}>
                  {c.name}
                </p>
                <p className="font-mono text-sm font-bold tabular-nums">
                  {formatMoneyPLN(c.spend)}
                </p>
                <div className="flex items-center justify-between font-mono text-xs text-muted-foreground">
                  <span>CTR {formatPercent(c.ctr ?? 0)}</span>
                  <span>CPC {c.cpc != null ? formatMoneyPLN(c.cpc) : "-"}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <CostTrends costTrend={d.costTrend} lang={lang} />
        <PlatformSplit split={d.platformSplit} lang={lang} />
      </div>
    </>
  );
}
