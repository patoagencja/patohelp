import { redirect } from "next/navigation";

import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { ReportActions } from "@/components/dashboard/report/report-actions";
import { getWebsiteData } from "@/lib/dashboard/ga4-metrics";
import type { Kpi } from "@/lib/dashboard/metrics";
import { getDashboardData, normalizeRange } from "@/lib/dashboard/metrics";
import { createClient } from "@/lib/supabase/server";
import {
  cn,
  formatDateWarsaw,
  formatMoneyPLN,
  formatNumberPL,
  formatPercent,
} from "@/lib/utils";

export const dynamic = "force-dynamic";

type Direction = "good" | "bad" | "neutral";

function deltaText(kpi: Kpi): string {
  if (kpi.deltaPercent === null) return "—";
  const r = Math.round(kpi.deltaPercent * 10) / 10;
  return `${r > 0 ? "+" : ""}${formatPercent(r, 1)}`;
}

function deltaClass(kpi: Kpi, direction: Direction): string {
  if (kpi.deltaPercent === null || direction === "neutral" || kpi.deltaPercent === 0)
    return "text-muted-foreground";
  const good = direction === "good" ? kpi.deltaPercent > 0 : kpi.deltaPercent < 0;
  return good
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-red-600 dark:text-red-400";
}

function MetricTile({
  label,
  value,
  kpi,
  direction,
}: {
  label: string;
  value: string;
  kpi: Kpi;
  direction: Direction;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold tracking-tight tabular-nums">{value}</p>
      <p className={cn("mt-0.5 text-xs font-medium", deltaClass(kpi, direction))}>
        {deltaText(kpi)} <span className="text-muted-foreground">vs poprz.</span>
      </p>
    </div>
  );
}

export default async function RaportPage({
  params,
  searchParams,
}: {
  params: { clientSlug: string };
  searchParams: { range?: string };
}) {
  const supabase = createClient();

  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("slug", params.clientSlug)
    .single();

  if (!client) {
    redirect("/login");
  }

  const range = normalizeRange(searchParams.range);
  const [data, website] = await Promise.all([
    getDashboardData(client.id, range),
    getWebsiteData(client.id),
  ]);

  const generatedAt = formatDateWarsaw(new Date(), "d MMM yyyy, HH:mm");
  const topCampaigns = [...data.campaigns]
    .sort((a, b) => b.spendMinorUnits - a.spendMinorUnits)
    .slice(0, 8);
  const totalSessions = website.hasData
    ? website.sources.reduce((s, x) => s + x.sessions, 0)
    : 0;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <h1 className="text-xl font-semibold">Raport — {client.name}</h1>
        <DateRangePicker value={range} />
      </div>

      {/* Cover */}
      <div className="rounded-xl border border-border bg-gradient-to-br from-primary/5 to-transparent p-8">
        <p className="text-xs font-medium uppercase tracking-wider text-primary">
          Raport wyników
        </p>
        <h2 className="mt-1 text-3xl font-bold tracking-tight">{client.name}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Okres: <span className="font-medium text-foreground">{data.rangeLabel}</span>{" "}
          ({data.rangeStart} — {data.rangeEnd})
        </p>
        <p className="text-xs text-muted-foreground">Wygenerowano {generatedAt}</p>
      </div>

      <ReportActions clientSlug={params.clientSlug} range={range} />

      {/* KPI summary */}
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Kluczowe metryki
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <MetricTile
            label="Wydatki"
            value={formatMoneyPLN(data.kpis.spendMinorUnits.value)}
            kpi={data.kpis.spendMinorUnits}
            direction="neutral"
          />
          <MetricTile
            label="Kliknięcia"
            value={formatNumberPL(data.kpis.clicks.value)}
            kpi={data.kpis.clicks}
            direction="good"
          />
          <MetricTile
            label="Sesje (GA4)"
            value={
              data.kpis.sessions.value > 0
                ? formatNumberPL(data.kpis.sessions.value)
                : "—"
            }
            kpi={data.kpis.sessions}
            direction="good"
          />
          <MetricTile
            label="Średni CTR"
            value={formatPercent(data.kpis.ctr.value)}
            kpi={data.kpis.ctr}
            direction="good"
          />
          <MetricTile
            label="Średni CPC"
            value={formatMoneyPLN(Math.round(data.kpis.cpcMinorUnits.value))}
            kpi={data.kpis.cpcMinorUnits}
            direction="bad"
          />
          <MetricTile
            label="Konwersje"
            value={
              data.kpis.conversions.value > 0
                ? formatNumberPL(data.kpis.conversions.value)
                : "—"
            }
            kpi={data.kpis.conversions}
            direction="good"
          />
        </div>
      </section>

      {/* Top campaigns */}
      {topCampaigns.length > 0 ? (
        <section className="rounded-xl border border-border bg-card p-6">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Najważniejsze kampanie
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Platforma</th>
                  <th className="py-2 pr-3 font-medium">Kampania</th>
                  <th className="py-2 pr-3 text-right font-medium">Wydatki</th>
                  <th className="py-2 pr-3 text-right font-medium">Kliknięcia</th>
                  <th className="py-2 text-right font-medium">CTR</th>
                </tr>
              </thead>
              <tbody>
                {topCampaigns.map((c) => (
                  <tr
                    key={`${c.provider}:${c.campaignId}`}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="py-2 pr-3 text-muted-foreground">
                      {c.provider === "meta_ads" ? "Meta" : "Google"}
                    </td>
                    <td className="max-w-[20rem] truncate py-2 pr-3" title={c.name}>
                      {c.name}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatMoneyPLN(c.spendMinorUnits)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatNumberPL(c.clicks)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatPercent(c.ctr)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Traffic sources */}
      {website.hasData && totalSessions > 0 ? (
        <section className="rounded-xl border border-border bg-card p-6">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Źródła ruchu (GA4)
          </h3>
          <div className="space-y-2">
            {website.sources
              .slice()
              .sort((a, b) => b.sessions - a.sessions)
              .map((s) => {
                const pct = (s.sessions / totalSessions) * 100;
                return (
                  <div key={s.category} className="flex items-center gap-3 text-sm">
                    <span className="w-28 shrink-0 text-muted-foreground">
                      {s.category}
                    </span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    </span>
                    <span className="w-24 shrink-0 text-right tabular-nums">
                      {formatNumberPL(s.sessions)} ({pct.toFixed(0)}%)
                    </span>
                  </div>
                );
              })}
          </div>
        </section>
      ) : null}

      <p className="pt-2 text-center text-xs text-muted-foreground">
        Przygotowane przez Pato Agencja · dashboard.patoagencja.com
      </p>
    </div>
  );
}
