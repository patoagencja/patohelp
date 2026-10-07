import { redirect } from "next/navigation";

import { MarketsPageView } from "@/components/dashboard/season/markets-page";
import { getClientBySlug } from "@/lib/dashboard/context";
import { getClientSeason, loadSeasonView } from "@/lib/season/load";

export const dynamic = "force-dynamic";

export default async function SeasonMarketsPage({ params }: { params: { clientSlug: string } }) {
  const client = await getClientBySlug(params.clientSlug);
  if (!client) redirect("/login");
  const season = await getClientSeason(client.id);
  if (!season) redirect(`/${params.clientSlug}/sezon`);
  const view = await loadSeasonView(client.id, season);
  return (
    <MarketsPageView
      view={view}
      showRevenue={client.clientType === "ecommerce"}
      base={`/${params.clientSlug}/sezon`}
    />
  );
}
