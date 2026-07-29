import { Sparkles } from "lucide-react";

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

// Public, no-login showcase built entirely from synthetic data - a single link
// to hand a prospect. Never touches the database, so no real client data can
// ever surface here.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Demo — Pato Dashboard",
  description: "Przykładowy dashboard marketingowy (dane demonstracyjne).",
};

// Budget bar needs a form action prop; in demo it's read-only (isAgency=false),
// so this never runs.
async function noop() {
  "use server";
}

export default function DemoPage() {
  const d = getDemoDashboard();

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-card/95 px-6 backdrop-blur">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Sparkles className="h-4 w-4" />
        </span>
        <span className="font-semibold">Demo — Twoja Firma</span>
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
          DEMO · dane przykładowe
        </span>
        <span className="flex-1" />
        <span className="hidden text-xs text-muted-foreground sm:inline">
          patoagencja · dashboard klienta
        </span>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cześć 👋</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tak wygląda Twój marketing w jednym miejscu — Meta, Google i GA4,
            odświeżane automatycznie. (To widok demonstracyjny na przykładowych
            danych.)
          </p>
        </div>

        <TickerBar campaigns={d.campaigns} />

        <DailyScoreCard data={d.score} />

        <MainChart trend={d.trend} events={[]} label={d.rangeLabel} />

        <KpiCards kpis={d.kpis} trend={d.trend} />

        <BudgetProgress
          budget={d.budget}
          clientSlug="demo"
          isAgency={false}
          setBudgetAction={noop}
        />

        <AlertsDigest alerts={d.alerts} clientSlug="demo" />

        <CampaignPositions campaigns={d.campaigns} />

        <TopCreatives creatives={d.creatives} />

        <AiSummaryCard summary={d.summary} />

        <p className="pb-8 pt-2 text-center text-xs text-muted-foreground">
          Chcesz taki panel dla swojej firmy?{" "}
          <span className="font-medium text-foreground">patoagencja.com</span>
        </p>
      </main>
    </div>
  );
}
