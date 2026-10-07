import { Snowfall } from "@/components/dashboard/season/festive";
import { BudgetPageView } from "@/components/dashboard/season/budget-page";
import { budgetForView } from "@/lib/season/budget-view";
import { getDemoSeasonView } from "@/lib/demo/season";

export const dynamic = "force-dynamic";

const ISO_DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Demo of "Budżet sezonu": last season's spend + 10% as this season's budget. */
export default function DemoSeasonBudgetPage({ searchParams }: { searchParams: { dzien?: string } }) {
  const day = searchParams.dzien && ISO_DAY.test(searchParams.dzien) ? searchParams.dzien : undefined;
  const view = getDemoSeasonView(day);
  // A round figure near last season's spend, like an agency would set it.
  const total = Math.round((view.prevFull.spend * 1.1) / 10_000_000) * 10_000_000 || 100_000_000;
  const budget = budgetForView(view, { total });
  return (
    <>
      {view.state.phase === "in" ? <Snowfall /> : null}
      <BudgetPageView
        budget={budget}
        seasonLabel={`Sezon ${view.state.current.year}`}
        base="/demo-full/sezon"
        isAgency={false}
        eyebrowExtra=" · dane przykładowe"
      />
    </>
  );
}
