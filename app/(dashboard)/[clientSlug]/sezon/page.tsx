import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarRange } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { SeasonPageView } from "@/components/dashboard/season/season-page";
import { Button } from "@/components/ui/button";
import { getClientBySlug, getViewer } from "@/lib/dashboard/context";
import { getClientSeason, loadSeasonView } from "@/lib/season/load";

export const dynamic = "force-dynamic";

export default async function SeasonPage({ params }: { params: { clientSlug: string } }) {
  const [client, viewer] = await Promise.all([getClientBySlug(params.clientSlug), getViewer()]);
  if (!client) redirect("/login");

  const season = await getClientSeason(client.id);
  if (!season) {
    // Not a seasonal client: clients never see this tab; the agency gets
    // the one place to switch it on.
    if (!viewer.isAgency) redirect(`/${params.clientSlug}`);
    return (
      <div className="px-4 py-6 sm:px-6 md:py-8">
        <EmptyState
          icon={CalendarRange}
          title="Ten klient nie ma ustawionego sezonu"
          description="Widok sezonu jest dla klientów, którzy zarabiają w jednym okresie roku (np. październik - Wigilia). Ustaw okno sezonu w ustawieniach klienta."
          action={
            <Button asChild size="pill">
              <Link href={`/${params.clientSlug}/settings#sezon`}>Ustaw sezon</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const view = await loadSeasonView(client.id, season);
  return (
    <SeasonPageView
      view={view}
      showRevenue={client.clientType === "ecommerce"}
      isAgency={viewer.isAgency}
    />
  );
}
