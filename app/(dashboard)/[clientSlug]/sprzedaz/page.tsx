import { redirect } from "next/navigation";

import { EcommerceKpis } from "@/components/dashboard/ecommerce-kpis";
import { DetailsDisclosure } from "@/components/dashboard/details-disclosure";
import { EcomAnalysisButton } from "@/components/dashboard/ecom-analysis-button";
import { AiAnalysisCard } from "@/components/dashboard/ecom/ai-analysis-card";
import { ChannelEfficiency } from "@/components/dashboard/ecom/channel-efficiency";
import { ConversionFunnel } from "@/components/dashboard/ecom/conversion-funnel";
import { MonthPacingCard } from "@/components/dashboard/ecom/month-pacing-card";
import { NewVsReturning } from "@/components/dashboard/ecom/new-vs-returning";
import { ProfitCard } from "@/components/dashboard/ecom/profit-card";
import { SalesOverview } from "@/components/dashboard/ecom/sales-overview";
import { SeasonPlanner } from "@/components/dashboard/ecom/season-planner";
import {
  TopProducts,
  type ProductRow,
} from "@/components/dashboard/ecom/top-products";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { SectionBoundary } from "@/components/dashboard/section-boundary";
import { Devices } from "@/components/dashboard/website/devices";
import { SNAPSHOT_30D_NOTE } from "@/components/dashboard/website/share-bars";
import { TopPages } from "@/components/dashboard/website/top-pages";
import type { EcomAnalysis } from "@/lib/ecom/analysis";
import {
  getChannelEfficiency,
  getEcomSettings,
  getMonthPacing,
  getSeasonPlan,
  getYearOverYear,
} from "@/lib/ecom/insights";
import { getNewVsReturning } from "@/lib/ecom/new-vs-returning";
import { getClientBySlug, getViewer } from "@/lib/dashboard/context";
import { getWebsiteData } from "@/lib/dashboard/ga4-metrics";
import {
  getDashboardData,
  normalizeRange,
  parseCustomRange,
  resolveDashboardRange,
} from "@/lib/dashboard/metrics";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function SprzedazPage({
  params,
  searchParams,
}: {
  params: { clientSlug: string };
  searchParams: { range?: string; from?: string; to?: string };
}) {
  // Every read below needs only the client row; the viewer's role (two
  // round trips) just decides what to render, so it resolves alongside.
  const viewerPromise = getViewer();
  // Awaited below; this only stops Node flagging an early rejection.
  viewerPromise.catch(() => {});
  const client = await getClientBySlug(params.clientSlug);
  if (!client) redirect("/login");
  // Only for e-commerce clients.
  if (client.clientType !== "ecommerce") redirect(`/${params.clientSlug}`);

  const range = normalizeRange(searchParams.range);
  const custom = parseCustomRange(searchParams.from, searchParams.to);
  // The window getDashboardData reads, known up front: the per-SKU and YoY
  // reads below used to wait for the dashboard data just to learn it.
  const period = resolveDashboardRange(range, custom);
  const admin = createAdminClient();

  // Per-SKU sales for the selected range (table arrives with migration 0018 -
  // absence degrades to a setup note inside the widget, never a crash). The
  // existence probe and the read run side by side; the probe still decides.
  const itemsProbePromise = admin.from("ga4_items_daily").select("id").limit(1);
  const itemRowsPromise =
    period.start <= period.end
      ? fetchAll<Record<string, unknown>>((from, to) =>
          admin
            .from("ga4_items_daily")
            .select("item_id, item_name, quantity, revenue_minor_units")
            .eq("client_id", client.id)
            .gte("date", period.start)
            .lte("date", period.end)
            .order("date", { ascending: true })
            // Tie-breaker: with date alone, rows of one day could repeat or go
            // missing across 1000-row pages, skewing product totals.
            .order("id", { ascending: true })
            .range(from, to)
        )
      : null;
  // A missing table makes this read fail too; that case is reported by the
  // probe, so only a read the probe vouched for may surface its error.
  itemRowsPromise?.catch(() => {});

  const [
    data,
    website,
    settings,
    pacing,
    season,
    channels,
    cached,
    itemsProbe,
    buyers,
    // Same window last year (52-week aligned) - only used when it's well covered.
    yoy,
    viewer,
  ] = await Promise.all([
    getDashboardData(client.id, range, custom),
    getWebsiteData(client.id),
    getEcomSettings(client.id),
    getMonthPacing(client.id),
    getSeasonPlan(client.id),
    getChannelEfficiency(client.id),
    // Latest cached AI analysis (service-role read).
    admin
      .from("ecom_analyses")
      .select("content, generated_at")
      .eq("client_id", client.id)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then((r) => r.data),
    itemsProbePromise,
    getNewVsReturning(client.id),
    getYearOverYear(client.id, period.start, period.end),
    viewerPromise,
  ]);
  const isAgency = viewer.isAgency;
  const totalSessions = data.trend.reduce((a, p) => a + p.sessions, 0);
  const rangeSpend = data.kpis.spendMinorUnits.value;
  const analysisRaw = (cached?.content as EcomAnalysis | undefined) ?? null;
  // Cached JSON from an older prompt version can miss fields; rendering
  // `.length` of undefined here would take down the whole tab, not one card.
  const analysis = analysisRaw
    ? {
        ...analysisRaw,
        peaks: Array.isArray(analysisRaw.peaks) ? analysisRaw.peaks : [],
        recommendations: Array.isArray(analysisRaw.recommendations)
          ? analysisRaw.recommendations
          : [],
      }
    : null;

  let products: ProductRow[] = [];
  let itemsTableMissing = false;
  if (itemRowsPromise) {
    if (itemsProbe.error) {
      itemsTableMissing = true;
    } else {
      const itemRows = await itemRowsPromise;
      const byItem = new Map<string, ProductRow>();
      for (const r of itemRows ?? []) {
        const key = `${r.item_id}:${r.item_name}`;
        const cur =
          byItem.get(key) ??
          ({
            itemId: (r.item_id as string) ?? "",
            itemName: (r.item_name as string) || "(bez nazwy)",
            quantity: 0,
            revenueMinorUnits: 0,
          } satisfies ProductRow);
        cur.quantity += Number(r.quantity ?? 0);
        cur.revenueMinorUnits += Number(r.revenue_minor_units ?? 0);
        byItem.set(key, cur);
      }
      products = [...byItem.values()]
        .sort((a, b) => b.revenueMinorUnits - a.revenueMinorUnits)
        .slice(0, 10);
    }
  }

  // Top-level children are the presentation-mode slides: header, numbers,
  // chart, plan, products, details. Everything else sits behind one click.
  return (
    <div className="min-w-0 space-y-8 p-4 sm:p-6">
      <PageHeader
        eyebrow={<span className="kick">Sklep · {data.rangeLabel}</span>}
        title="Sprzedaż"
        description="Ile sprzedał Twój sklep i czy reklamy się opłacają."
        actions={
          <DateRangePicker
            value={range}
            customFrom={custom?.start}
            customTo={custom?.end}
          />
        }
      />

      {/* One boundary per widget: a shop with odd data (no revenue
          tracking, a few days of history) must still see the rest. */}
      <SectionBoundary name="sales/kpis">
        <EcommerceKpis
          data={data.ecommerce}
          trend={data.trend}
          yoy={yoy.available ? yoy : null}
          spend={rangeSpend}
          heading={null}
        />
      </SectionBoundary>

      <SectionBoundary name="sales/overview">
        <SalesOverview
          trend={data.trend}
          lastYear={yoy.available ? yoy.series : null}
        />
      </SectionBoundary>

      {pacing ? (
        <SectionBoundary name="sales/month-pacing">
          <MonthPacingCard
            pacing={pacing}
            clientSlug={params.clientSlug}
            isAgency={isAgency}
          />
        </SectionBoundary>
      ) : null}

      <SectionBoundary name="sales/top-products">
        <TopProducts
          products={products}
          tableMissing={itemsTableMissing}
          isAgency={isAgency}
        />
      </SectionBoundary>

      <DetailsDisclosure
        storageKey="pato:details:sprzedaz"
        summary="Zysk, kanały sprzedaży, nowi i stali klienci, droga do zakupu, plan na sezon i analiza AI"
      >
        <SectionBoundary name="sales/profit">
          <ProfitCard
            revenue={data.ecommerce.revenueMinorUnits.value}
            spend={rangeSpend}
            settings={settings}
            rangeLabel={data.rangeLabel}
            clientSlug={params.clientSlug}
            isAgency={isAgency}
          />
        </SectionBoundary>
        {channels ? (
          <SectionBoundary name="sales/channels">
            <ChannelEfficiency data={channels} settings={settings} />
          </SectionBoundary>
        ) : null}
        <SectionBoundary name="sales/new-vs-returning">
          <NewVsReturning data={buyers} />
        </SectionBoundary>
        {/* grid-cols-1 (= minmax(0,1fr)) so wide content can't stretch the
            track past a phone screen; min-w-0 lets cards shrink in it. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <SectionBoundary name="sales/funnel">
            <ConversionFunnel
              sessions={totalSessions}
              // Same window as the sessions/orders beside it (the picked range).
              engagementRate={data.engagementRate ?? website.engagement.engagementRate}
              transactions={data.ecommerce.transactions.value}
            />
          </SectionBoundary>
          {website.hasData ? (
            <SectionBoundary name="sales/devices">
              <Devices devices={website.devices} periodNote={SNAPSHOT_30D_NOTE} />
            </SectionBoundary>
          ) : null}
        </div>
        {website.hasData ? (
          <SectionBoundary name="sales/top-pages">
            <TopPages pages={website.topPages} periodNote={SNAPSHOT_30D_NOTE} />
          </SectionBoundary>
        ) : null}
        {season ? (
          <SectionBoundary name="sales/season">
            <SeasonPlanner plan={season} clientSlug={params.clientSlug} isAgency={isAgency} />
          </SectionBoundary>
        ) : null}
        <SectionBoundary name="sales/ai-analysis">
          <AiAnalysisCard
            analysis={analysis}
            generatedAt={cached?.generated_at ? String(cached.generated_at) : null}
            action={
              <EcomAnalysisButton
                clientSlug={params.clientSlug}
                hasAnalysis={Boolean(analysis)}
              />
            }
          />
        </SectionBoundary>
      </DetailsDisclosure>
    </div>
  );
}
