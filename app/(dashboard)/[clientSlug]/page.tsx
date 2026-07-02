import { redirect } from "next/navigation";

import { AiChat } from "@/components/dashboard/ai-chat";
import { CampaignsTable } from "@/components/dashboard/campaigns-table";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { getDashboardData } from "@/lib/dashboard/metrics";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ClientDashboardPage({
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

  const { kpis, trend, campaigns } = await getDashboardData(client.id);

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-xl font-semibold">Dashboard {client.name}</h1>

      <KpiCards kpis={kpis} />

      <TrendChart trend={trend} />

      <AiChat clientSlug={params.clientSlug} />

      <CampaignsTable campaigns={campaigns} />
    </div>
  );
}
