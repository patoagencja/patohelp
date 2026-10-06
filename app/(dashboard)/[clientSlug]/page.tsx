import { Suspense } from "react";
import { redirect } from "next/navigation";

import {
  AddActivityButton,
  AgencyActivity,
} from "@/components/dashboard/agency-activity";
import { AlertsDigest } from "@/components/dashboard/alerts-digest";
import { BudgetProgress } from "@/components/dashboard/budget-progress";
import { CampaignRings } from "@/components/dashboard/campaign-rings";
import { DailyScoreCard } from "@/components/dashboard/daily-score";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { EcommerceKpis } from "@/components/dashboard/ecommerce-kpis";
import { MonthPacingCard } from "@/components/dashboard/ecom/month-pacing-card";
import { GoalsCard } from "@/components/dashboard/goals-card";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { MainChart } from "@/components/dashboard/main-chart";
import { PrintButton, PrintHeader } from "@/components/dashboard/print-button";
import { RecordsSection } from "@/components/dashboard/records-section";
import { SectionBoundary } from "@/components/dashboard/section-boundary";
import { StoryHero } from "@/components/dashboard/story-hero";
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
  getRecentAgencyWork,
} from "@/lib/dashboard/overview";
import { getClientBySlug, getViewer } from "@/lib/dashboard/context";
import { getDailyScore } from "@/lib/dashboard/score";
import { getEngagementGoals } from "@/lib/dashboard/goals";
import { buildStory } from "@/lib/dashboard/story";
import { getEngagementYoY } from "@/lib/dashboard/yoy";
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

  // Everything that doesn't need the range data starts now, alongside it,
  // instead of queueing behind getDashboardData.
  const anomaliesPromise = Promise.all([spikesPromise, detectAnomalies(client.id)]).then(
    ([spikes, anomalies]): Anomaly[] => [...spikes, ...anomalies]
  );
  // Rejections surface where the promise is awaited (inside Suspense); this
  // only stops Node from flagging it as unhandled while it waits.
  anomaliesPromise.catch(() => {});
  const sidePromise = Promise.all([
    getBudgetStatus(client.id),
    getLatestSummary(client.id),
    isDre ? getPacing(client.id) : Promise.resolve([] as PacingFlight[]),
    getDailyScore(client.id),
    // E-commerce: "where will this month land" belongs on the first screen.
    clientType === "ecommerce" ? getMonthPacing(client.id) : Promise.resolve(null),
  ]);
  // Engagement clients pace monthly goals instead (shops have revenue pacing).
  // A failed read just hides the card rather than failing the overview.
  const goalsPromise =
    clientType === "ecommerce"
      ? Promise.resolve([])
      : getEngagementGoals(client.id).catch(() => []);

  const data = await getDashboardData(client.id, range, custom);
  const [[budget, summary, pacing, score, monthPacing], events, agencyWork, yoy] =
    await Promise.all([
      sidePromise,
      getEvents(client.id, data.rangeStart, data.rangeEnd),
      // A failed read just hides the "Co dla Ciebie zrobiliśmy" card.
      getRecentAgencyWork(client.id).catch(() => undefined),
      // Same window a year earlier; null (no lines, no option) on any error.
      getEngagementYoY(client.id, data.rangeStart, data.rangeEnd),
    ]);
  const engagementGoals = await goalsPromise;

  return (
    <div className="space-y-6 p-6">
      <PrintHeader
        clientName={client.name}
        periodLabel={data.rangeLabel}
        clientSlug={params.clientSlug}
        logoUrl={client.logoUrl}
      />
      <div
        data-print-hide
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{greeting()}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Oto co słychać w kampaniach {client.name}.
          </p>
        </div>
        <div className="flex items-start gap-2">
          {isAgency ? <AddActivityButton clientSlug={params.clientSlug} /> : null}
          <PrintButton />
          <DateRangePicker
            value={range}
            customFrom={custom?.start}
            customTo={custom?.end}
          />
        </div>
      </div>

      {/* Each section gets its own boundary: one widget choking on odd data
          (or a streamed query failing) must not blank the whole overview.
          Order (same as app/demo-full/page.tsx - keep in sync): summary ->
          records & plan vs actual -> trend -> attention/what we did ->
          detailed metrics. Sections stay flat siblings: presentation mode
          turns each top-level child into one slide. */}

      {/* 1. Summary - the AI weekly commentary lives inside it, so the page
          has one summary instead of two saying the same in other words. */}
      <SectionBoundary name="overview/story">
        <StoryHero
          story={buildStory({
            kpis: data.kpis,
            trend: data.trend,
            ecommerce: clientType === "ecommerce" ? data.ecommerce : null,
            includeSpend: true,
            yoy,
          })}
          periodLabel={data.rangeLabel}
          aiSummary={summary}
        />
      </SectionBoundary>

      {/* 2. Records, then plan vs actual. History scan is cached but can be
          cold - never hold the page for it. */}
      <SectionBoundary name="overview/records">
        <Suspense fallback={null}>
          <RecordsSection clientId={client.id} ecommerce={clientType === "ecommerce"} />
        </Suspense>
      </SectionBoundary>

      {monthPacing ? (
        <SectionBoundary name="overview/month-pacing">
          <MonthPacingCard
            pacing={monthPacing}
            clientSlug={params.clientSlug}
            isAgency={isAgency}
          />
        </SectionBoundary>
      ) : null}

      {clientType !== "ecommerce" ? (
        <SectionBoundary name="overview/goals">
          <GoalsCard
            goals={engagementGoals}
            clientSlug={params.clientSlug}
            isAgency={isAgency}
          />
        </SectionBoundary>
      ) : null}

      <SectionBoundary name="overview/budget">
        <BudgetProgress
          budget={budget}
          clientSlug={params.clientSlug}
          isAgency={isAgency}
          setBudgetAction={setMonthlyBudget}
        />
      </SectionBoundary>

      {isDre && pacing.length > 0 ? (
        <SectionBoundary name="overview/rings">
          <CampaignRings flights={pacing} />
        </SectionBoundary>
      ) : null}

      {/* 3. GA-style: the big picture, then what needs attention and what
          the agency did about it. */}
      <SectionBoundary name="overview/main-chart">
        <MainChart
          trend={data.trend}
          prevTrend={data.prevTrend}
          events={events}
          autoEvents={data.autoEvents}
          yoy={yoy}
          label={data.rangeLabel}
        />
      </SectionBoundary>

      {/* Anomaly detection scans weeks of rows - stream it in. */}
      <SectionBoundary name="overview/alerts-digest">
        <Suspense fallback={null}>
          <DigestSection alerts={anomaliesPromise} clientSlug={params.clientSlug} />
        </Suspense>
      </SectionBoundary>

      <SectionBoundary name="overview/agency-activity">
        <AgencyActivity
          work={agencyWork}
          autoEvents={data.autoEvents}
          isAgency={isAgency}
          clientSlug={params.clientSlug}
        />
      </SectionBoundary>

      {/* 4. Details for the curious. The hero already carries the headline
          numbers; these tiles add the rest, each with its ⓘ definition. */}
      {clientType === "ecommerce" ? (
        <SectionBoundary name="overview/ecommerce-kpis">
          <EcommerceKpis data={data.ecommerce} />
        </SectionBoundary>
      ) : null}

      <SectionBoundary name="overview/kpis">
        <KpiCards kpis={data.kpis} trend={data.trend} periodLabel={data.rangeLabel} />
      </SectionBoundary>

      {score ? (
        <SectionBoundary name="overview/score">
          <DailyScoreCard data={score} compact />
        </SectionBoundary>
      ) : null}
    </div>
  );
}

async function DigestSection({
  alerts,
  clientSlug,
}: {
  alerts: Promise<Anomaly[]>;
  clientSlug: string;
}) {
  const list = await alerts.catch(() => [] as Anomaly[]);
  return <AlertsDigest alerts={list} clientSlug={clientSlug} />;
}

/** Time-of-day greeting in Warsaw - a small human touch on the first screen. */
function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat("pl-PL", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: "Europe/Warsaw",
    }).format(new Date())
  );
  if (hour >= 5 && hour < 18) return "Dzień dobry 👋";
  return "Dobry wieczór 👋";
}
