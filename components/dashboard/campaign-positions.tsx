"use client";

import { useState } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card, Title } from "@tremor/react";

import type { CampaignRow, CampaignStatus } from "@/lib/dashboard/metrics";
import { AD_PROVIDER_LABEL, type AdProvider } from "@/lib/types";
import { cn, formatMoneyPLN, formatNumberPL, formatPercent } from "@/lib/utils";

type PositionFilter = "all" | "active" | "attention";
type Lang = "pl" | "en";

const FILTER_KEYS: PositionFilter[] = ["all", "active", "attention"];

const FILTER_LABEL: Record<Lang, Record<PositionFilter, string>> = {
  pl: { all: "Wszystkie", active: "Aktywne", attention: "Wymagają uwagi" },
  en: { all: "All", active: "Active", attention: "Need attention" },
};

const STATUS_DOT: Record<CampaignStatus, string> = {
  active: "bg-emerald-500",
  attention: "bg-amber-500",
  critical: "bg-red-500",
  off: "bg-slate-400",
};

const STATUS_LABEL: Record<Lang, Record<CampaignStatus, string>> = {
  pl: {
    active: "Działa dobrze",
    attention: "Do obejrzenia",
    critical: "Wymaga uwagi",
    off: "Wstrzymana",
  },
  en: {
    active: "Doing well",
    attention: "Worth a look",
    critical: "Needs attention",
    off: "Paused",
  },
};

const PLATFORM_PILL: Record<AdProvider, string> = {
  meta_ads: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  google_ads: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  tiktok_ads: "bg-pink-500/10 text-pink-700 dark:text-pink-300",
};

const COPY = {
  pl: {
    title: "Kampanie",
    campaign: "Kampania",
    spend: "Wydatki",
    clicks: "Kliknięcia",
    ctr: "Klikalność",
    cpc: "Koszt kliknięcia",
    change: "Zmiana",
    trend: "Trend 7 dni",
    changeHint:
      "Zmiana wydatków: ostatnie dni w porównaniu z wcześniejszymi dniami tygodnia",
    trendHint: "Dzienne wydatki z ostatnich 7 dni",
    ctrHint: "Klikalność (CTR): jaki odsetek osób, które zobaczyły reklamę, kliknął w nią",
    spent: "wydane",
    empty: "Brak kampanii w tym widoku.",
    none: "Kampanie pojawią się tutaj po pierwszej synchronizacji kont reklamowych.",
    legend: "Status kampanii:",
  },
  en: {
    title: "Campaigns",
    campaign: "Campaign",
    spend: "Spend",
    clicks: "Clicks",
    ctr: "Click rate",
    cpc: "Cost per click",
    change: "Change",
    trend: "7-day trend",
    changeHint: "Spend change: the last few days compared with earlier in the week",
    trendHint: "Daily spend over the last 7 days",
    ctrHint: "Click rate (CTR): share of people who saw the ad and clicked it",
    spent: "spent",
    empty: "No campaigns in this view.",
    none: "Campaigns appear here after the first ad account sync.",
    legend: "Campaign status:",
  },
} as const;

