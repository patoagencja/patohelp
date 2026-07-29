import { AiSummaryCard } from "@/components/dashboard/ai-summary-card";
import { AlertsDigest } from "@/components/dashboard/alerts-digest";
import { BudgetProgress } from "@/components/dashboard/budget-progress";
import { CampaignPositions } from "@/components/dashboard/campaign-positions";
import { DailyScoreCard } from "@/components/dashboard/daily-score";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { MainChart } from "@/components/dashboard/main-chart";
import { TickerBar } from "@/components/dashboard/ticker-bar";
import { TopCreatives } from "@/components/dashboard/top-creatives";
import { getDemoDashboard } from "@/lib/demo/data";

export const dynamic = "force-dynamic";

async function noop() {
  "use server";
}

export default function DemoFullOverview() {
  const d = getDemoDashboard();
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cześć 👋</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Przegląd kampanii lokalnepomidorki (widok demonstracyjny).
        </p>
      </div>

      <TickerBar campaigns={d.campaigns} />
      <DailyScoreCard data={d.score} />
      <MainChart trend={d.trend} events={[]} label={d.rangeLabel} />
      <KpiCards kpis={d.kpis} trend={d.trend} />
      <BudgetProgress
        budget={d.budget}
        clientSlug="demo-full"
        isAgency={false}
        setBudgetAction={noop}
      />
      <AlertsDigest alerts={d.alerts} clientSlug="demo-full" />
      <CampaignPositions campaigns={d.campaigns} />
      <TopCreatives creatives={d.creatives} />
      <AiSummaryCard summary={d.summary} />
    </>
  );
}
