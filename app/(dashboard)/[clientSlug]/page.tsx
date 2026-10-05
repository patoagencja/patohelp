import { redirect } from "next/navigation";

import { AiSummaryCard } from "@/components/dashboard/ai-summary-card";
import { AlertsDigest } from "@/components/dashboard/alerts-digest";
import { BudgetProgress } from "@/components/dashboard/budget-progress";
import { CampaignRings } from "@/components/dashboard/campaign-rings";
import { DailyScoreCard } from "@/components/dashboard/daily-score";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { EcommerceKpis } from "@/components/dashboard/ecommerce-kpis";
import { MonthPacingCard } from "@/components/dashboard/ecom/month-pacing-card";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { MainChart } from "@/components/dashboard/main-chart";
import { TickerBar } from "@/components/dashboard/ticker-bar";
import { detectAnomalies, type Anomaly } from "@/lib/alerts/anomalies";
import { detectBudgetSpikes, type BudgetConfig } from "@/lib/alerts/budget";
import { getPacing, type PacingFlight } from "@/lib/alerts/pacing";
import {
  getDashboardData,
  normalizeRange,
  parseCustomRange,
} from "@/lib/dashboard/metrics";
import {
  getBudgetStatus,
  getEvents,
  getLatestSummary,
} from "@/lib/dashboard/overview";
import { getClientBySlug, getViewer } from "@/lib/dashboard/context";
import { getDailyScore } from "@/lib/dashboard/score";
import { getMonthPacing } from "@/lib/ecom/insights";
import { createAdminClient } from "@/lib/supabase/admin";

import { setMonthlyBudget } from "./actions";

export const dynamic = "force-dynamic";

export default async function OverviewPage({
  params,
  searchParams,
}: {
  params: { clientSlug: string };
  searchParams: { range?: string; from?: string; to?: string };
}) {
  const [viewer, client] = await Promise.all([
    getViewer(),
    getClientBySlug(params.clientSlug),
  ]);
  if (!client) {
    redirect("/login");
  }
  const isAgency = viewer.isAgency;
  const clientType = client.clientType;

  const range = normalizeRange(searchParams.range);
  const custom = parseCustomRange(searchParams.from, searchParams.to);

  // Campaign rings (gamification) are DRE-only for now.
  const isDre = params.clientSlug === "dre";

  // Live anomaly digest (same engine as the Alerty tab): budget spikes first.
  // The spike detector needs the client's caps, so chain just those two.
  const spikesPromise = createAdminClient()
    .from("notification_settings")
    .select(
      "daily_spend_cap_minor_units, account_daily_spend_cap_minor_units, spike_multiplier"
    )
    .eq("client_id", client.id)
    .maybeSingle()
    .then(({ data: notif }) => {
      const budgetConfig: BudgetConfig = {
        campaignCap: (notif?.daily_spend_cap_minor_units as number | null) ?? null,
        accountCap:
          (notif?.account_daily_spend_cap_minor_units as number | null) ?? null,
        multiplier:
          notif?.spike_multiplier && Number(notif.spike_multiplier) > 0
            ? Number(notif.spike_multiplier)
            : 3,
      };
      return detectBudgetSpikes(client.id, undefined, budgetConfig);
    });

  const data = await getDashboardData(client.id, range, custom);

  const [budget, summary, events, spikes, anomalies, pacing, score, monthPacing] =
    await Promise.all([
      getBudgetStatus(client.id),
      getLatestSummary(client.id),
      getEvents(client.id, data.rangeStart, data.rangeEnd),
      spikesPromise,
      detectAnomalies(client.id),
      isDre ? getPacing(client.id) : Promise.resolve([] as PacingFlight[]),
      getDailyScore(client.id),
      // E-commerce: "where will this month land" belongs on the first screen.
      clientType === "ecommerce" ? getMonthPacing(client.id) : Promise.resolve(null),
    ]);
  const digest: Anomaly[] = [...spikes, ...anomalies];

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cześć 👋</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Przegląd kampanii {client.name}
          </p>
        </div>
        <DateRangePicker
          value={range}
          customFrom={custom?.start}
          customTo={custom?.end}
        />
      </div>

      {score ? <DailyScoreCard data={score} /> : null}

      <TickerBar campaigns={data.campaigns} />

      {isDre && pacing.length > 0 ? <CampaignRings flights={pacing} /> : null}

      {/* GA-style: the big picture first, details below. */}
      <MainChart trend={data.trend} events={events} label={data.rangeLabel} />

      {monthPacing ? (
        <MonthPacingCard
          pacing={monthPacing}
          clientSlug={params.clientSlug}
          isAgency={isAgency}
        />
      ) : null}

      {clientType === "ecommerce" ? (
        <EcommerceKpis data={data.ecommerce} />
      ) : null}

      <KpiCards kpis={data.kpis} trend={data.trend} />

      <BudgetProgress
        budget={budget}
        clientSlug={params.clientSlug}
        isAgency={isAgency}
        setBudgetAction={setMonthlyBudget}
      />

      <AlertsDigest alerts={digest} clientSlug={params.clientSlug} />

      <AiSummaryCard summary={summary} />
    </div>
  );
}