// Polish has three plural forms (1 / 2-4 / 5+, with 12-14 behaving like 5+).
function plPlural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// Always group thousands ("7 581 zł"): pl-PL Intl skips grouping for 4-digit
// numbers, which looks inconsistent next to 5-digit figures in the same line.
function wholePln(minorUnits: number): string {
  const n = Math.round(minorUnits / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${n} zł`;
}

function summaryText(lang: Lang, filter: PositionFilter, count: number): string {
  if (lang === "en") {
    const noun = count === 1 ? "campaign" : "campaigns";
    if (filter === "active") return `${count} active ${noun}`;
    if (filter === "attention")
      return `${count} ${noun} ${count === 1 ? "needs" : "need"} attention`;
    return `${count} ${noun}`;
  }
  const noun = plPlural(count, "kampania", "kampanie", "kampanii");
  if (filter === "active")
    return `${count} ${plPlural(count, "aktywna", "aktywne", "aktywnych")} ${noun}`;
  if (filter === "attention")
    return `${count} ${noun} ${plPlural(count, "wymaga", "wymagają", "wymaga")} uwagi`;
  return `${count} ${noun}`;
}

// Lightweight inline-SVG sparkline. Deliberately NOT Tremor's SparkAreaChart -
// rendering dozens of Recharts instances in an interactive table blocks clicks
// and is slow. This is pure SVG: no deps, no re-render cost, can't throw.
function Sparkline({ values, up }: { values: number[]; up: boolean }) {
  const w = 88;
  const h = 28;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const n = values.length;
  const pts = values.map((v, i) => {
    const x = n > 1 ? (i / (n - 1)) * w : w;
    const y = h - ((v - min) / range) * (h - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = pts.join(" ");
  const area = `0,${h} ${line} ${w},${h}`;

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn(
        "ml-auto block",
        up
          ? "fill-emerald-500 stroke-emerald-500"
          : "fill-red-500 stroke-red-500"
      )}
      aria-hidden
    >
      <polygon points={area} opacity={0.1} stroke="none" />
      <polyline
        points={line}
        fill="none"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// Spend change = recent half vs earlier half of the 7-day spark. A simple,
// explainable "is this campaign spending more or less than a few days ago".
function spendChange(spark: number[]): number | null {
  if (spark.length < 4) return null;
  const half = Math.floor(spark.length / 2);
  const prior = spark.slice(0, half).reduce((a, b) => a + b, 0);
  const recent = spark.slice(half).reduce((a, b) => a + b, 0);
  if (prior <= 0) return null;
  return ((recent - prior) / prior) * 100;
}

function PlatformPill({ provider }: { provider: AdProvider }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        PLATFORM_PILL[provider]
      )}
    >
      {AD_PROVIDER_LABEL[provider]}
    </span>
  );
}

function StatusDot({ c, lang }: { c: CampaignRow; lang: Lang }) {
  const label = STATUS_LABEL[lang][c.status];
  const hint = c.statusReason ? `${label} - ${c.statusReason}` : label;
  return (
    <span className="inline-flex shrink-0 items-center" title={hint}>
      <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[c.status])} />
      <span className="sr-only">{hint}</span>
    </span>
  );
}

function ChangeValue({
  value,
  className,
}: {
  value: number | null;
  className?: string;
}) {
  if (value === null) {
    return <span className={cn("text-muted-foreground", className)}>-</span>;
  }
  const up = value >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 font-medium tabular-nums",
        up
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-red-600 dark:text-red-400",
        className
      )}
    >
      {up ? (
        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />
      )}
      {up ? "+" : ""}
      {Math.round(value)}%
    </span>
  );
}

function cpcText(c: CampaignRow): string {
  return c.cpcMinorUnits != null ? formatMoneyPLN(Math.round(c.cpcMinorUnits)) : "-";
}

function TableRow({ c, lang }: { c: CampaignRow; lang: Lang }) {
  const change = spendChange(c.spark);
  const hasSpark = c.spark.some((v) => v > 0);

  return (
    <tr className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40">
      <td className="max-w-[22rem] py-3.5 pr-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <StatusDot c={c} lang={lang} />
          <PlatformPill provider={c.provider} />
          <span className="truncate text-sm font-medium" title={c.name}>
            {c.name}
          </span>
        </div>
      </td>
      <td className="py-3.5 pr-4 text-right text-sm font-medium tabular-nums">
        {wholePln(c.spendMinorUnits)}
      </td>
      <td className="py-3.5 pr-4 text-right text-sm tabular-nums text-muted-foreground">
        {formatNumberPL(c.clicks)}
      </td>
      <td className="py-3.5 pr-4 text-right text-sm tabular-nums text-muted-foreground">
        {formatPercent(c.ctr)}
      </td>
      <td className="py-3.5 pr-4 text-right text-sm tabular-nums text-muted-foreground">
        {cpcText(c)}
      </td>
      <td className="py-3.5 pr-4 text-right text-sm">
        <ChangeValue value={change} className="justify-end" />
      </td>
      <td className="py-3.5">
        {hasSpark ? (
          <Sparkline values={c.spark} up={(change ?? 0) >= 0} />
        ) : (
          <span className="block text-right text-sm text-muted-foreground">-</span>
        )}
      </td>
    </tr>
  );
}

// Small screens get stacked cards instead of a squeezed 7-column table - the
// table would otherwise force the whole page to scroll sideways at ~390px.
function MobileCard({ c, lang }: { c: CampaignRow; lang: Lang }) {
  const t = COPY[lang];
  const change = spendChange(c.spark);
  const hasSpark = c.spark.some((v) => v > 0);

  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2">
        <StatusDot c={c} lang={lang} />
        <PlatformPill provider={c.provider} />
        <span className="ml-auto text-xs text-muted-foreground">
          {STATUS_LABEL[lang][c.status]}
        </span>
      </div>
      <p className="mt-2 break-words text-sm font-medium leading-snug">{c.name}</p>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{t.spend}</p>
          <p className="flex items-baseline gap-2">
            <span className="text-lg font-semibold tabular-nums">
              {wholePln(c.spendMinorUnits)}
            </span>
            <ChangeValue value={change} className="text-sm" />
          </p>
        </div>
        {hasSpark ? <Sparkline values={c.spark} up={(change ?? 0) >= 0} /> : null}
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-muted/50 p-3 text-sm">
        <div className="min-w-0">
          <dt className="truncate text-xs text-muted-foreground">{t.clicks}</dt>
          <dd className="font-medium tabular-nums">{formatNumberPL(c.clicks)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="truncate text-xs text-muted-foreground">{t.ctr}</dt>
          <dd className="font-medium tabular-nums">{formatPercent(c.ctr)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="truncate text-xs text-muted-foreground">{t.cpc}</dt>
          <dd className="font-medium tabular-nums">{cpcText(c)}</dd>
        </div>
      </dl>
    </li>
  );
}

/**
 * Combined Meta/Google/TikTok campaign list in plain language: spend, clicks,
 * click rate, cost per click, recent spend change and a 7-day trend line.
 * Table on desktop, stacked cards on phones.
 */
export function CampaignPositions({
  campaigns,
  initialFilter = "all",
  lang = "pl",
}: {
  campaigns: CampaignRow[];
  initialFilter?: PositionFilter;
  lang?: Lang;
}) {
  const t = COPY[lang];
  // Client-side filtering: instant, no navigation, immune to stale-chunk errors
  // after a fresh deploy (which broke the previous URL-param approach).
  const [filter, setFilter] = useState<PositionFilter>(initialFilter);

  const base =
    filter === "active"
      ? campaigns.filter((c) => c.status !== "off")
      : filter === "attention"
        ? campaigns.filter(
            (c) => c.status === "attention" || c.status === "critical"
          )
        : campaigns;
  const filtered = [...base].sort(
    (a, b) => b.spendMinorUnits - a.spendMinorUnits
  );
  const totalSpend = filtered.reduce((s, c) => s + c.spendMinorUnits, 0);

  // Only list the statuses that actually appear, so the legend stays short.
  const presentStatuses = (
    ["active", "attention", "critical", "off"] as CampaignStatus[]
  ).filter((s) => campaigns.some((c) => c.status === s));

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <Title>{t.title}</Title>
          <p className="mt-1 text-sm text-muted-foreground">
            {summaryText(lang, filter, filtered.length)}
            <span aria-hidden> · </span>
            <span className="font-medium tabular-nums text-foreground">
              {wholePln(totalSpend)}
            </span>{" "}
            {t.spent}
          </p>
        </div>

        <div
          className="flex w-full rounded-lg bg-muted p-1 md:w-auto"
          role="group"
          aria-label={t.title}
        >
          {FILTER_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={cn(
                "flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors md:flex-none",
                filter === key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {FILTER_LABEL[lang][key]}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          {campaigns.length === 0 ? t.none : t.empty}
        </p>
      ) : (
        <>
          <ul className="mt-5 divide-y divide-border/60 md:hidden">
            {filtered.map((c) => (
              <MobileCard key={`${c.provider}:${c.campaignId}`} c={c} lang={lang} />
            ))}
          </ul>

          {/* Inner scroll as a safety net for mid-size screens with long names. */}
          <div className="mt-5 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="pb-3 pr-4 font-medium">{t.campaign}</th>
                  <th className="pb-3 pr-4 text-right font-medium">{t.spend}</th>
                  <th className="pb-3 pr-4 text-right font-medium">{t.clicks}</th>
                  <th className="pb-3 pr-4 text-right font-medium" title={t.ctrHint}>
                    {t.ctr}
                  </th>
                  <th className="pb-3 pr-4 text-right font-medium">{t.cpc}</th>
                  <th className="pb-3 pr-4 text-right font-medium" title={t.changeHint}>
                    {t.change}
                  </th>
                  <th className="pb-3 text-right font-medium" title={t.trendHint}>
                    {t.trend}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <TableRow key={`${c.provider}:${c.campaignId}`} c={c} lang={lang} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {presentStatuses.length > 0 ? (
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 pt-4 text-xs text-muted-foreground">
          <span>{t.legend}</span>
          {presentStatuses.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[s])} />
              {STATUS_LABEL[lang][s]}
            </span>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
