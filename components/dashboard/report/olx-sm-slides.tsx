import { Fragment } from "react";

import {
  ContentSlide,
  Slide,
  Stat,
} from "@/components/dashboard/report/deck";
import type { OlxSmReportData } from "@/lib/report/olx-sm-data";
import { numCompact, numFmt, plnCompact, plnFmt } from "@/lib/report/olx-sm-data";
import { AD_PROVIDER_LABEL, type AdProvider } from "@/lib/types";
import { cn } from "@/lib/utils";

// Dashboard slide set mirroring the agency's OLX Social Media template v3:
// Cover / Metadata & Naming / Media Results / Creative Assets / Deep Dive /
// Learnings & Recommendations / AI Summary Block. Server-rendered (no charts
// that need hydration), consumed as children by the ReportDeck viewer.

const PROVIDER_SHORT: Record<AdProvider, string> = {
  meta_ads: "META",
  google_ads: "GOOGLE",
  tiktok_ads: "TIKTOK",
};

function FlagChip({ flag }: { flag: string }) {
  const ok = /^ok/i.test(flag);
  return (
    <span
      className={cn(
        "inline-block rounded-md px-2.5 py-1 text-xs font-bold",
        ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
      )}
    >
      {flag}
    </span>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="bg-[#002F34] px-2.5 py-1.5 text-left text-[11px] font-semibold text-white first:rounded-l-md last:rounded-r-md">
      {children}
    </th>
  );
}
function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={cn("border-b border-slate-100 px-2.5 py-1.5 text-xs text-slate-700", className)}>
      {children}
    </td>
  );
}

/** Cover in OLX brand dark teal. */
function OlxCover({ data }: { data: OlxSmReportData }) {
  return (
    <Slide dark className="justify-between p-12" key="cover">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 120% at 100% 0%, rgba(13,148,136,0.5) 0%, rgba(0,47,52,0) 55%), #002F34",
        }}
      />
      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-teal-300">
          <span className="inline-block h-2 w-2 rounded-full bg-teal-300" />
          patoagencja
        </div>
        <span className="text-2xl font-black tracking-tight text-white">olx</span>
      </div>
      <div className="relative">
        <p className="mb-2 text-sm font-medium uppercase tracking-wider text-teal-300">
          Social Media - Campaign Report
        </p>
        <h1 className="text-6xl font-bold leading-none tracking-tight text-white">
          {data.monthLabel}
        </h1>
        <div className="mt-6 h-1 w-24 rounded-full bg-teal-400" />
        <div className="mt-5 space-y-1">
          {data.topCampaignNames.slice(0, 3).map((c) => (
            <p key={`${c.provider}:${c.name}`} className="font-mono text-[11px] text-slate-300">
              <span className="text-teal-300">{PROVIDER_SHORT[c.provider]}</span>{" "}
              · {c.name}
            </p>
          ))}
        </div>
      </div>
      <div className="relative grid grid-cols-4 gap-4">
        {(
          [
            ["AGENCJA", "patoagencja (PATO)"],
            ["OKRES", data.periodLabel],
            ["BUDŻET ŁĄCZNIE", plnFmt(data.totalCost)],
            [
              "KANAŁY",
              data.channels.map((c) => AD_PROVIDER_LABEL[c.provider]).join(" · ") || "-",
            ],
          ] as Array<[string, string]>
        ).map(([label, value]) => (
          <div key={label}>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-teal-300">
              {label}
            </p>
            <p className="mt-1 text-sm font-semibold text-white">{value}</p>
          </div>
        ))}
      </div>
    </Slide>
  );
}

