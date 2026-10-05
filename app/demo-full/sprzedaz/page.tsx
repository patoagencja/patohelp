import { CalendarRange, LineChart, ShoppingBag, Sparkles, TrendingUp } from "lucide-react";

import { EcommerceKpis } from "@/components/dashboard/ecommerce-kpis";
import { ChannelEfficiency } from "@/components/dashboard/ecom/channel-efficiency";
import { ConversionFunnel } from "@/components/dashboard/ecom/conversion-funnel";
import { MonthPacingCard } from "@/components/dashboard/ecom/month-pacing-card";
import { ProfitCard } from "@/components/dashboard/ecom/profit-card";
import { SalesOverview } from "@/components/dashboard/ecom/sales-overview";
import { SeasonPlanner } from "@/components/dashboard/ecom/season-planner";
import { StorySection } from "@/components/dashboard/ecom/story-section";
import { TopProducts } from "@/components/dashboard/ecom/top-products";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { Devices } from "@/components/dashboard/website/devices";
import { TopPages } from "@/components/dashboard/website/top-pages";
import { normalizeRange, parseCustomRange } from "@/lib/dashboard/ranges";
import { getDemoEcom } from "@/lib/demo/ecom";
import { formatDateWarsaw } from "@/lib/utils";

// Public e-commerce showcase: the same widgets as
// app/(dashboard)/[clientSlug]/sprzedaz, fed by synthetic data so the
// "Sprzedaż" tab can be shown to prospects without a live shop behind it.
export const dynamic = "force-dynamic";

const SHOP_NAME = "lokalnepomidorki";
const DEMO_SLUG = "demo-full";

export default function DemoSprzedazPage({
  searchParams,
}: {
  searchParams: { range?: string; from?: string; to?: string };
}) {
  const range = normalizeRange(searchParams.range);
  const custom = parseCustomRange(searchParams.from, searchParams.to);
  const d = getDemoEcom(range, custom);
  const totalSessions = d.trend.reduce((a, p) => a + p.sessions, 0);
  const analysis = d.analysis;

  return (
    <div className="min-w-0 space-y-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ShoppingBag className="h-6 w-6 shrink-0 text-emerald-500" />
            Sprzedaż w sklepie
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Zamówienia ze sklepu internetowego {SHOP_NAME} według Google
            Analytics, zestawione z tym, ile wydaliśmy na reklamy. Okres:{" "}
            <span className="font-medium text-foreground">{d.rangeLabel}</span>.
          </p>
        </div>
        <DateRangePicker value={range} customFrom={custom?.start} customTo={custom?.end} />
      </div>

      <StorySection
        step={1}
        title="Gdzie jesteśmy w tym miesiącu"
        description="Postęp bieżącego miesiąca, a pod nim wyniki z wybranego okresu."
      >
        <MonthPacingCard pacing={d.pacing} clientSlug={DEMO_SLUG} isAgency={false} />
        <EcommerceKpis
          data={d.ecommerce}
          trend={d.trend}
          yoy={d.yoy.available ? d.yoy : null}
          spend={d.spend}
        />
        <SalesOverview
          trend={d.trend}
          revenueKpi={d.ecommerce.revenueMinorUnits}
          lastYear={d.yoy.available ? d.yoy.series : null}
        />
      </StorySection>

      <StorySection
        step={2}
        title="Czy reklamy się opłacają"
        description="Ile zostaje po odjęciu kosztu towaru i wydatków na reklamy."
      >
        <ProfitCard
          revenue={d.ecommerce.revenueMinorUnits.value}
          spend={d.spend}
          settings={d.settings}
          rangeLabel={d.rangeLabel}
          clientSlug={DEMO_SLUG}
          isAgency={false}
        />
      </StorySection>

      <StorySection
        step={3}
        title="Co się sprzedaje"
        description="Najpopularniejsze produkty i strony, które klienci oglądają najchętniej."
      >
        {/* grid-cols-1 (= minmax(0,1fr)): without it a long page URL in
            TopPages widens the track past a phone screen. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <TopProducts products={d.products} />
          <TopPages pages={d.topPages} />
        </div>
      </StorySection>

      <StorySection
        step={4}
        title="Skąd przychodzą kupujący"
        description="Które kanały przynoszą zamówienia, ile kosztują i jak wizyty zamieniają się w zakupy."
      >
        <ChannelEfficiency data={d.channels} settings={d.settings} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ConversionFunnel
            sessions={totalSessions}
            engagementRate={d.engagementRate}
            transactions={d.ecommerce.transactions.value}
          />
          <Devices devices={d.devices} />
        </div>
      </StorySection>

      {d.season ? (
        <StorySection
          step={5}
          title="Plan na sezon"
          description="Co pokazał zeszłoroczny sezon i jak przygotować się na tegoroczne szczyty."
        >
          <SeasonPlanner plan={d.season} clientSlug={DEMO_SLUG} isAgency={false} />
        </StorySection>
      ) : null}

      {/* Same markup as the real page's AI block, minus the "generate" button:
          the demo has no shop to analyse, so it shows a pre-written analysis. */}
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles className="h-4 w-4 shrink-0 text-primary" />
            Analiza AI: co się dzieje i co dalej
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Wasze dane sprzedażowe zestawione z sezonowością branży i trendami na rynku.
          </p>
        </div>

        <div className="mt-5 space-y-5">
          <p className="text-lg font-semibold leading-snug">{analysis.headline}</p>
          <p className="text-sm leading-relaxed text-foreground">{analysis.performance}</p>

          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5" /> Najmocniejsze momenty w Waszych danych
            </p>
            <ul className="space-y-1.5">
              {analysis.peaks.map((p, i) => (
                <li key={i} className="text-sm">
                  <span className="font-medium">{p.label}</span>
                  {p.note ? <span className="text-muted-foreground"> - {p.note}</span> : null}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <CalendarRange className="h-3.5 w-3.5" /> Jak zwykle wygląda sezon w branży
            </p>
            <p className="text-sm leading-relaxed text-foreground">{analysis.seasonality}</p>
          </div>

          <div>
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <LineChart className="h-3.5 w-3.5" /> Co dzieje się na rynku
            </p>
            <p className="text-sm leading-relaxed text-foreground">{analysis.market}</p>
          </div>

          <div className="rounded-xl bg-emerald-500/5 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
              Co proponujemy
            </p>
            <ul className="list-inside list-disc space-y-1.5 text-sm">
              {analysis.recommendations.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-muted-foreground">
            Przygotowano: {formatDateWarsaw(d.analysisGeneratedAt, "d MMMM yyyy, HH:mm")}
          </p>
        </div>
      </section>
    </div>
  );
}
