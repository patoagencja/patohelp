import { CalendarDays } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";

import { AgencyActivity } from "@/components/dashboard/agency-activity";
import { AiSummaryCard } from "@/components/dashboard/ai-summary-card";
import { BudgetProgress } from "@/components/dashboard/budget-progress";
import { CampaignPositions } from "@/components/dashboard/campaign-positions";
import { DailyScoreCard } from "@/components/dashboard/daily-score";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { MainChart } from "@/components/dashboard/main-chart";
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
import { PrintHeader } from "@/components/dashboard/print-button";
import { RecordsCard } from "@/components/dashboard/records-card";
import { TopCampaigns } from "@/components/dashboard/top-campaigns";
import { TopCreatives } from "@/components/dashboard/top-creatives";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { demoEngagementGoals } from "@/lib/dashboard/goals";
import { buildHero, heroKicker } from "@/lib/dashboard/hero";
import { buildQuickAnswers } from "@/lib/dashboard/quick-answers";
import type { GlossaryKey } from "@/lib/dashboard/glossary";
import { buildStory, overviewStatus } from "@/lib/dashboard/story";
import { demoEngagementYoY } from "@/lib/dashboard/yoy";
import { DEMO_BRANDING } from "@/lib/demo/branding";
import { getDemoDashboard } from "@/lib/demo/data";
import { getDemoRecords } from "@/lib/demo/records";

export const dynamic = "force-dynamic";

async function noop() {
  "use server";
}

const CLIENT = "lokalnepomidorki";

// Same section order as the real overview (app/(dashboard)/[clientSlug]/
// page.tsx) - keep the two in sync. Every top-level child is one slide in
// presentation mode, so sections stay flat siblings (no wrapper groups).
export default function DemoFullOverview({
  searchParams,
}: {
  searchParams: { lang?: string };
}) {
  const lang = searchParams.lang === "en" ? "en" : "pl";
  const d = getDemoDashboard(lang);
  const yoy = demoEngagementYoY(d.trend);
  // The demo has one fixed window, so the period is a label, not a picker.
  const period = (
    <Pill tone="neutral" className="min-h-11 gap-2 bg-chip px-4 text-sm text-ink-2 [&_svg]:size-4">
      <CalendarDays aria-hidden />
      {d.rangeLabel}
    </Pill>
  );

  if (lang === "en") return <EnglishOverview d={d} yoy={yoy} period={period} />;

  const story = buildStory({ kpis: d.kpis, trend: d.trend, includeSpend: true, yoy });
  const planRows = buildPlanRows({ budget: d.budget, goals: demoEngagementGoals() });
  const shownMetrics = story.facts
    .map((f) => f.key)
    .filter((k): k is GlossaryKey => ["spend", "clicks", "sessions", "cpc"].includes(k));
  const today = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");

  return (
    <>
      <PrintHeader clientName={CLIENT} periodLabel={d.rangeLabel} logoUrl={DEMO_BRANDING.logoUrl} />
      {/* The top bar names the page; the heading stays for screen readers. */}
      <h1 className="sr-only">Przegląd - {CLIENT}</h1>

      <OverviewSummary
        story={story}
        periodLabel={d.rangeLabel}
        aiSummary={d.summary}
        hero={buildHero({ kpis: d.kpis })}
        kicker={heroKicker(today, d.rangeLabel)}
        range={period}
        status={<StatusPill status={overviewStatus(story, attentionOf(d.alerts))} />}
        alert={<AlertLine alerts={d.alerts} href="/demo-full/alerty" />}
        ai={
          <OverviewAiCard
            className="w-full"
            summary={aiSummaryForCard(d.summary)}
            questions={buildQuickAnswers({ story, planRows, alerts: d.alerts })}
          />
        }
      />

      <OverviewMetrics
        facts={story.facts}
        periodLabel={d.rangeLabel}
        trend={d.trend}
        events={[]}
        yoy={yoy}
        demo
        forecast
      />

      {/* Plan + where the money goes, side by side (one slide). */}
      <div className="flex flex-wrap items-stretch gap-6">
        {planRows.length > 0 ? (
          <PlanCard
            rows={planRows}
            clientSlug="demo-full"
            isAgency={false}
            className="min-w-0 flex-[1_1_22rem] animate-rise [--d:.85s]"
          />
        ) : null}
        <div className="flex min-w-0 flex-[1.7_1_34rem] animate-rise [--d:1s] [&>section]:w-full">
          <TopCampaigns campaigns={d.campaigns} allHref="/demo-full/reklamy" />
        </div>
      </div>

      <OverviewDetails summary="Dobre wiadomości, rekordy, pozostałe wskaźniki, ocena dnia, co dla Ciebie zrobiliśmy i najlepsze reklamy.">
        <GoodNews story={story} />
        <RecordsCard records={getDemoRecords({ ecommerce: false })} />
        <KpiCards
          kpis={d.kpis}
          trend={d.trend}
          periodLabel={d.rangeLabel}
          exclude={shownMetrics}
        />
        <DailyScoreCard data={d.score} compact />
        <div id="dzialania" className="scroll-mt-24">
          <AgencyActivity demo isAgency={false} clientSlug="demo-full" />
        </div>
        <TopCreatives creatives={d.creatives} />
      </OverviewDetails>
    </>
  );
}

/**
 * English demo: the plain-language story (and its tiles) is Polish-only, so
 * prospects reading English get the same skeleton built from the bilingual
 * widgets - summary, metrics, chart + budget, campaigns.
 */
function EnglishOverview({
  d,
  yoy,
  period,
}: {
  d: ReturnType<typeof getDemoDashboard>;
  yoy: ReturnType<typeof demoEngagementYoY>;
  period: React.ReactNode;
}) {
  return (
    <>
      <PrintHeader clientName={CLIENT} periodLabel={d.rangeLabel} logoUrl={DEMO_BRANDING.logoUrl} />
      <PageHeader
        title="Overview"
        description={`How ${CLIENT}'s ads and website are doing - the essentials on one screen.`}
        actions={period}
      />
      <AiSummaryCard summary={d.summary} lang="en" />
      <KpiCards kpis={d.kpis} trend={d.trend} lang="en" />
      <div className="grid items-start gap-4 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <MainChart trend={d.trend} events={[]} yoy={yoy} label={d.rangeLabel} lang="en" demo />
        </div>
        <BudgetProgress
          budget={d.budget}
          clientSlug="demo-full"
          isAgency={false}
          setBudgetAction={noop}
          lang="en"
        />
      </div>
      <CampaignPositions campaigns={d.campaigns} lang="en" />
      <TopCreatives creatives={d.creatives} lang="en" />
    </>
  );
}
