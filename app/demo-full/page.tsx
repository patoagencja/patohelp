import { AgencyActivity } from "@/components/dashboard/agency-activity";
import { AiSummaryCard } from "@/components/dashboard/ai-summary-card";
import { AlertsDigest } from "@/components/dashboard/alerts-digest";
import { BudgetProgress } from "@/components/dashboard/budget-progress";
import { CampaignPositions } from "@/components/dashboard/campaign-positions";
import { DailyScoreCard } from "@/components/dashboard/daily-score";
import { GoalsCard } from "@/components/dashboard/goals-card";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { MainChart } from "@/components/dashboard/main-chart";
import { PrintButton, PrintHeader } from "@/components/dashboard/print-button";
import { RecordsCard } from "@/components/dashboard/records-card";
import { StoryHero } from "@/components/dashboard/story-hero";
import { TopCreatives } from "@/components/dashboard/top-creatives";
import { buildStory } from "@/lib/dashboard/story";
import { demoEngagementYoY } from "@/lib/dashboard/yoy";
import { getDemoDashboard } from "@/lib/demo/data";
import { getDemoRecords } from "@/lib/demo/records";
import { demoEngagementGoals } from "@/lib/dashboard/goals";

export const dynamic = "force-dynamic";

async function noop() {
  "use server";
}

// Same section order as the real overview (app/(dashboard)/[clientSlug]/
// page.tsx) - keep the two in sync. Every top-level child is one slide in
// presentation mode, so sections stay flat siblings (no wrapper groups).
export default function DemoFullOverview({
  searchParams,
}: {
  searchParams: { lang?: string };
}) {
  const lang = searchParams.lang === "en" ? "en" : "pl";
  const en = lang === "en";
  const d = getDemoDashboard(lang);
  const yoy = demoEngagementYoY(d.trend);
  return (
    <>
      <PrintHeader clientName="lokalnepomidorki" periodLabel={d.rangeLabel} />
      <div data-print-hide className="flex items-start justify-between gap-4">
       <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {en ? "Hi 👋" : "Cześć 👋"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {en
            ? "Campaign overview for lokalnepomidorki (demo view)."
            : "Przegląd kampanii lokalnepomidorki (widok demonstracyjny)."}
        </p>
       </div>
       <PrintButton />
      </div>

      {/* 1. Summary: what happened, is it good, what to tell the board. */}
      {en ? (
        <AiSummaryCard summary={d.summary} lang={lang} />
      ) : (
        <StoryHero
          story={buildStory({ kpis: d.kpis, trend: d.trend, includeSpend: true, yoy })}
          periodLabel={d.rangeLabel}
          aiSummary={d.summary}
        />
      )}

      {/* 2. Records and plan vs actual (goals, then the money side). */}
      {en ? null : <RecordsCard records={getDemoRecords({ ecommerce: false })} />}
      {en ? null : (
        <GoalsCard goals={demoEngagementGoals()} clientSlug="demo-full" isAgency={false} />
      )}
      <BudgetProgress
        budget={d.budget}
        clientSlug="demo-full"
        isAgency={false}
        setBudgetAction={noop}
        lang={lang}
      />

      {/* 3. The trend, then anything that needs attention and what we did. */}
      <MainChart trend={d.trend} events={[]} yoy={yoy} label={d.rangeLabel} lang={lang} demo />
      <AlertsDigest alerts={d.alerts} clientSlug="demo-full" lang={lang} linkless />
      {en ? null : <AgencyActivity demo isAgency={false} clientSlug="demo-full" />}

      {/* 4. Details for the curious: every metric with its definition. */}
      <KpiCards kpis={d.kpis} trend={d.trend} lang={lang} periodLabel={d.rangeLabel} />
      <DailyScoreCard data={d.score} lang={lang} compact />
      <CampaignPositions campaigns={d.campaigns} lang={lang} />
      <TopCreatives creatives={d.creatives} lang={lang} />
    </>
  );
}
