import { redirect } from "next/navigation";

import { BudgetPageView } from "@/components/dashboard/season/budget-page";
import { getClientBySlug, getViewer } from "@/lib/dashboard/context";
import { budgetForView } from "@/lib/season/budget-view";
import { getClientSeason, getClientSeasonBudget, loadSeasonView } from "@/lib/season/load";

export const dynamic = "force-dynamic";

export default async function SeasonBudgetPage({ params }: { params: { clientSlug: string } }) {
  const [client, viewer] = await Promise.all([getClientBySlug(params.clientSlug), getViewer()]);
  if (!client) redirect("/login");
  const [season, budgetCfg] = await Promise.all([getClientSeason(client.id), getClientSeasonBudget(client.id)]);
  // The Sezon tab explains how to switch a season on; nothing to plan without one.
  if (!season) redirect(`/${params.clientSlug}/sezon`);

  const view = await loadSeasonView(client.id, season);
  const budget = budgetCfg ? budgetForView(view, budgetCfg) : null;
  return (
    <BudgetPageView
      budget={budget}
      seasonLabel={`Sezon ${view.state.phase === "pre" ? view.state.next?.year ?? "" : view.state.current.year}`}
      base={`/${params.clientSlug}/sezon`}
      isAgency={viewer.isAgency}
      settingsHref={`/${params.clientSlug}/settings#sezon`}
    />
  );
}
