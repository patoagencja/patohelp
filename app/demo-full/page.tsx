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

export default function DemoFullOverview({
  searchParams,
}: {
  searchParams: { lang?: string };
}) {
  const lang = searchParams.lang === "en" ? "en" : "pl";
  const en = lang === "en";
  const d = getDemoDashboard(lang);
  return (
    <>
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

      <TickerBar campaigns={d.campaigns} />
      <DailyScoreCard data={d.score} lang={lang} />
      <MainChart trend={d.trend} events={[]} label={d.rangeLabel} lang={lang} />
      <KpiCards kpis={d.kpis} trend={d.trend} lang={lang} />
      <BudgetProgress
        budget={d.budget}
        clientSlug="demo-full"
        isAgency={false}
        setBudgetAction={noop}
        lang={lang}
      />
      <AlertsDigest alerts={d.alerts} clientSlug="demo-full" lang={lang} linkless />
      <CampaignPositions campaigns={d.campaigns} lang={lang} />
      <TopCreatives creatives={d.creatives} lang={lang} />
      <AiSummaryCard summary={d.summary} lang={lang} />
    </>
  );
}