export function olxSmSlides(data: OlxSmReportData, foot: string): React.ReactNode[] {
  const channelLabel = (p: AdProvider) => AD_PROVIDER_LABEL[p];

  return [
    <OlxCover key="cover" data={data} />,

    // ---- 1. Metadata & Campaign Naming ----
    <ContentSlide
      key="naming"
      section="1 · Goods / Brand"
      title="Metadata & Campaign Naming"
      subtitle="Segmenty nazwy kampanii · pełne naming strings per platforma"
      foot={foot}
    >
      <div className="grid h-full grid-cols-2 gap-6">
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-teal-600">
            Segmenty nazwy kampanii
          </p>
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <Th>Segment</Th>
                <Th>Wartość</Th>
              </tr>
            </thead>
            <tbody>
              {data.namingSegments.slice(0, 9).map((s) => (
                <tr key={s.segment}>
                  <Td className="font-semibold">{s.segment}</Td>
                  <Td>{s.value}</Td>
                </tr>
              ))}
              {data.namingSegments.length === 0 ? (
                <tr>
                  <Td>-</Td>
                  <Td>Brak kampanii w okresie</Td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-teal-600">
            Pełne nazwy kampanii per platforma
          </p>
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <Th>Kanał</Th>
                <Th>Pełna nazwa kampanii</Th>
              </tr>
            </thead>
            <tbody>
              {data.topCampaignNames.slice(0, 5).map((c) => (
                <tr key={`${c.provider}:${c.name}`}>
                  <Td className="whitespace-nowrap font-semibold">
                    {channelLabel(c.provider)}
                  </Td>
                  <Td className="break-all font-mono text-[10px]">{c.name}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-auto">
            <p className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-widest text-teal-600">
              Budget & Channels
            </p>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Budget total" value={plnCompact(data.totalCost)} accent="#0d9488" />
              {data.channels.slice(0, 2).map((c) => (
                <Stat
                  key={c.provider}
                  label={PROVIDER_SHORT[c.provider]}
                  value={plnCompact(c.cost)}
                  accent="#0d9488"
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </ContentSlide>,

    // ---- 2. Media Results ----
    <ContentSlide
      key="results"
      section="2 · Media Results"
      title="Media Results"
      subtitle={`KPI per kanał · headline KPIs · 3-month lookback · ${data.monthLabel}`}
      foot={foot}
    >
      <div className="flex h-full flex-col gap-5">
        <table className="w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <Th>Channel</Th>
              <Th>Reach*</Th>
              <Th>Impr.</Th>
              <Th>Freq.</Th>
              <Th>Clicks</Th>
              <Th>CPC</Th>
              <Th>CPM</Th>
              <Th>Cost</Th>
            </tr>
          </thead>
          <tbody>
            {data.channels.map((c) => (
              <tr key={c.provider}>
                <Td className="font-semibold">{channelLabel(c.provider)}</Td>
                <Td>{c.reach > 0 ? numFmt(c.reach) : "-"}</Td>
                <Td>{numFmt(c.impressions)}</Td>
                <Td>{c.frequency ? c.frequency.toFixed(2) : "-"}</Td>
                <Td>{numFmt(c.clicks)}</Td>
                <Td>{c.cpc ? plnFmt(Math.round(c.cpc)) : "-"}</Td>
                <Td>{c.cpm ? plnFmt(Math.round(c.cpm)) : "-"}</Td>
                <Td className="font-semibold">{plnFmt(c.cost)}</Td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="grid grid-cols-4 gap-3">
          <Stat
            label="Total reach*"
            value={data.totalReach > 0 ? numCompact(data.totalReach) : "-"}
            accent="#0d9488"
          />
          <Stat
            label="Top CPM (najniższy)"
            value={data.bestCpm ? plnFmt(Math.round(data.bestCpm.cpm)) : "-"}
            accent="#0d9488"
          />
          <Stat
            label="Top frequency"
            value={data.topFrequency ? data.topFrequency.frequency.toFixed(2) : "-"}
            accent="#f59e0b"
          />
          <Stat label="Budget spent" value={plnCompact(data.totalCost)} accent="#0d9488" />
        </div>

        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-teal-600">
            3-month lookback
          </p>
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <Th>Channel</Th>
                {data.lookback[0]?.months.map((m) => <Th key={m.label}>{m.label}</Th>)}
              </tr>
            </thead>
            <tbody>
              {data.lookback.map((l) => (
                <tr key={l.provider}>
                  <Td className="font-semibold">{channelLabel(l.provider)}</Td>
                  {l.months.map((m) => (
                    <Td key={m.label}>
                      {m.cpm
                        ? `${plnFmt(Math.round(m.cpm))} CPM · R: ${numCompact(m.reach)}`
                        : "-"}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] italic text-slate-400">
            * Reach = suma dziennych zasięgów (bez deduplikacji między dniami).
          </p>
        </div>
      </div>
    </ContentSlide>,

    // ---- 3. Creative Assets ----
    <ContentSlide
      key="creatives"
      section="3 · Creative Assets"
      title="Creative Assets"
      subtitle="Top kreacje wg wyświetleń i kliknięć (Meta)"
      foot={foot}
    >
      <div className="grid h-full grid-cols-2 gap-6">
        {(
          [
            ["META - TOP WYŚWIETLENIA", data.creativesReach],
            ["META - TOP KLIKNIĘCIA", data.creativesTraffic],
          ] as Array<[string, OlxSmReportData["creativesReach"]]>
        ).map(([title, items]) => (
          <div key={title}>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-teal-600">
              {title}
            </p>
            {items.length === 0 ? (
              <p className="text-sm text-slate-500">
                Brak danych o kreacjach (synchronizacja co 6h).
              </p>
            ) : (
              <div className="space-y-3">
                {items.map((cr, i) => (
                  <div
                    key={`${cr.name}-${i}`}
                    className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3"
                  >
                    {cr.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={cr.thumbnailUrl}
                        alt=""
                        className="h-14 w-14 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-lg font-bold text-teal-700">
                        #{i + 1}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800" title={cr.name}>
                        {cr.name}
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-slate-500">
                        {cr.metricLabel}: {cr.metricValue}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </ContentSlide>,

    // ---- 4. Deep Dive ----
    <ContentSlide
      key="deepdive"
      section="4 · Deep Dive"
      title="Deep Dive"
      subtitle="Analiza per kanał · flagi · pytania do OLX"
      foot={foot}
    >
      <div className="flex h-full min-h-0 flex-col gap-4">
        <div className="grid min-h-0 flex-1 grid-cols-3 gap-4">
          {(
            [
              ["Meta", data.ai.metaFlag, data.ai.metaBullets],
              ["TikTok", data.ai.tiktokFlag, data.ai.tiktokBullets],
              ["Kampanie / kategorie", data.ai.categoriesFlag, data.ai.categoriesBullets],
            ] as Array<[string, string, string[]]>
          ).map(([title, flag, bullets]) => (
            <div
              key={title}
              className="min-h-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-4"
            >
              <p className="text-sm font-bold text-slate-800">{title}</p>
              <div className="mt-1.5">
                <FlagChip flag={flag} />
              </div>
              <ul className="mt-2.5 space-y-1.5">
                {bullets.slice(0, 4).map((b, i) => (
                  <li key={i} className="flex gap-2 text-[11px] leading-snug text-slate-600">
                    <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-teal-500" />
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="shrink-0 rounded-xl bg-[#002F34] px-5 py-3 text-xs leading-relaxed text-white">
          <span className="font-bold text-teal-300">PYTANIA / DECYZJE DLA OLX: </span>
          {data.ai.questions}
        </div>
      </div>
    </ContentSlide>,

    // ---- 5. Learnings & Recommendations ----
    <ContentSlide
      key="learnings"
      section="5 · Learnings & Reco"
      title="Learnings & Recommendations"
      subtitle="Co zadziałało · co robić dalej · priorytety"
      foot={foot}
    >
      <div className="grid h-full grid-cols-2 gap-6">
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-teal-600">
            Key learnings
          </p>
          <div className="space-y-3">
            {data.ai.learnings.slice(0, 3).map((l, i) => (
              <div key={i} className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <span className="text-lg font-black text-teal-600">L{i + 1}</span>
                <p className="text-sm leading-relaxed text-slate-700">{l}</p>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-teal-600">
            Recommendations
          </p>
          <div className="space-y-3">
            {data.ai.recommendations.slice(0, 3).map((r, i) => (
              <div key={i} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <span
                  className={cn(
                    "shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold",
                    r.priority === "HIGH"
                      ? "bg-teal-600 text-white"
                      : "bg-slate-200 text-slate-700"
                  )}
                >
                  {r.priority}
                </span>
                <p className="text-sm leading-relaxed text-slate-700">{r.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ContentSlide>,

    // ---- 6. AI Summary Block ----
    <Slide key="aiblock" dark className="p-12">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "#002F34" }}
      />
      <div className="relative flex h-full flex-col">
        <div className="flex items-center justify-between">
          <h3 className="text-3xl font-bold text-white">AI Summary Block</h3>
          <span className="rounded-md bg-teal-300 px-2.5 py-1 text-sm font-black text-[#002F34]">
            6
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-400">
          Machine-readable - generowane automatycznie z Pato Dashboard.
        </p>
        <div className="mt-6 grid flex-1 grid-cols-[auto_1fr] content-start gap-x-8 gap-y-2.5 font-mono text-[13px]">
          {(
            [
              ["REPORT_ID", `OLX_SM_${data.monthCode}`],
              ["PERIOD", data.periodLabel],
              ["CHANNELS", data.channels.map((c) => PROVIDER_SHORT[c.provider]).join(".") || "-"],
              [
                "BUDGET_SPENT",
                `${plnFmt(data.totalCost)} (${data.channels
                  .map((c) => `${PROVIDER_SHORT[c.provider]}: ${plnFmt(c.cost)}`)
                  .join(" · ")})`,
              ],
              [
                "TOP_CPM",
                data.bestCpm
                  ? `${PROVIDER_SHORT[data.bestCpm.provider]}: ${plnFmt(Math.round(data.bestCpm.cpm))}`
                  : "-",
              ],
              [
                "TOP_REACH",
                data.totalReach > 0 ? `Total: ${numFmt(data.totalReach)} (bez dedup.)` : "-",
              ],
              ["MAIN_LEARNING_1", data.ai.mainLearnings[0] ?? "-"],
              ["MAIN_LEARNING_2", data.ai.mainLearnings[1] ?? "-"],
              ["MAIN_LEARNING_3", data.ai.mainLearnings[2] ?? "-"],
              ["FLAG_ANOMALY", data.ai.flagAnomaly],
              ["TREND_VS_PREV_MONTH", data.ai.trendVsPrev],
              ["AGENCY_CODE", "PATO"],
            ] as Array<[string, string]>
          ).map(([k, v]) => (
            <Fragment key={k}>
              <span className="font-bold text-teal-300">{k}:</span>
              <span className="break-words text-slate-100">{v}</span>
            </Fragment>
          ))}
        </div>
      </div>
    </Slide>,
  ];
}
