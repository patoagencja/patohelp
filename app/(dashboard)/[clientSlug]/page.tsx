import { redirect } from "next/navigation";

import { AiSummaryCard } from "@/components/dashboard/ai-summary-card";
import { AlertsPanel } from "@/components/dashboard/alerts-panel";
import { BudgetProgress } from "@/components/dashboard/budget-progress";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { MainChart } from "@/components/dashboard/main-chart";
import { getDashboardData, normalizeRange } from "@/lib/dashboard/metrics";
import {
  getActiveAlerts,
  getBudgetStatus,
  getEvents,
  getLatestSummary,
} from "@/lib/dashboard/overview";
import { createClient } from "@/lib/supabase/server";
import { isAgencyUser, type UserRole } from "@/lib/types";

import { dismissAlert, setMonthlyBudget } from "./actions";

export const dynamic = "force-dynamic";

export default async function OverviewPage({
  params,
  searchParams,
}: {
  params: { clientSlug: string };
  searchParams: { range?: string };
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

  const { data: profile } = user
    ? await supabase.from("users").select("role").eq("id", user.id).single()
    : { data: null };
  const isAgency = profile ? isAgencyUser(profile.role as UserRole) : false;

  const range = normalizeRange(searchParams.range);
  const data = await getDashboardData(client.id, range);
  const [budget, alerts, summary, events] = await Promise.all([
    getBudgetStatus(client.id),
    getActiveAlerts(client.id),
    getLatestSummary(client.id),
    getEvents(client.id, data.rangeStart, data.rangeEnd),
  ]);

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

      <AiSummaryCard summary={summary} />

      <KpiCards kpis={data.kpis} />

      <BudgetProgress
        budget={budget}
        clientSlug={params.clientSlug}
        isAgency={isAgency}
        setBudgetAction={setMonthlyBudget}
      />

      <MainChart trend={data.trend} events={events} label={data.rangeLabel} />

      <AlertsPanel
        alerts={alerts}
        clientSlug={params.clientSlug}
        isAgency={isAgency}
        dismissAction={dismissAlert}
      />
    </div>
  );
}
