import {
  BellRing,
  FileText,
  Globe,
  Image as ImageIcon,
  LayoutDashboard,
  Megaphone,
  Newspaper,
  Sparkles,
} from "lucide-react";

import { AiSummaryCard } from "@/components/dashboard/ai-summary-card";
import { AlertsDigest } from "@/components/dashboard/alerts-digest";
import { BudgetProgress } from "@/components/dashboard/budget-progress";
import { CampaignPositions } from "@/components/dashboard/campaign-positions";
import { DailyScoreCard } from "@/components/dashboard/daily-score";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { MainChart } from "@/components/dashboard/main-chart";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { TickerBar } from "@/components/dashboard/ticker-bar";
import { TopCreatives } from "@/components/dashboard/top-creatives";
import { getDemoDashboard } from "@/lib/demo/data";
import { cn } from "@/lib/utils";

// Public, no-login showcase built entirely from synthetic data - a single link
// to hand a prospect. Never touches the database, so no real client data can
// ever surface here.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Demo — Dashboard klienta",
  description: "Przykładowy dashboard marketingowy (dane demonstracyjne).",
};

// Budget bar needs a form action prop; in demo it's read-only (isAgency=false),
// so this never runs.
async function noop() {
  "use server";
}

// Static nav (visual) - the demo is a single overview page, so tabs other than
// Przegląd are shown for context but don't navigate.
const NAV = [
  { label: "Przegląd", icon: LayoutDashboard, active: true },
  { label: "Reklamy", icon: Megaphone, active: false },
  { label: "Kreacje", icon: ImageIcon, active: false },
  { label: "Witryna", icon: Globe, active: false },
  { label: "Alerty", icon: BellRing, active: false },
  { label: "Raport", icon: FileText, active: false },
  { label: "Newsy", icon: Newspaper, active: false },
  { label: "Asystent AI", icon: Sparkles, active: false },
];

export default function DemoPage() {
  const d = getDemoDashboard();

  return (
    <div className="flex min-h-screen bg-muted/20">
      {/* Sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
        <div className="flex h-14 items-center gap-2.5 border-b border-border px-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="font-semibold">Demo — Twoja Firma</span>
        </div>
        <nav className="flex flex-col gap-1 p-3">
          <p className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
            Menu
          </p>
          {NAV.map(({ label, icon: Icon, active }) => (
            <span
              key={label}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm",
                active
                  ? "bg-accent font-medium text-accent-foreground"
                  : "cursor-default text-muted-foreground/80"
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              {label}
            </span>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-border bg-card px-6">
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
            DEMO · dane przykładowe
          </span>
          <span className="flex-1" />
          <ThemeToggle />
        </header>

        <main className="mx-auto w-full max-w-6xl space-y-6 p-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Cześć 👋</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Cały Twój marketing w jednym miejscu — Meta, Google i GA4,
              odświeżane automatycznie. (Widok demonstracyjny na przykładowych
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
        </main>
      </div>
    </div>
  );
}
