import { Suspense } from "react";
import { redirect } from "next/navigation";

import {
  AddActivityButton,
  AgencyActivity,
} from "@/components/dashboard/agency-activity";
import { DailyScoreCard } from "@/components/dashboard/daily-score";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { LiveGoalTiles } from "@/components/dashboard/goal-tiles-live";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { OverviewDetails } from "@/components/dashboard/overview-details";
import { OverviewMetrics } from "@/components/dashboard/overview-metrics";
import { OverviewAiCard } from "@/components/dashboard/overview-ai-card";
import {
  aiSummaryForCard,
  AlertLine,
  attentionOf,
  GoodNews,
  OverviewSummary,
  StatusPill,
} from "@/components/dashboard/overview-summary";
import { buildPlanRows, PlanCard } from "@/components/dashboard/plan-card";
import { PresentStory } from "@/components/dashboard/present-story";
import { PrintHeader } from "@/components/dashboard/print-button";
import {
  preloadRecords,
  RecordsSection,
} from "@/components/dashboard/records-section";
import { SectionBoundary } from "@/components/dashboard/section-boundary";
import { SeasonOverviewCard } from "@/components/dashboard/season/season-overview-card";
import { TopCampaigns } from "@/components/dashboard/top-campaigns";
import type { Anomaly } from "@/lib/alerts/anomalies";
import { getCurrentAlerts } from "@/lib/alerts/current";
import { getPacing, type PacingFlight } from "@/lib/alerts/pacing";
import type { GlossaryKey } from "@/lib/dashboard/glossary";
import {
  loadDashboardData,
  normalizeRange,
  parseCustomRange,
  resolveDashboardRange,
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
import { buildStory, overviewStatus, type Story } from "@/lib/dashboard/story";
import { loadEngagementYoY } from "@/lib/dashboard/yoy";
import { buildHero, heroKicker } from "@/lib/dashboard/hero";
import { buildQuickAnswers } from "@/lib/dashboard/quick-answers";
import type { PlanRow } from "@/components/dashboard/plan-card";
import type { AiSummary } from "@/lib/dashboard/overview";
import { getMonthPacing } from "@/lib/ecom/insights";

import { setMonthlyBudget } from "./actions";

export const dynamic = "force-dynamic";

export default async function OverviewPage({
  params,
  searchParams,
}: {
  params: { clientSlug: string };
  searchParams: { range?: string; from?: string; to?: string };
}) {
  // Every query below needs only the client row (one round trip); the
  // viewer's role (auth -> users, two trips) just decides what to render, so
  // it finishes alongside the data instead of gating it.
  const viewerPromise = getViewer();
  // Awaited below; this only stops Node flagging an early rejection.
  viewerPromise.catch(() => {});
  const client = await getClientBySlug(params.clientSlug);
  if (!client) {
    redirect("/login");
  }
  const clientType = client.clientType;

  const range = normalizeRange(searchParams.range);
  const custom = parseCustomRange(searchParams.from, searchParams.to);
  // The window getDashboardData will read - known up front, so events and
  // YoY needn't wait for the dashboard data to learn it.
  const period = resolveDashboardRange(range, custom);

  // Records stream in below the hero; start the (possibly cold) history scan
  // now rather than when React first reaches the section.
  preloadRecords(client.id, clientType === "ecommerce");

  // Campaign rings (gamification) are DRE-only for now.
  const isDre = params.clientSlug === "dre";

  // Live anomaly digest (same engine as the Alerty tab): budget spikes first.
  // The very scan the header bell counts (getCurrentAlerts is request-cached
  // and shared across requests until the next sync) - the overview used to
  // run its own identical copy alongside the bell's.
  const anomaliesPromise: Promise<Anomaly[]> = getCurrentAlerts(client.id);
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

  const [
    data,
    [budget, summary, pacing, score, monthPacing],
    events,
    agencyWork,
    yoy,
    engagementGoals,
    viewer,
  ] = await Promise.all([
    loadDashboardData(client.id, range, custom?.start ?? null, custom?.end ?? null),
    sidePromise,
    getEvents(client.id, period.start, period.end),
    // A failed read just hides the "Co dla Ciebie zrobiliśmy" card.
    getRecentAgencyWork(client.id).catch(() => undefined),
    // Same window a year earlier; null (no lines, no option) on any error.
    loadEngagementYoY(client.id, period.start, period.end),
    goalsPromise,
    viewerPromise,
  ]);
  const isAgency = viewer.isAgency;

  const isEcommerce = clientType === "ecommerce";
  const story = buildStory({
    kpis: data.kpis,
    trend: data.trend,
    ecommerce: isEcommerce ? data.ecommerce : null,
    includeSpend: true,
    yoy,
  });
  // Everything "are we on plan?" in one card; DRE's campaign flights too.
  const planRows = buildPlanRows({
    budget,
    goals: engagementGoals,
    monthPacing,
    flights: isDre ? pacing : [],
  });
  const showPlan = planRows.length > 0 || isAgency;
  // The details' metric tiles only add what the KPI tiles above don't show.
  const shownMetrics = story.facts
    .map((f) => f.key)
    .filter((k): k is GlossaryKey => ["spend", "clicks", "sessions", "cpc"].includes(k));

  const hero = buildHero({ kpis: data.kpis, ecommerce: isEcommerce ? data.ecommerce : null });

  // Order (same as app/demo-full/page.tsx - keep in sync): hero (number,
  // sentence, status, range | AI card) -> KPI tiles + chart -> plan |
  // campaigns -> one "Pokaż szczegóły". Top-level children stay flat
  // siblings: presentation mode turns each into one slide. Each section has
  // its own boundary: one widget choking on odd data must not blank the page.
  return (
    <div className="space-y-8 px-4 py-6 sm:px-6 md:py-8">
      <PrintHeader
        clientName={client.name}
        periodLabel={data.rangeLabel}
        clientSlug={params.clientSlug}
        logoUrl={client.logoUrl}
      />
      {/* The top bar names the page; the heading stays for screen readers. */}
      <h1 className="sr-only">Przegląd - {client.name}</h1>

      {/* "Prezentuj" opens on these story slides (hidden otherwise). */}
      <PresentStory kpis={data.kpis} story={story} planRows={planRows} work={agencyWork?.entries} />

      {/* Seasonal clients only (one cached read for the rest): streams in. */}
      <SectionBoundary name="overview/season">
        <SeasonOverviewCard
          clientId={client.id}
          clientSlug={params.clientSlug}
          showRevenue={client.clientType === "ecommerce"}
        />
      </SectionBoundary>

      <SectionBoundary name="overview/summary">
        <OverviewSummary
          story={story}
          periodLabel={data.rangeLabel}
          aiSummary={summary}
          hero={hero}
          // The period's own month: "Poprzedni miesiąc" opened in October
          // read "Październik 2026 · poprzedni miesiąc".
          kicker={heroKicker(data.rangeEnd, data.rangeLabel)}
          range={
            <DateRangePicker
              value={range}
              customFrom={custom?.start}
              customTo={custom?.end}
              align="start"
              size="lg"
            />
          }
          // Anomaly detection scans weeks of rows - stream the status in.
          status={
            <Suspense fallback={<StatusPill status={null} />}>
              <LiveStatus story={story} alerts={anomaliesPromise} />
            </Suspense>
          }
          alert={
            <Suspense fallback={null}>
              <LiveAlertLine alerts={anomaliesPromise} href={`/${params.clientSlug}/alerty`} />
            </Suspense>
          }
          // The "Co jest do sprawdzenia?" chip needs the alerts: the card
          // streams in with them, without that chip until then.
          ai={
            <Suspense
              fallback={
                <OverviewAiCard
                  className="w-full"
                  summary={aiSummaryForCard(summary)}
                  questions={buildQuickAnswers({ story, planRows, alerts: null })}
                />
              }
            >
              <LiveAiCard story={story} planRows={planRows} summary={summary} alerts={anomaliesPromise} />
            </Suspense>
          }
        />
      </SectionBoundary>

      <SectionBoundary name="overview/metrics">
        <OverviewMetrics
          facts={story.facts}
          periodLabel={data.rangeLabel}
          comparable={data.comparable !== false}
          trend={data.trend}
          prevTrend={data.prevTrend}
          events={events}
          autoEvents={data.autoEvents}
          yoy={yoy}
          forecast
          // Running campaign goals as tiles under the KPI row (streams in).
          afterTiles={
            <SectionBoundary name="overview/goal-tiles">
              <Suspense fallback={null}>
                <LiveGoalTiles clientId={client.id} baseHref={`/${params.clientSlug}/alerty`} />
              </Suspense>
            </SectionBoundary>
          }
        />
      </SectionBoundary>

      {/* Plan + where the money goes, side by side (one slide). */}
      <div className="flex flex-wrap items-stretch gap-6">
        {showPlan ? (
          <SectionBoundary name="overview/plan">
            <PlanCard
              rows={planRows}
              budget={budget}
              clientSlug={params.clientSlug}
              isAgency={isAgency}
              setBudgetAction={setMonthlyBudget}
              showGoalsLink={!isEcommerce}
              className="min-w-0 flex-[1_1_22rem] animate-rise [--d:.85s]"
            />
          </SectionBoundary>
        ) : null}
        <div className="flex min-w-0 flex-[1.7_1_34rem] animate-rise [--d:1s] [&>section]:w-full">
          <SectionBoundary name="overview/campaigns">
            <TopCampaigns campaigns={data.campaigns} allHref={`/${params.clientSlug}/reklamy`} />
          </SectionBoundary>
        </div>
      </div>

      <OverviewDetails summary="Dobre wiadomości, rekordy, pozostałe wskaźniki, ocena dnia i co dla Ciebie zrobiliśmy.">
        <SectionBoundary name="overview/good-news">
          <GoodNews story={story} />
        </SectionBoundary>
        {/* History scan is cached but can be cold - never hold the page. */}
        <SectionBoundary name="overview/records">
          <Suspense fallback={null}>
            <RecordsSection clientId={client.id} ecommerce={isEcommerce} />
          </Suspense>
        </SectionBoundary>
        <SectionBoundary name="overview/kpis">
          <KpiCards
            kpis={data.kpis}
            trend={data.trend}
            periodLabel={data.rangeLabel}
            exclude={shownMetrics}
          />
        </SectionBoundary>
        {score ? (
          <SectionBoundary name="overview/score">
            <DailyScoreCard data={score} compact />
          </SectionBoundary>
        ) : null}
        {/* Anchor: the agency to-do list deep-links here; it opens the
            details on arrival. */}
        <div id="dzialania" className="scroll-mt-24">
          <SectionBoundary name="overview/agency-activity">
            <AgencyActivity
              work={agencyWork}
              autoEvents={data.autoEvents}
              isAgency={isAgency}
              clientSlug={params.clientSlug}
              action={isAgency ? <AddActivityButton clientSlug={params.clientSlug} /> : undefined}
            />
          </SectionBoundary>
        </div>
      </OverviewDetails>
    </div>
  );
}

async function LiveAiCard({
  story,
  planRows,
  summary,
  alerts,
}: {
  story: Story;
  planRows: PlanRow[];
  summary: AiSummary | null;
  alerts: Promise<Anomaly[]>;
}) {
  // A failed scan just leaves the alerts chip out.
  const list = await alerts.catch(() => null);
  return (
    <OverviewAiCard
      className="w-full"
      summary={aiSummaryForCard(summary)}
      questions={buildQuickAnswers({ story, planRows, alerts: list })}
    />
  );
}

async function LiveStatus({ story, alerts }: { story: Story; alerts: Promise<Anomaly[]> }) {
  // A failed scan shouldn't claim "all good" - fall back to the verdict only.
  const list = await alerts.catch(() => null);
  return <StatusPill status={overviewStatus(story, list ? attentionOf(list) : null)} />;
}

async function LiveAlertLine({ alerts, href }: { alerts: Promise<Anomaly[]>; href: string }) {
  const list = await alerts.catch(() => [] as Anomaly[]);
  return <AlertLine alerts={list} href={href} />;
}
