import { Devices } from "@/components/dashboard/website/devices";
import { EngagementMetrics } from "@/components/dashboard/website/engagement-metrics";
import { NewVsReturning } from "@/components/dashboard/website/new-vs-returning";
import { SessionsTrend } from "@/components/dashboard/website/sessions-trend";
import { TopPages } from "@/components/dashboard/website/top-pages";
import { TrafficSources } from "@/components/dashboard/website/traffic-sources";
import { getDemoDashboard } from "@/lib/demo/data";

export const dynamic = "force-dynamic";

export default function DemoFullWitryna() {
  const d = getDemoDashboard();
  const w = d.website;
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">Witryna (GA4)</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ruch i zaangażowanie na stronie · {d.rangeLabel}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <TrafficSources sources={w.sources} />
        <Devices devices={w.devices} />
      </div>
      <EngagementMetrics engagement={w.engagement} />
      <SessionsTrend trend={w.sessionsTrend} />
      <div className="grid gap-6 lg:grid-cols-2">
        <TopPages pages={w.topPages} />
        <NewVsReturning data={w.newVsReturning} />
      </div>
    </>
  );
}
