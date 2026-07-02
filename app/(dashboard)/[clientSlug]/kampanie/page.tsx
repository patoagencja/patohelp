import { redirect } from "next/navigation";

import { CampaignsTable } from "@/components/dashboard/campaigns-table";
import { getDashboardData } from "@/lib/dashboard/metrics";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CampaignsPage({
  params,
}: {
  params: { clientSlug: string };
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

  const { campaigns } = await getDashboardData(client.id);

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-xl font-semibold">Kampanie — {client.name}</h1>
      <CampaignsTable campaigns={campaigns} />
    </div>
  );
}
