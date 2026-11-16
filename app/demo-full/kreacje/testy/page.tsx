import { AbPageView } from "@/components/dashboard/ab/ab-page";
import { parseAbWindow } from "@/components/dashboard/ab/ab-window";
import { AdsSectionTabs } from "@/components/dashboard/section-tabs";
import { getDemoAbView } from "@/lib/demo/ab";
import { loadDemoAbSeries } from "@/lib/demo/ab-actions";
import { getDemoSource } from "@/lib/demo/profile/store";

export const dynamic = "force-dynamic";

const ISO_DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Demo of "Testy kreacji": the demo shop's Meta ads, ad by ad, inside its
 * own Meta campaigns. The shop has no season, so - like a live client
 * without one - there is no "Cały sezon" period. `?dzien=` pins a past
 * "today"; `?okno=` picks the period.
 */
export default async function DemoCreativeTests({
  searchParams,
}: {
  searchParams: { okno?: string; dzien?: string };
}) {
  const day = searchParams.dzien && ISO_DAY.test(searchParams.dzien) ? searchParams.dzien : undefined;
  const windowKey = parseAbWindow(searchParams.okno, false);
  return (
    <AbPageView
      view={getDemoAbView(await getDemoSource(), windowKey, day)}
      path="/demo-full/kreacje/testy"
      keep={day ? { dzien: day } : {}}
      seasonAllowed={false}
      tabs={<AdsSectionTabs base="/demo-full" active="testy" showTests />}
      // Same shape as the live page's loadAbSeries, bound to the pinned day.
      loadSeries={loadDemoAbSeries.bind(null, day ?? "")}
      kickerExtra=" · dane przykładowe"
    />
  );
}
