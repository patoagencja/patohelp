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
import { ConversionFunnel } from "@/components/dashboard/ecom/conversion-funnel";
import { SalesOverview } from "@/components/dashboard/ecom/sales-overview";
import {
  TopProducts,
  type ProductRow,
} from "@/components/dashboard/ecom/top-products";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { Devices } from "@/components/dashboard/website/devices";
import { TopPages } from "@/components/dashboard/website/top-pages";
import { TrafficSources } from "@/components/dashboard/website/traffic-sources";
import type { EcomAnalysis } from "@/lib/ecom/analysis";
import { getWebsiteData } from "@/lib/dashboard/ga4-metrics";
import {
  getDashboardData,
  normalizeRange,
  parseCustomRange,
} from "@/lib/dashboard/metrics";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SprzedazPage({
  params,
  searchParams,
}: {
  params: { clientSlug: string };
  searchParams: { range?: string; from?: string; to?: string };
}) {
  const supabase = createClient();
  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("slug", params.clientSlug)
    .single();
  if (!client) redirect("/login");

  // Only for e-commerce clients.
  const { data: ct } = await supabase
    .from("clients")
    .select("client_type")
    .eq("id", client.id)
    .maybeSingle();
  if ((ct as { client_type?: string } | null)?.client_type !== "ecommerce") {
    redirect(`/${params.clientSlug}`);
  }

  const range = normalizeRange(searchParams.range);
  const custom = parseCustomRange(searchParams.from, searchParams.to);
  const [data, website] = await Promise.all([
    getDashboardData(client.id, range, custom),
    getWebsiteData(client.id),
  ]);
  const totalSessions = data.trend.reduce((a, p) => a + p.sessions, 0);

  const admin = createAdminClient();

  // Latest cached AI analysis (service-role read).
  const { data: cached } = await admin
    .from("ecom_analyses")
    .select("content, generated_at")
    .eq("client_id", client.id)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const analysis = (cached?.content as EcomAnalysis | undefined) ?? null;

  // Per-SKU sales for the selected range (table arrives with migration 0018 -
  // absence degrades to a setup note inside the widget, never a crash).
  const rangeStart = data.trend[0]?.date;
  const rangeEnd = data.trend[data.trend.length - 1]?.date;
  let products: ProductRow[] = [];
  let itemsTableMissing = false;
  if (rangeStart && rangeEnd) {
    const probe = await admin.from("ga4_items_daily").select("id").limit(1);
    if (probe.error) {
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

      <EcommerceKpis data={data.ecommerce} trend={data.trend} />
      <SalesOverview trend={data.trend} revenueKpi={data.ecommerce.revenueMinorUnits} />

      <div className="grid gap-4 lg:grid-cols-2">
        <ConversionFunnel
          sessions={totalSessions}
          engagementRate={website.engagement.engagementRate}
          transactions={data.ecommerce.transactions.value}
        />
        {website.hasData ? <Devices devices={website.devices} /> : null}
      </div>

      <TopProducts products={products} tableMissing={itemsTableMissing} />

      {website.hasData ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <TrafficSources sources={website.sources} />
          <TopPages pages={website.topPages.slice(0, 5)} />
        </div>
      ) : null}

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
