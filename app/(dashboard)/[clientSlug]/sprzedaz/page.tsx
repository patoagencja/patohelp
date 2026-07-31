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
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import type { EcomAnalysis } from "@/lib/ecom/analysis";
import {
  getDashboardData,
  normalizeRange,
  parseCustomRange,
} from "@/lib/dashboard/metrics";
import { createAdminClient } from "@/lib/supabase/admin";
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
  const data = await getDashboardData(client.id, range, custom);

  // Latest cached AI analysis (service-role read).
  const { data: cached } = await createAdminClient()
    .from("ecom_analyses")
    .select("content, generated_at")
    .eq("client_id", client.id)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const analysis = (cached?.content as EcomAnalysis | undefined) ?? null;

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

      <EcommerceKpis data={data.ecommerce} />
      <RevenueChart trend={data.trend} />

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
