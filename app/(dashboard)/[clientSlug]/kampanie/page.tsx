import { redirect } from "next/navigation";

import { CampaignsTable } from "@/components/dashboard/campaigns-table";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { getDashboardData, normalizeRange } from "@/lib/dashboard/metrics";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CampaignsPage({
  params,
  searchParams,
}: {
  params: { clientSlug: string };
  searchParams: { range?: string };
}) {
  const supabase = createClient();

  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("slug", params.clientSlug)
    .single();

  if (!client) {
    redirect("/login");
  }

  const range = normalizeRange(searchParams.range);
  const { campaigns } = await getDashboardData(client.id, range);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Kampanie — {client.name}</h1>
        <DateRangePicker value={range} />
      </div>
      <CampaignsTable campaigns={campaigns} />
    </div>
  );
}
