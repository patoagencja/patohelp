import { CampaignPositions } from "@/components/dashboard/campaign-positions";
import { CostTrends } from "@/components/dashboard/cost-trends";
import { PlatformSplit } from "@/components/dashboard/platform-split";
import { TopCreatives } from "@/components/dashboard/top-creatives";
import { getDemoDashboard } from "@/lib/demo/data";

export const dynamic = "force-dynamic";

export default function DemoFullReklamy({
  searchParams,
}: {
  searchParams: { lang?: string };
}) {
  const lang = searchParams.lang === "en" ? "en" : "pl";
  const en = lang === "en";
  const d = getDemoDashboard(lang);
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
      <TopCreatives creatives={d.creatives} lang={lang} />

      <div className="grid gap-6 lg:grid-cols-2">
        <CostTrends costTrend={d.costTrend} lang={lang} />
        <PlatformSplit split={d.platformSplit} lang={lang} />
      </div>
    </>
  );
}
