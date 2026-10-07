import { redirect } from "next/navigation";

import { AbPageView } from "@/components/dashboard/ab/ab-page";
import { parseAbWindow } from "@/components/dashboard/ab/ab-window";
import { AdsSectionTabs } from "@/components/dashboard/section-tabs";
import { loadAbView } from "@/lib/ab/load";
import { getClientBySlug } from "@/lib/dashboard/context";
import { getClientSeason } from "@/lib/season/load";

export const dynamic = "force-dynamic";

export default async function CreativeTestsPage({
  params,
  searchParams = {},
}: {
  params: { clientSlug: string };
  searchParams?: { okno?: string; range?: string; from?: string; to?: string };
}) {
  const client = await getClientBySlug(params.clientSlug);
  if (!client) redirect("/login");

  const base = `/${params.clientSlug}`;
  // Tests are judged on purchases and sales value. Engagement clients have
  // neither and must never see ROAS (CLAUDE.md) - seasonal or not - so they
  // get Kreacje.
  if (client.clientType !== "ecommerce") redirect(`${base}/kreacje`);
  const season = await getClientSeason(client.id);

  const windowKey = parseAbWindow(searchParams.okno, season != null);
  const view = await loadAbView(client.id, windowKey);

  // The range chosen on Kampanie rides along, so the way back keeps it.
  const keep: Record<string, string> = {};
  if (searchParams.range) keep.range = searchParams.range;
  if (searchParams.from) keep.from = searchParams.from;
  if (searchParams.to) keep.to = searchParams.to;
  const query = Object.keys(keep).length ? `?${new URLSearchParams(keep).toString()}` : "";

  // Top-level children of the wrapper are the presentation slides.
  return (
    <div className="min-w-0 space-y-8 px-4 py-6 sm:px-6 md:py-8">
      <AbPageView
        view={view}
        path={`${base}/kreacje/testy`}
        keep={keep}
        seasonAllowed={season != null}
        tabs={<AdsSectionTabs base={base} active="testy" query={query} showTests />}
      />
    </div>
  );
}
