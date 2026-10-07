import { Snowfall } from "@/components/dashboard/season/festive";
import { MarketsPageView } from "@/components/dashboard/season/markets-page";
import { getDemoSeasonView } from "@/lib/demo/season";

export const dynamic = "force-dynamic";

const ISO_DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Demo of "Rynki" (synthetic gift shop, 7 markets). */
export default function DemoSeasonMarketsPage({ searchParams }: { searchParams: { dzien?: string } }) {
  const day = searchParams.dzien && ISO_DAY.test(searchParams.dzien) ? searchParams.dzien : undefined;
  const view = getDemoSeasonView(day);
  return (
    <>
      {view.state.phase === "in" ? <Snowfall /> : null}
      <MarketsPageView view={view} showRevenue base="/demo-full/sezon" eyebrowExtra=" · dane przykładowe" />
    </>
  );
}
