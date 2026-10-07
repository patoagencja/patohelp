import { AbPageView } from "@/components/dashboard/ab/ab-page";
import { parseAbWindow } from "@/components/dashboard/ab/ab-window";
import { AdsSectionTabs } from "@/components/dashboard/section-tabs";
import { getDemoAbView } from "@/lib/demo/ab";

export const dynamic = "force-dynamic";

const ISO_DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Demo of "Testy kreacji" (the Santa video shop from /demo-full/sezon, ad
 * by ad). `?dzien=` pins "today" like the season demo, e.g. 2025-12-05 for
 * the Mikołajki peak; `?okno=` picks the window.
 */
export default function DemoCreativeTests({
  searchParams,
}: {
  searchParams: { okno?: string; dzien?: string };
}) {
  const day = searchParams.dzien && ISO_DAY.test(searchParams.dzien) ? searchParams.dzien : undefined;
  const windowKey = parseAbWindow(searchParams.okno, true);
  return (
    <AbPageView
      view={getDemoAbView(windowKey, day)}
      path="/demo-full/kreacje/testy"
      keep={day ? { dzien: day } : {}}
      seasonAllowed
      tabs={<AdsSectionTabs base="/demo-full" active="testy" showTests />}
      kickerExtra=" · dane przykładowe"
    />
  );
}
