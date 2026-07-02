import { redirect } from "next/navigation";

import { KpiCards } from "@/components/dashboard/kpi-cards";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { getDashboardData } from "@/lib/dashboard/metrics";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OverviewPage({
  params,
}: {
  params: { clientSlug: string };
}) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("slug", params.clientSlug)
    .single();

  if (!client) {
    redirect("/login");
  }

  const { kpis, trend } = await getDashboardData(client.id);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Cześć 👋
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Przegląd kampanii {client.name}
          {user?.email ? ` · ${user.email}` : ""}
        </p>
      </div>
      <KpiCards kpis={kpis} />
      <TrendChart trend={trend} />
    </div>
  );
}
