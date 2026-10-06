import { DetailsDisclosure } from "@/components/dashboard/details-disclosure";
import { EcommerceKpis } from "@/components/dashboard/ecommerce-kpis";
import { AiAnalysisCard } from "@/components/dashboard/ecom/ai-analysis-card";
import { ChannelEfficiency } from "@/components/dashboard/ecom/channel-efficiency";
import { ConversionFunnel } from "@/components/dashboard/ecom/conversion-funnel";
import { MonthPacingCard } from "@/components/dashboard/ecom/month-pacing-card";
import { NewVsReturning } from "@/components/dashboard/ecom/new-vs-returning";
import { ProfitCard } from "@/components/dashboard/ecom/profit-card";
import { SalesOverview } from "@/components/dashboard/ecom/sales-overview";
import { SeasonPlanner } from "@/components/dashboard/ecom/season-planner";
import { TopProducts } from "@/components/dashboard/ecom/top-products";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { Devices } from "@/components/dashboard/website/devices";
import { SNAPSHOT_30D_NOTE } from "@/components/dashboard/website/share-bars";
import { TopPages } from "@/components/dashboard/website/top-pages";
import { PageHeader } from "@/components/ui/page-header";
import { normalizeRange, parseCustomRange } from "@/lib/dashboard/ranges";
import { getDemoEcom, getDemoNewVsReturning } from "@/lib/demo/ecom";

// Public e-commerce showcase: the same widgets as
// app/(dashboard)/[clientSlug]/sprzedaz, fed by synthetic data so the
// "Sprzedaż" tab can be shown to prospects without a live shop behind it.
export const dynamic = "force-dynamic";

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

  // Same order as the real page: header, numbers, chart, plan, products,
  // then everything else behind one "Pokaż szczegóły".
  return (
    <div className="min-w-0 space-y-8">
      <PageHeader
        title="Sprzedaż"
        description="Ile sprzedał Twój sklep i czy reklamy się opłacają."
        actions={
          <DateRangePicker value={range} customFrom={custom?.start} customTo={custom?.end} />
        }
      />

      <EcommerceKpis
        data={d.ecommerce}
        trend={d.trend}
        yoy={d.yoy.available ? d.yoy : null}
        spend={d.spend}
        heading={null}
      />

      <SalesOverview trend={d.trend} lastYear={d.yoy.available ? d.yoy.series : null} />

      <MonthPacingCard pacing={d.pacing} clientSlug={DEMO_SLUG} isAgency={false} />

      <TopProducts products={d.products} />

      <DetailsDisclosure
        storageKey="pato:details:sprzedaz"
        summary="Zysk, kanały sprzedaży, nowi i stali klienci, droga do zakupu, plan na sezon i analiza AI"
      >
        <ProfitCard
          revenue={d.ecommerce.revenueMinorUnits.value}
          spend={d.spend}
          settings={d.settings}
          rangeLabel={d.rangeLabel}
          clientSlug={DEMO_SLUG}
          isAgency={false}
        />
        <ChannelEfficiency data={d.channels} settings={d.settings} />
        <NewVsReturning data={getDemoNewVsReturning(d.today)} />
        {/* grid-cols-1 (= minmax(0,1fr)) so wide content can't stretch the
            track past a phone screen; min-w-0 lets cards shrink in it. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <ConversionFunnel
            sessions={totalSessions}
            engagementRate={d.engagementRate}
            transactions={d.ecommerce.transactions.value}
          />
          <Devices devices={d.devices} periodNote={SNAPSHOT_30D_NOTE} />
        </div>
        <TopPages pages={d.topPages} periodNote={SNAPSHOT_30D_NOTE} />
        {d.season ? (
          <SeasonPlanner plan={d.season} clientSlug={DEMO_SLUG} isAgency={false} />
        ) : null}
        {/* The demo has no shop to analyse: a pre-written analysis, no button. */}
        <AiAnalysisCard analysis={d.analysis} generatedAt={d.analysisGeneratedAt} />
      </DetailsDisclosure>
    </div>
  );
}
