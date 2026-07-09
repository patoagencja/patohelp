import { redirect } from "next/navigation";

import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import {
  BarList,
  ContentSlide,
  CoverSlide,
  CreativesGrid,
  DECK_COLORS,
  DividerSlide,
  Donut,
  DualLineChart,
  LineChart,
  Stat,
} from "@/components/dashboard/report/deck";
import { ReportDeck } from "@/components/dashboard/report/report-deck";
import { clientLogo } from "@/components/dashboard/client-logo";
import { getDemographics, genderLabel } from "@/lib/dashboard/demographics";
import { getWebsiteData } from "@/lib/dashboard/ga4-metrics";
import type { Kpi } from "@/lib/dashboard/metrics";
import { getDashboardData, normalizeRange } from "@/lib/dashboard/metrics";
import { createClient } from "@/lib/supabase/server";
import {
  formatDateWarsaw,
  formatMoneyPLN,
  formatNumberPL,
  formatPercent,
} from "@/lib/utils";

export const dynamic = "force-dynamic";

type Direction = "good" | "bad" | "neutral";

// Compact axis/label formatters so chart axes and the donut centre stay short.
const axisPln = (v: number) =>
  v >= 1000 ? `${(v / 1000).toFixed(1).replace(".", ",")} tys. zł` : `${Math.round(v)} zł`;
const axisNum = (v: number) =>
  v >= 1000 ? `${(v / 1000).toFixed(1).replace(".", ",")} tys.` : `${Math.round(v)}`;
const compactPln = (minorUnits: number) => {
  const v = minorUnits / 100;
  return v >= 1000
    ? `${(v / 1000).toFixed(1).replace(".", ",")} tys. zł`
    : formatMoneyPLN(minorUnits);
};

