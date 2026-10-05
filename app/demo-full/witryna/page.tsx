import { Audience } from "@/components/dashboard/website/audience";
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
        <h1 className="text-2xl font-semibold tracking-tight">
          {en ? "Your website" : "Twoja strona internetowa"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {en
            ? `Traffic and engagement · ${d.rangeLabel}`
            : `Kto odwiedza stronę, skąd przychodzi i co ogląda · ${d.rangeLabel}`}
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
      {en ? null : (
        <Audience
          data={{
            hasData: true,
            ageSource: "meta",
            genderSource: "meta",
            age: [
              { bucket: "18-24", value: 182_000 },
              { bucket: "25-34", value: 611_000 },
              { bucket: "35-44", value: 548_000 },
              { bucket: "45-54", value: 402_000 },
              { bucket: "55-64", value: 251_000 },
              { bucket: "65+", value: 139_000 },
            ],
            gender: [
              { bucket: "female", value: 1_214_000 },
              { bucket: "male", value: 919_000 },
            ],
            geo: [
              { bucket: "Masovian Voivodeship", value: 9120 },
              { bucket: "Silesian Voivodeship", value: 5480 },
              { bucket: "Lesser Poland Voivodeship", value: 4310 },
              { bucket: "Greater Poland Voivodeship", value: 3920 },
              { bucket: "Lower Silesian Voivodeship", value: 3150 },
              { bucket: "Pomeranian Voivodeship", value: 2470 },
            ],
          }}
        />
      )}
    </>
  );
}
