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
import { ProfitCard } from "@/components/dashboard/ecom/profit-card";
import { SalesOverview } from "@/components/dashboard/ecom/sales-overview";
import { SeasonPlanner } from "@/components/dashboard/ecom/season-planner";
import {
  TopProducts,
  type ProductRow,
} from "@/components/dashboard/ecom/top-products";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
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
import { getClientBySlug, getViewer } from "@/lib/dashboard/context";
import { getWebsiteData } from "@/lib/dashboard/ga4-metrics";
import {
  getDashboardData,
  normalizeRange,
  parseCustomRange,
} from "@/lib/dashboard/metrics";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";

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
  const [data, website, settings, pacing, season, channels, cached, itemsProbe] =
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
    ]);
  const totalSessions = data.trend.reduce((a, p) => a + p.sessions, 0);
  const rangeSpend = data.kpis.spendMinorUnits.value;
  const analysis = (cached?.content as EcomAnalysis | undefined) ?? null;

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
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <ShoppingBag className="h-5 w-5 text-emerald-500" />
            Sprzedaż - {client.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Przychód, ROAS i analiza rynku · {data.rangeLabel}
          </p>
        </div>
        <DateRangePicker
          value={range}
          customFrom={custom?.start}
          customTo={custom?.end}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {pacing ? (
          <MonthPacingCard
            pacing={pacing}
            clientSlug={params.clientSlug}
            isAgency={isAgency}
          />
        ) : null}
        <ProfitCard
          revenue={data.ecommerce.revenueMinorUnits.value}
          spend={rangeSpend}
          settings={settings}
          rangeLabel={data.rangeLabel}
          clientSlug={params.clientSlug}
          isAgency={isAgency}
        />
      </div>

      <EcommerceKpis
        data={data.ecommerce}
        trend={data.trend}
        yoy={yoy.available ? yoy : null}
        spend={rangeSpend}
      />
      <SalesOverview
        trend={data.trend}
        revenueKpi={data.ecommerce.revenueMinorUnits}
        lastYear={yoy.available ? yoy.series : null}
      />

      {season ? (
        <SeasonPlanner plan={season} clientSlug={params.clientSlug} isAgency={isAgency} />
      ) : null}

      {channels ? <ChannelEfficiency data={channels} settings={settings} /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <ConversionFunnel
          sessions={totalSessions}
          engagementRate={website.engagement.engagementRate}
          transactions={data.ecommerce.transactions.value}
        />
        {website.hasData ? <Devices devices={website.devices} /> : null}
      </div>

      <TopProducts products={products} tableMissing={itemsTableMissing} />

      {website.hasData ? <TopPages pages={website.topPages.slice(0, 5)} /> : null}

      {/* AI analysis */}
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-primary" />
            Analiza e-commerce (dane + rynek)
          </h2>
          <EcomAnalysisButton clientSlug={params.clientSlug} />
        </div>

        {analysis ? (
          <div className="mt-4 space-y-5">
            <p className="text-lg font-semibold leading-snug">{analysis.headline}</p>
            <p className="text-sm leading-relaxed text-foreground">
              {analysis.performance}
            </p>

            {analysis.peaks.length ? (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <TrendingUp className="h-3.5 w-3.5" /> Peaki w Twoich danych
                </p>
                <ul className="space-y-1.5">
                  {analysis.peaks.map((p, i) => (
                    <li key={i} className="text-sm">
                      <span className="font-medium">{p.label}</span>
                      {p.note ? <span className="text-muted-foreground"> — {p.note}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {analysis.seasonality ? (
              <div>
                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <CalendarRange className="h-3.5 w-3.5" /> Sezonowość branży
                </p>
                <p className="text-sm leading-relaxed text-foreground">{analysis.seasonality}</p>
              </div>
            ) : null}

            {analysis.market ? (
              <div>
                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <LineChart className="h-3.5 w-3.5" /> Trendy rynkowe
                </p>
                <p className="text-sm leading-relaxed text-foreground">{analysis.market}</p>
              </div>
            ) : null}

            {analysis.recommendations.length ? (
              <div className="rounded-xl bg-emerald-500/5 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                  Rekomendacje
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
                Wygenerowano: {String(cached.generated_at).slice(0, 16).replace("T", " ")}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            Kliknij „Generuj analizę AI" - Claude przeanalizuje Twoje dane
            sprzedażowe, wykryje peaki, opisze sezonowość branży i trendy rynkowe
            (z wyszukiwaniem w sieci) oraz doda rekomendacje pod nadchodzące
            szczyty.
          </p>
        )}
      </section>
    </div>
  );
}
