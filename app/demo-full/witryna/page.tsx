import { Devices } from "@/components/dashboard/website/devices";
import { EngagementMetrics } from "@/components/dashboard/website/engagement-metrics";
import { NewVsReturning } from "@/components/dashboard/website/new-vs-returning";
import { SessionsTrend } from "@/components/dashboard/website/sessions-trend";
import { TopPages } from "@/components/dashboard/website/top-pages";
import { TrafficSources } from "@/components/dashboard/website/traffic-sources";
import { getDemoDashboard } from "@/lib/demo/data";

export const dynamic = "force-dynamic";

export default function DemoFullWitryna({
  searchParams,
}: {
  searchParams: { lang?: string };
}) {
  const lang = searchParams.lang === "en" ? "en" : "pl";
  const en = lang === "en";
  const d = getDemoDashboard(lang);
  const w = d.website;
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">{en ? "Website (GA4)" : "Witryna (GA4)"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {en
            ? `Traffic and engagement · ${d.rangeLabel}`
            : `Ruch i zaangażowanie na stronie · ${d.rangeLabel}`}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <TrafficSources sources={w.sources} lang={lang} />
        <Devices devices={w.devices} lang={lang} />
      </div>
      <EngagementMetrics engagement={w.engagement} lang={lang} />
      <SessionsTrend trend={w.sessionsTrend} lang={lang} />
      <div className="grid gap-6 lg:grid-cols-2">
        <TopPages pages={w.topPages} lang={lang} />
        <NewVsReturning data={w.newVsReturning} lang={lang} />
      </div>
    </>
  );
}
