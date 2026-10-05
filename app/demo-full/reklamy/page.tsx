import { CreativeThumb } from "@/components/dashboard/creatives/creative-thumb";
import { AD_PROVIDER_SHORT } from "@/lib/types";
import { AdsPageIntro } from "@/components/dashboard/ads-page-intro";
import { CampaignPositions } from "@/components/dashboard/campaign-positions";
import { CostTrends } from "@/components/dashboard/cost-trends";
import { PlatformSplit } from "@/components/dashboard/platform-split";
import { getDemoDashboard } from "@/lib/demo/data";
import { GLOSSARY } from "@/lib/dashboard/glossary";
import { formatMoneyPLN, formatPercent, formatPlnWhole } from "@/lib/utils";

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
      <AdsPageIntro kpis={d.kpis} rangeLabel={d.rangeLabel} lang={lang} />

      {/* The two short answers first, campaign detail below - same order as
          the real Reklamy tab. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <PlatformSplit split={d.platformSplit} lang={lang} />
        <CostTrends costTrend={d.costTrend} lang={lang} />
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
              <CreativeThumb
                src={c.thumbnailUrl ?? null}
                name={c.name}
                lang={lang}
                className="aspect-square w-full"
              >
                <span className="absolute left-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 tabular-nums text-[10px] font-semibold text-white">
                  {AD_PROVIDER_SHORT[c.provider]}
                </span>
              </CreativeThumb>
              <div className="space-y-1.5 p-3">
                <p className="truncate text-sm font-medium" title={c.name}>
                  {c.name}
                </p>
                <p className="text-sm font-bold tabular-nums">
                  {formatPlnWhole(c.spend)}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    {en ? "spent" : "wydane"}
                  </span>
                </p>
                <div className="flex flex-wrap items-center justify-between gap-x-2 text-xs tabular-nums text-muted-foreground">
                  <span>
                    {en ? GLOSSARY.ctr.en.name : GLOSSARY.ctr.name} {formatPercent(c.ctr ?? 0)}
                  </span>
                  <span>
                    {en ? "Per click" : "Za kliknięcie"} {c.cpc != null ? formatMoneyPLN(c.cpc) : "-"}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
