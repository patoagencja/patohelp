import { CampaignPositions } from "@/components/dashboard/campaign-positions";
import { CostTrends } from "@/components/dashboard/cost-trends";
import { PlatformSplit } from "@/components/dashboard/platform-split";
import { TopCreatives } from "@/components/dashboard/top-creatives";
import { getDemoDashboard } from "@/lib/demo/data";

export const dynamic = "force-dynamic";

export default function DemoFullReklamy() {
  const d = getDemoDashboard();
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">Reklamy</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Kampanie Meta i Google w jednym miejscu · {d.rangeLabel}
        </p>
      </div>

      <CampaignPositions campaigns={d.campaigns} />
      <TopCreatives creatives={d.creatives} />

      <div className="grid gap-6 lg:grid-cols-2">
        <CostTrends costTrend={d.costTrend} />
        <PlatformSplit split={d.platformSplit} />
      </div>
    </>
  );
}
