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
// The days follow the shop's week (lib/demo/ecom.ts: boxes are ordered
// Sunday to Tuesday, Friday and Saturday are quiet) - the heatmap used to
// crown Tuesday and Wednesday next to an AI analysis praising Sundays and
// Mondays - and the grid adds up to the last four weeks of visits.
const DEMO_WEEKDAY = [6, 3, 2, 1, 1, 2, 5, 11, 16, 19, 20, 21, 22, 21, 20, 21, 24, 29, 36, 44, 48, 45, 33, 16];
const DEMO_WEEKEND = [9, 5, 3, 2, 1, 1, 3, 6, 11, 17, 22, 25, 26, 25, 23, 22, 23, 25, 28, 31, 32, 28, 20, 12];
const DEMO_DAY_WEIGHT = [1.08, 1.04, 1.0, 0.97, 0.9, 0.86, 1.12]; // Mon..Sun

function demoActivity(fourWeekSessions: number): number[][] {
  const shape = DEMO_DAY_WEIGHT.map((k, d) =>
    (d < 5 ? DEMO_WEEKDAY : DEMO_WEEKEND).map(
      (v, h) => v * k * (d === 6 && h >= 19 && h <= 22 ? 1.4 : 1) * (1 + (((d * 7 + h * 3) % 5) - 2) * 0.02)
    )
  );
  const total = shape.flat().reduce((a, v) => a + v, 0) || 1;
  return shape.map((row) => row.map((v) => Math.round((v * fourWeekSessions) / total)));
}

// Meta audience shares (age, gender) and the regions visits come from.
const AGE_SHARES: Array<[string, number]> = [
  ["18-24", 0.085], ["25-34", 0.287], ["35-44", 0.257], ["45-54", 0.188], ["55-64", 0.118], ["65+", 0.065],
];
const GEO_SHARES: Array<[string, number]> = [
  ["Masovian Voivodeship", 0.25],
  ["Silesian Voivodeship", 0.15],
  ["Lesser Poland Voivodeship", 0.118],
  ["Greater Poland Voivodeship", 0.107],
  ["Lower Silesian Voivodeship", 0.086],
  ["Pomeranian Voivodeship", 0.068],
];

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
  // The last 28 complete days (today is partial), like the live snapshot.
  const fourWeeks = w.sessionsTrend.slice(-29, -1).reduce((a, p) => a + p.sessions, 0);
  // People reached on Meta: its impressions over a typical ~2.4 frequency.
  const metaReach = Math.round(
    d.campaigns.filter((c) => c.provider === "meta_ads").reduce((a, c) => a + c.impressions, 0) / 2.4
  );
  // Fragment on purpose: the demo layout's <main> holds the sections
  // directly, so each one is a presentation-mode slide.
  return (
    <>
      <PageHeader
        eyebrow={<span className="kick">{en ? "Website" : "Strona www"} · {d.rangeLabel}</span>}
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
        sessionsSeries={w.sessionsTrend.map((p) => p.sessions)}
        periodLabel={en ? "in the last 30 days" : "w ostatnich 30 dniach"}
        lang={lang}
      />

      {/* Full-width, one after the other (Strona-www board). */}
      <TrafficSources sources={w.sources} lang={lang} />
      <TopPages
        pages={w.topPages}
        lang={lang}
        exportScope={{
          client: "demo",
          from: w.sessionsTrend[0]?.date ?? null,
          to: w.sessionsTrend[w.sessionsTrend.length - 1]?.date ?? null,
        }}
      />

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
        {en ? null : <ActivityHeatmap data={buildActivityHeatmap(demoActivity(fourWeeks))} />}
        {en ? null : (
          <Audience
            data={{
              hasData: true,
              ageSource: "meta",
              genderSource: "meta",
              age: AGE_SHARES.map(([bucket, share]) => ({ bucket, value: Math.round(metaReach * share) })),
              gender: [
                { bucket: "female", value: Math.round(metaReach * 0.57) },
                { bucket: "male", value: Math.round(metaReach * 0.43) },
              ],
              geo: GEO_SHARES.map(([bucket, share]) => ({ bucket, value: Math.round(totalSessions * share) })),
            }}
          />
        )}
      </DetailsDisclosure>
    </>
  );
}
