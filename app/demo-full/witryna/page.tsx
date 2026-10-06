import { DetailsDisclosure } from "@/components/dashboard/details-disclosure";
import { ActivityHeatmap } from "@/components/dashboard/website/activity-heatmap";
import { Audience } from "@/components/dashboard/website/audience";
import { Devices } from "@/components/dashboard/website/devices";
import { WebsiteKpis } from "@/components/dashboard/website/engagement-metrics";
import { NewVsReturning } from "@/components/dashboard/website/new-vs-returning";
import { SessionsTrend } from "@/components/dashboard/website/sessions-trend";
import { TopPages } from "@/components/dashboard/website/top-pages";
import { TrafficSources } from "@/components/dashboard/website/traffic-sources";
import { PageHeader } from "@/components/ui/page-header";
import { buildActivityHeatmap } from "@/lib/dashboard/activity";
import { getDemoDashboard } from "@/lib/demo/data";

// Demo day x hour sessions (Monday-first, 4-week sums): evening peaks on
// weekdays, a flatter midday weekend and the classic Sunday-evening bump.
const DEMO_WEEKDAY = [6, 3, 2, 1, 1, 2, 5, 11, 16, 19, 20, 21, 22, 21, 20, 21, 24, 29, 36, 44, 48, 45, 33, 16];
const DEMO_WEEKEND = [9, 5, 3, 2, 1, 1, 3, 6, 11, 17, 22, 25, 26, 25, 23, 22, 23, 25, 28, 31, 32, 28, 20, 12];
const DEMO_ACTIVITY = [1.0, 1.12, 1.1, 0.98, 0.82, 0.7, 0.88].map((k, d) =>
  (d < 5 ? DEMO_WEEKDAY : DEMO_WEEKEND).map((v, h) =>
    Math.round(v * k * 6 * (d === 6 && h >= 19 && h <= 22 ? 1.4 : 1) + ((d * 7 + h * 3) % 5))
  )
);

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
  const totalSessions = w.sessionsTrend.reduce((a, p) => a + p.sessions, 0);
  // Fragment on purpose: the demo layout's <main> holds the sections
  // directly, so each one is a presentation-mode slide.
  return (
    <>
      <PageHeader
        title={en ? "Website" : "Strona internetowa"}
        description={
          en
            ? `Who visits your website, where they come from and what they read - ${d.rangeLabel.toLowerCase()}.`
            : `Kto odwiedza Twoją stronę, skąd przychodzi i co ogląda - ${d.rangeLabel.toLowerCase()}.`
        }
      />

      <WebsiteKpis
        engagement={w.engagement}
        totalSessions={totalSessions}
        periodLabel={en ? "in the last 30 days" : "w ostatnich 30 dniach"}
        lang={lang}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <TrafficSources sources={w.sources} lang={lang} />
        <TopPages pages={w.topPages} lang={lang} />
      </div>

      <DetailsDisclosure
        storageKey="pato:details:witryna"
        openLabel={en ? "Show details" : undefined}
        closeLabel={en ? "Hide details" : undefined}
        summary={
          en
            ? "Devices, new vs returning, daily visits"
            : "Urządzenia, nowi i powracający, wizyty dzień po dniu, godziny aktywności i kim są odbiorcy"
        }
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <Devices devices={w.devices} lang={lang} />
          <NewVsReturning data={w.newVsReturning} lang={lang} />
        </div>
        <SessionsTrend trend={w.sessionsTrend} lang={lang} />
        {en ? null : <ActivityHeatmap data={buildActivityHeatmap(DEMO_ACTIVITY)} />}
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
      </DetailsDisclosure>
    </>
  );
}
