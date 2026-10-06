import { redirect } from "next/navigation";
import {
  CalendarRange,
  LineChart,
  ShoppingBag,
  Sparkles,
  TrendingUp,
} from "lucide-react";

import { EcommerceKpis } from "@/components/dashboard/ecommerce-kpis";
import { EcomAnalysisButton } from "@/components/dashboard/ecom-analysis-button";
import { ChannelEfficiency } from "@/components/dashboard/ecom/channel-efficiency";
import { ConversionFunnel } from "@/components/dashboard/ecom/conversion-funnel";
import { MonthPacingCard } from "@/components/dashboard/ecom/month-pacing-card";
import { NewVsReturning } from "@/components/dashboard/ecom/new-vs-returning";
import { ProfitCard } from "@/components/dashboard/ecom/profit-card";
import { SalesOverview } from "@/components/dashboard/ecom/sales-overview";
import { SeasonPlanner } from "@/components/dashboard/ecom/season-planner";
import { StorySection } from "@/components/dashboard/ecom/story-section";
import {
  TopProducts,
  type ProductRow,
} from "@/components/dashboard/ecom/top-products";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { SectionBoundary } from "@/components/dashboard/section-boundary";
import { Devices } from "@/components/dashboard/website/devices";
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
} from "@/lib/dashboard/metrics";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { formatDateWarsaw } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SprzedazPage({
  params,
  searchParams,
}: {
  params: { clientSlug: string };
  searchParams: { range?: string; from?: string; to?: string };
}) {
  const [viewer, client] = await Promise.all([
    getViewer(),
    getClientBySlug(params.clientSlug),
  ]);
  if (!client) redirect("/login");
  // Only for e-commerce clients.
  if (client.clientType !== "ecommerce") redirect(`/${params.clientSlug}`);
  const isAgency = viewer.isAgency;

  const range = normalizeRange(searchParams.range);
  const custom = parseCustomRange(searchParams.from, searchParams.to);
  const admin = createAdminClient();
  const [data, website, settings, pacing, season, channels, cached, itemsProbe, buyers] =
    await Promise.all([
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
      admin.from("ga4_items_daily").select("id").limit(1),
      getNewVsReturning(client.id),
    ]);
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

  // Per-SKU sales for the selected range (table arrives with migration 0018 -
  // absence degrades to a setup note inside the widget, never a crash).
  const rangeStart = data.trend[0]?.date;
  const rangeEnd = data.trend[data.trend.length - 1]?.date;
  let products: ProductRow[] = [];
  let itemsTableMissing = false;
  // Same window last year (52-week aligned) - only used when it's well covered.
  const yoyPromise = getYearOverYear(client.id, data.rangeStart, data.rangeEnd);
  if (rangeStart && rangeEnd) {
    if (itemsProbe.error) {
      itemsTableMissing = true;
    } else {
      const itemRows = await fetchAll<Record<string, unknown>>((from, to) =>
        admin
          .from("ga4_items_daily")
          .select("item_id, item_name, quantity, revenue_minor_units")
          .eq("client_id", client.id)
          .gte("date", rangeStart)
          .lte("date", rangeEnd)
          .order("date", { ascending: true })
          .range(from, to)
      );
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
  const yoy = await yoyPromise;

  return (
    <div className="min-w-0 space-y-10 p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ShoppingBag className="h-6 w-6 shrink-0 text-emerald-500" />
            Sprzedaż w sklepie
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Zamówienia ze sklepu internetowego {client.name} według Google
            Analytics, zestawione z tym, ile wydaliśmy na reklamy. Okres:{" "}
            <span className="font-medium text-foreground">{data.rangeLabel}</span>.
          </p>
        </div>
        <DateRangePicker
          value={range}
          customFrom={custom?.start}
          customTo={custom?.end}
        />
      </div>

      <StorySection
        step={1}
        title="Gdzie jesteśmy w tym miesiącu"
        description="Postęp bieżącego miesiąca, a pod nim wyniki z wybranego okresu."
      >
        {/* One boundary per widget: a shop with odd data (no revenue
            tracking, a few days of history) must still see the rest. */}
        {pacing ? (
          <SectionBoundary name="sales/month-pacing">
            <MonthPacingCard
              pacing={pacing}
              clientSlug={params.clientSlug}
              isAgency={isAgency}
            />
          </SectionBoundary>
        ) : null}
        <SectionBoundary name="sales/kpis">
          <EcommerceKpis
            data={data.ecommerce}
            trend={data.trend}
            yoy={yoy.available ? yoy : null}
            spend={rangeSpend}
          />
        </SectionBoundary>
        <SectionBoundary name="sales/overview">
          <SalesOverview
            trend={data.trend}
            revenueKpi={data.ecommerce.revenueMinorUnits}
            lastYear={yoy.available ? yoy.series : null}
          />
        </SectionBoundary>
      </StorySection>

      <StorySection
        step={2}
        title="Czy reklamy się opłacają"
        description="Ile zostaje po odjęciu kosztu towaru i wydatków na reklamy."
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
      </StorySection>

      <StorySection
        step={3}
        title="Co się sprzedaje"
        description="Najpopularniejsze produkty i strony, które klienci oglądają najchętniej."
      >
        {/* Stacked, not side by side: ten products next to five pages left
            a tall half-empty card. TopProducts splits into two columns itself. */}
        <SectionBoundary name="sales/top-products">
          <TopProducts
            products={products}
            tableMissing={itemsTableMissing}
            isAgency={isAgency}
          />
        </SectionBoundary>
        {website.hasData ? (
          <SectionBoundary name="sales/top-pages">
            <TopPages pages={website.topPages.slice(0, 5)} headingLevel={3} />
          </SectionBoundary>
        ) : null}
      </StorySection>

      <StorySection
        step={4}
        title="Skąd przychodzą kupujący"
        description="Które kanały przynoszą zamówienia, ile kosztują i jak wizyty zamieniają się w zakupy."
      >
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
              engagementRate={website.engagement.engagementRate}
              transactions={data.ecommerce.transactions.value}
            />
          </SectionBoundary>
          {website.hasData ? (
            <SectionBoundary name="sales/devices">
              <Devices devices={website.devices} headingLevel={3} />
            </SectionBoundary>
          ) : null}
        </div>
      </StorySection>

      {season ? (
        <StorySection
          step={5}
          title="Plan na sezon"
          description="Co pokazał zeszłoroczny sezon i jak przygotować się na tegoroczne szczyty."
        >
          <SectionBoundary name="sales/season">
            <SeasonPlanner plan={season} clientSlug={params.clientSlug} isAgency={isAgency} />
          </SectionBoundary>
        </StorySection>
      ) : null}

      {/* AI analysis - the narrative layer on top of the numbers above. */}
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Sparkles className="h-4 w-4 shrink-0 text-primary" />
              Analiza AI: co się dzieje i co dalej
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Wasze dane sprzedażowe zestawione z sezonowością branży i trendami na
              rynku.
            </p>
          </div>
          <EcomAnalysisButton clientSlug={params.clientSlug} hasAnalysis={Boolean(analysis)} />
        </div>

        {analysis ? (
          <div className="mt-5 space-y-5">
            <p className="text-lg font-semibold leading-snug">{analysis.headline}</p>
            <p className="text-sm leading-relaxed text-foreground">
              {analysis.performance}
            </p>

            {analysis.peaks.length ? (
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
            ) : null}

            {analysis.seasonality ? (
              <div>
                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <CalendarRange className="h-3.5 w-3.5" /> Jak zwykle wygląda sezon w branży
                </p>
                <p className="text-sm leading-relaxed text-foreground">{analysis.seasonality}</p>
              </div>
            ) : null}

            {analysis.market ? (
              <div>
                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <LineChart className="h-3.5 w-3.5" /> Co dzieje się na rynku
                </p>
                <p className="text-sm leading-relaxed text-foreground">{analysis.market}</p>
              </div>
            ) : null}

            {analysis.recommendations.length ? (
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
            ) : null}

            {cached?.generated_at ? (
              <p className="text-xs text-muted-foreground">
                Przygotowano:{" "}
                {formatDateWarsaw(String(cached.generated_at), "d MMMM yyyy, HH:mm")}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Kliknij „Przygotuj analizę” - AI przejrzy Waszą sprzedaż, wskaże
            najmocniejsze dni, opisze, jak zwykle wygląda sezon w Waszej branży i co
            dzieje się na rynku (sprawdzając aktualne informacje w internecie), a na
            koniec podpowie, jak przygotować się na nadchodzące szczyty.
          </p>
        )}
      </section>
    </div>
  );
}