function deltaSub(kpi: Kpi, direction: Direction) {
  if (kpi.deltaPercent === null) return { text: "-", tone: "flat" as const };
  const r = Math.round(kpi.deltaPercent * 10) / 10;
  const label = `${r > 0 ? "+" : ""}${formatPercent(r, 1)} vs poprz.`;
  if (direction === "neutral" || r === 0) return { text: label, tone: "flat" as const };
  const good = direction === "good" ? r > 0 : r < 0;
  return { text: label, tone: good ? ("up" as const) : ("down" as const) };
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
  const [data, website, demo, creatives] = await Promise.all([
    getDashboardData(client.id, range),
    getWebsiteData(client.id),
    getDemographics(client.id),
    supabase
      .from("creatives")
      .select("ad_name, thumbnail_url, spend_minor_units, ctr")
      .eq("client_id", client.id)
      .order("spend_minor_units", { ascending: false })
      .limit(4)
      .then((res) => res.data ?? []),
  ]);

  const generatedAt = formatDateWarsaw(new Date(), "d MMM yyyy, HH:mm");
  const periodLabel = `${data.rangeStart} - ${data.rangeEnd}`;
  const foot = `${client.name} · ${periodLabel}`;

  // Per-platform aggregates from the campaign list.
  const platform = { meta: { spend: 0, clicks: 0 }, google: { spend: 0, clicks: 0 } };
  for (const c of data.campaigns) {
    const p = c.provider === "meta_ads" ? platform.meta : platform.google;
    p.spend += c.spendMinorUnits;
    p.clicks += c.clicks;
  }

  const topCampaigns = [...data.campaigns]
    .sort((a, b) => b.spendMinorUnits - a.spendMinorUnits)
    .slice(0, 8);

  // Source breakdown total (for %), and the true period total from daily rows.
  const totalSessions = website.hasData
    ? website.sources.reduce((s, x) => s + x.sessions, 0)
    : 0;
  const sessionsTotal = website.sessionsTrend.reduce((s, x) => s + x.sessions, 0);

  const k = data.kpis;

  const genderTotal = demo.gender.reduce((s, g) => s + g.value, 0) || 1;
  const ageTotal = demo.age.reduce((s, a) => s + a.value, 0) || 1;
  const demoSource = (src: "meta" | "ga4" | null) =>
    src === "meta" ? "Wg wyświetleń reklam (Meta)" : "Wg sesji (GA4)";

  return (
    <div className="space-y-6 bg-muted/20 p-6">
      {/* Controls (not printed) */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <h1 className="text-xl font-semibold">Raport - {client.name}</h1>
        <DateRangePicker value={range} />
      </div>

      <ReportDeck
        clientSlug={params.clientSlug}
        range={range}
        rangeLabel={data.rangeLabel}
        foot={foot}
      >
        {/* Cover - MUST stay first (AI summary is injected right after it) */}
        {(() => {
          const Logo = clientLogo(params.clientSlug);
          return (
            <CoverSlide
              title={Logo ? "Raport" : `${client.name} - Raport`}
              eyebrow="Kampania online"
              period={periodLabel}
              monogram={client.name.slice(0, 3).toUpperCase()}
              logo={Logo ? <Logo className="h-9 w-auto" /> : undefined}
            />
          );
        })()}

        {/* ── Section: media data ── */}
        <DividerSlide title="Dane mediowe" subtitle={periodLabel} />

        {/* KPI summary */}
        <ContentSlide
          title="Podsumowanie wyników"
          subtitle={data.rangeLabel}
          section="Dane mediowe"
          foot={foot}
        >
          <div className="grid h-full grid-cols-3 grid-rows-2 gap-4">
            <Stat
              label="Wydatki"
              value={formatMoneyPLN(k.spendMinorUnits.value)}
              {...(() => {
                const d = deltaSub(k.spendMinorUnits, "neutral");
                return { sub: d.text, tone: d.tone };
              })()}
            />
            <Stat
              label="Kliknięcia"
              value={formatNumberPL(k.clicks.value)}
              {...(() => {
                const d = deltaSub(k.clicks, "good");
                return { sub: d.text, tone: d.tone };
              })()}
            />
            <Stat
              label="Sesje (GA4)"
              value={k.sessions.value > 0 ? formatNumberPL(k.sessions.value) : "-"}
              {...(() => {
                const d = deltaSub(k.sessions, "good");
                return { sub: d.text, tone: d.tone };
              })()}
            />
            <Stat
              label="Średni CTR"
              value={formatPercent(k.ctr.value)}
              {...(() => {
                const d = deltaSub(k.ctr, "good");
                return { sub: d.text, tone: d.tone };
              })()}
            />
            <Stat
              label="Średni CPC"
              value={formatMoneyPLN(Math.round(k.cpcMinorUnits.value))}
              {...(() => {
                const d = deltaSub(k.cpcMinorUnits, "bad");
                return { sub: d.text, tone: d.tone };
              })()}
            />
            <Stat
              label="Konwersje"
              value={k.conversions.value > 0 ? formatNumberPL(k.conversions.value) : "-"}
              {...(() => {
                const d = deltaSub(k.conversions, "good");
                return { sub: d.text, tone: d.tone };
              })()}
            />
          </div>
        </ContentSlide>

        {/* Meta vs Google */}
        <ContentSlide
          title="Meta vs Google"
          subtitle="Podział wydatków i kliknięcia wg platformy"
          section="Dane mediowe"
          foot={foot}
        >
          <div className="grid h-full grid-cols-2 gap-10">
            <div className="flex flex-col">
              <p className="mb-3 text-sm font-medium text-slate-500">
                Udział w wydatkach
              </p>
              <div className="min-h-0 flex-1">
                <Donut
                  centerLabel="wydatki"
                  centerValue={compactPln(
                    platform.meta.spend + platform.google.spend
                  )}
                  items={[
                    {
                      label: "Meta",
                      value: platform.meta.spend,
                      display: formatMoneyPLN(platform.meta.spend),
                      color: DECK_COLORS[0],
                    },
                    {
                      label: "Google",
                      value: platform.google.spend,
                      display: formatMoneyPLN(platform.google.spend),
                      color: DECK_COLORS[1],
                    },
                  ]}
                />
              </div>
            </div>
            <div>
              <p className="mb-3 text-sm font-medium text-slate-500">Kliknięcia</p>
              <BarList
                items={[
                  {
                    label: "Meta",
                    value: platform.meta.clicks,
                    display: formatNumberPL(platform.meta.clicks),
                    color: DECK_COLORS[0],
                  },
                  {
                    label: "Google",
                    value: platform.google.clicks,
                    display: formatNumberPL(platform.google.clicks),
                    color: DECK_COLORS[1],
                  },
                ]}
              />
            </div>
          </div>
        </ContentSlide>

        {/* Top campaigns */}
        {topCampaigns.length > 0 ? (
          <ContentSlide
            title="Najważniejsze kampanie"
            subtitle="Wg wydatków"
            section="Dane mediowe"
            foot={foot}
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
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
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="py-2 pr-3 text-slate-500">
                      {c.provider === "meta_ads" ? "Meta" : "Google"}
                    </td>
                    <td className="max-w-[22rem] truncate py-2 pr-3" title={c.name}>
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
          </ContentSlide>
        ) : null}

        {/* Top creatives */}
        {creatives.length > 0 ? (
          <ContentSlide
            title="Najlepsze kreacje"
            subtitle="Meta - wg wydatków"
            section="Dane mediowe"
            foot={foot}
          >
            <CreativesGrid
              items={creatives.map((c) => ({
                name: (c.ad_name as string) || "Reklama",
                thumbnailUrl: (c.thumbnail_url as string) || null,
                spendDisplay: formatMoneyPLN(Number(c.spend_minor_units)),
                ctrDisplay:
                  c.ctr != null ? formatPercent(Number(c.ctr)) : "-",
              }))}
            />
          </ContentSlide>
        ) : null}

        {/* Trend */}
        <ContentSlide
          title="Trend okresu"
          subtitle="Wydatki vs sesje"
          section="Dane mediowe"
          foot={foot}
        >
          <div className="flex h-full flex-col">
            <div className="mb-3 flex gap-5 text-xs">
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-4 rounded-full"
                  style={{ background: DECK_COLORS[0] }}
                />
                Wydatki
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-4 rounded-full"
                  style={{ background: DECK_COLORS[1] }}
                />
                Sesje (GA4)
              </span>
            </div>
            <div className="min-h-0 flex-1">
              <DualLineChart
                a={{
                  values: data.trend.map((t) => t.spendMinorUnits / 100),
                  color: DECK_COLORS[0],
                  format: axisPln,
                }}
                b={{
                  values: data.trend.map((t) => t.sessions),
                  color: DECK_COLORS[1],
                  format: axisNum,
                }}
              />
            </div>
          </div>
        </ContentSlide>

        {/* ── Section: analytics ── */}
        <DividerSlide title="Dane Analytics" subtitle={periodLabel} />

        {website.hasData ? (
          <>
            {/* Traffic overview */}
            <ContentSlide
              title="Ruch na stronie"
              subtitle={data.rangeLabel}
              section="Dane Analytics"
              foot={foot}
            >
              <div className="grid h-full grid-cols-2 gap-8">
                <div className="grid grid-cols-2 content-start gap-4">
                  <Stat label="Sesje" value={formatNumberPL(sessionsTotal)} />
                  <Stat
                    label="Zaangażowanie"
                    value={formatPercent(website.engagement.engagementRate)}
                  />
                  <Stat
                    label="Nowi"
                    value={formatNumberPL(website.newVsReturning.newUsers)}
                  />
                  <Stat
                    label="Powracający"
                    value={formatNumberPL(website.newVsReturning.returningUsers)}
                  />
                </div>
                <div className="flex flex-col">
                  <p className="mb-2 text-sm font-medium text-slate-500">
                    Sesje w czasie
                  </p>
                  <div className="min-h-0 flex-1">
                    <LineChart
                      values={website.sessionsTrend.map((s) => s.sessions)}
                      color={DECK_COLORS[0]}
                      format={axisNum}
                    />
                  </div>
                </div>
              </div>
            </ContentSlide>

            {/* Sources */}
            <ContentSlide
              title="Źródła ruchu"
              subtitle="Sesje wg kategorii"
              section="Dane Analytics"
              foot={foot}
            >
              <BarList
                items={website.sources
                  .slice()
                  .sort((a, b) => b.sessions - a.sessions)
                  .map((s) => ({
                    label: s.category,
                    value: s.sessions,
                    display: `${formatNumberPL(s.sessions)}${
                      totalSessions > 0
                        ? ` (${Math.round((s.sessions / totalSessions) * 100)}%)`
                        : ""
                    }`,
                  }))}
              />
            </ContentSlide>

            {/* Devices + top pages */}
            <ContentSlide
              title="Urządzenia i podstrony"
              subtitle={data.rangeLabel}
              section="Dane Analytics"
              foot={foot}
            >
              <div className="grid h-full grid-cols-2 gap-10">
                <div>
                  <p className="mb-3 text-sm font-medium text-slate-500">Urządzenia</p>
                  <BarList
                    items={website.devices
                      .slice()
                      .sort((a, b) => b.sessions - a.sessions)
                      .map((d) => ({
                        label: d.device,
                        value: d.sessions,
                        display: formatNumberPL(d.sessions),
                      }))}
                  />
                </div>
                <div>
                  <p className="mb-3 text-sm font-medium text-slate-500">
                    Najczęściej odwiedzane
                  </p>
                  <ol className="space-y-1.5 text-sm">
                    {website.topPages.slice(0, 5).map((p, i) => (
                      <li key={p.path} className="flex gap-2">
                        <span className="text-slate-400">{i + 1}.</span>
                        <span className="flex-1 truncate" title={p.path}>
                          {p.path}
                        </span>
                        <span className="tabular-nums text-slate-500">
                          {formatNumberPL(p.views)}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </ContentSlide>
          </>
        ) : (
          <ContentSlide title="Ruch na stronie">
            <p className="text-sm text-slate-500">
              Dane GA4 nie są jeszcze dostępne dla tego okresu. Po pierwszej
              synchronizacji pojawią się tu źródła ruchu, urządzenia i podstrony.
            </p>
          </ContentSlide>
        )}

        {/* ── Section: demographics ── */}
        {demo.hasData ? (
          <>
            <DividerSlide title="Demografia" subtitle={periodLabel} />

            {demo.gender.length > 0 ? (
              <ContentSlide
                title="Demografia - płeć"
                subtitle={demoSource(demo.genderSource)}
                section="Demografia"
                foot={foot}
              >
                <Donut
                  centerLabel="odbiorcy"
                  items={demo.gender.map((g, i) => ({
                    label: genderLabel(g.bucket),
                    value: g.value,
                    display: `${Math.round((g.value / genderTotal) * 100)}%`,
                    color: DECK_COLORS[i % DECK_COLORS.length],
                  }))}
                />
              </ContentSlide>
            ) : null}

            {demo.age.length > 0 ? (
              <ContentSlide
                title="Demografia - wiek"
                subtitle={demoSource(demo.ageSource)}
                section="Demografia"
                foot={foot}
              >
                <BarList
                  items={demo.age.map((a) => ({
                    label: a.bucket,
                    value: a.value,
                    display: `${Math.round((a.value / ageTotal) * 100)}%`,
                    color: DECK_COLORS[0],
                  }))}
                />
              </ContentSlide>
            ) : null}

            {demo.geo.length > 0 ? (
              <ContentSlide
                title="Geografia"
                subtitle="Sesje wg regionu (GA4)"
                section="Demografia"
                foot={foot}
              >
                <BarList
                  items={demo.geo.map((r) => ({
                    label: r.bucket,
                    value: r.value,
                    display: formatNumberPL(r.value),
                  }))}
                />
              </ContentSlide>
            ) : null}
          </>
        ) : null}

        {/* Closing */}
        <DividerSlide
          title="Dziękujemy"
          subtitle={`Przygotowane przez Pato Agencja · wygenerowano ${generatedAt}`}
        />
      </ReportDeck>
    </div>
  );
}
