import { SeasonPageView } from "@/components/dashboard/season/season-page";
import { getDemoSeasonView } from "@/lib/demo/season";

export const dynamic = "force-dynamic";

const ISO_DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Demo of the season page (synthetic gift shop, 7 markets). `?dzien=` pins
 * "today" so a pitch can show any moment of the season - the 5 December
 * peak, the last days before Christmas Eve - not just the real date.
 */
export default function DemoSeasonPage({
  searchParams,
}: {
  searchParams: { dzien?: string };
}) {
  const day = searchParams.dzien && ISO_DAY.test(searchParams.dzien) ? searchParams.dzien : undefined;
  return (
    <SeasonPageView
      view={getDemoSeasonView(day)}
      showRevenue
      isAgency={false}
      eyebrowExtra=" · dane przykładowe"
    />
  );
}
