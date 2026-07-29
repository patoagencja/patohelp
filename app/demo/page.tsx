import { AiSummaryCard } from "@/components/dashboard/ai-summary-card";
import { AlertsDigest } from "@/components/dashboard/alerts-digest";
import { BudgetProgress } from "@/components/dashboard/budget-progress";
import { CampaignPositions } from "@/components/dashboard/campaign-positions";
import { DailyScoreCard } from "@/components/dashboard/daily-score";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { MainChart } from "@/components/dashboard/main-chart";
import { TickerBar } from "@/components/dashboard/ticker-bar";
import { TopCreatives } from "@/components/dashboard/top-creatives";
import { Devices } from "@/components/dashboard/website/devices";
import { TrafficSources } from "@/components/dashboard/website/traffic-sources";
import { getDemoDashboard } from "@/lib/demo/data";

export const dynamic = "force-dynamic";

async function noop() {
  "use server";
}

export default function DemoOnePager({
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
            ? "All your marketing in one place — Meta, Google and GA4, refreshed automatically. (Demo view on sample data.)"
            : "Cały Twój marketing w jednym miejscu — Meta, Google i GA4, odświeżane automatycznie. (Widok demonstracyjny na przykładowych danych.)"}
        </p>
      </div>

      <TickerBar campaigns={d.campaigns} />
      <DailyScoreCard data={d.score} lang={lang} />
      <MainChart trend={d.trend} events={[]} label={d.rangeLabel} lang={lang} />
      <KpiCards kpis={d.kpis} trend={d.trend} lang={lang} />
      <BudgetProgress
        budget={d.budget}
        clientSlug="demo"
        isAgency={false}
        setBudgetAction={noop}
        lang={lang}
      />
      <AlertsDigest alerts={d.alerts} clientSlug="demo" linkless lang={lang} />
      <CampaignPositions campaigns={d.campaigns} lang={lang} />
      <TopCreatives creatives={d.creatives} lang={lang} />

      <div className="grid gap-6 lg:grid-cols-2">
        <TrafficSources sources={d.website.sources} lang={lang} />
        <Devices devices={d.website.devices} lang={lang} />
      </div>

      <AiSummaryCard summary={d.summary} lang={lang} />

      <p className="pb-6 pt-2 text-center text-xs text-muted-foreground">
        {en ? "Demo view · sample data" : "Widok demonstracyjny · dane przykładowe"}
      </p>
    </>
  );
}
