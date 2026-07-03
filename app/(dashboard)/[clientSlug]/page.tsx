import { redirect } from "next/navigation";

import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { getDashboardData, normalizeRange } from "@/lib/dashboard/metrics";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OverviewPage({
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
  const { kpis, trend, rangeLabel } = await getDashboardData(client.id, range);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cześć 👋</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Przegląd kampanii {client.name}
          </p>
        </div>
        <DateRangePicker value={range} />
      </div>

      <KpiCards kpis={kpis} />
      <TrendChart trend={trend} label={rangeLabel} />
    </div>
  );
}
