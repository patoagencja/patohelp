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
import { DEMO_AGE_SHARES, DEMO_FEMALE_SHARE, DEMO_REGION_SHARES } from "@/lib/demo/brand";
import { getDemoDashboard } from "@/lib/demo/data";
import { addDaysIso } from "@/lib/demo/profile/anonymize";
import { getDemoSource } from "@/lib/demo/profile/store";
import type { DemoSource } from "@/lib/demo/source";

// Demo day x hour sessions (Monday-first, 4-week sums): evening peaks on
// weekdays, a flatter midday weekend. The days' weights are the demo's own
// last four weeks by weekday, and the grid adds up to their visits.
const DEMO_WEEKDAY = [6, 3, 2, 1, 1, 2, 5, 11, 16, 19, 20, 21, 22, 21, 20, 21, 24, 29, 36, 44, 48, 45, 33, 16];
const DEMO_WEEKEND = [9, 5, 3, 2, 1, 1, 3, 6, 11, 17, 22, 25, 26, 25, 23, 22, 23, 25, 28, 31, 32, 28, 20, 12];

function demoActivity(src: DemoSource): number[][] {
  // The last 28 complete days, by weekday (Monday first).
  const byDay = new Array<number>(7).fill(0);
  for (let i = 1; i <= 28; i++) {
    const d = src.day(addDaysIso(src.today, -i));
    if (!d) continue;
    byDay[(new Date(`${d.date}T12:00:00Z`).getUTCDay() + 6) % 7] += d.sessions;
  }
  return byDay.map((sessions, d) => {
    const shape = (d < 5 ? DEMO_WEEKDAY : DEMO_WEEKEND).map((v, h) => v * (1 + (((d * 7 + h * 3) % 5) - 2) * 0.02));
    const sum = shape.reduce((a, v) => a + v, 0) || 1;
    return shape.map((v) => Math.round((v * sessions) / sum));
  });
}

export const dynamic = "force-dynamic";

export default async function DemoFullWitryna({
  searchParams,
}: {
  searchParams: { lang?: string };
}) {
  const lang = searchParams.lang === "en" ? "en" : "pl";
  const en = lang === "en";
  const src = await getDemoSource();
  const d = getDemoDashboard(src, lang);
  const w = d.website;
  const totalSessions = w.sessionsTrend.reduce((a, p) => a + p.sessions, 0);
  // People reached on Meta: its impressions over a typical ~2.4 frequency.
  const metaReach = Math.round(
    d.campaigns.filter((c) => c.provider === "meta_ads").reduce((a, c) => a + c.impressions, 0) / 2.4
  );
  // Visits by region: the Polish share of the shop's traffic, by voivodeship.
  const plShare = src.countries.find((c) => c.country === "PL")?.revenueShare ?? 1;
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
        {en ? null : <ActivityHeatmap data={buildActivityHeatmap(demoActivity(src))} />}
        {en ? null : (
          <Audience
            data={{
              hasData: true,
              ageSource: "meta",
              genderSource: "meta",
              age: DEMO_AGE_SHARES.map(([bucket, share]) => ({ bucket, value: Math.round(metaReach * share) })),
              gender: [
                { bucket: "female", value: Math.round(metaReach * DEMO_FEMALE_SHARE) },
                { bucket: "male", value: Math.round(metaReach * (1 - DEMO_FEMALE_SHARE)) },
              ],
              geo: DEMO_REGION_SHARES.map(([bucket, share]) => ({ bucket, value: Math.round(totalSessions * plShare * share) })),
            }}
          />
        )}
      </DetailsDisclosure>
    </>
  );
}
