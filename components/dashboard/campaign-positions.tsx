"use client";

import { useState } from "react";
import { DeltaPill } from "@/components/ui/pill";
import { Ping, type PingTone } from "@/components/ui/primitives";
import { SegmentedTrack, segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { Sparkline } from "@/components/ui/sparkline";

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

// Status = a ping dot + the words (colour is never the only cue). Same
// tones as the overview's "Gdzie idą pieniądze".
const STATUS_PING: Record<CampaignStatus, PingTone> = {
  active: "lime",
  attention: "amber",
  critical: "coral",
  off: "muted",
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

// Card shell + section heading (2026 pastel): glass, mono kicker, 22px title.
const CARD = "glass min-w-0 rounded-glass p-6 sm:p-7";
const H2 = "mt-2 text-[22px] font-medium tracking-[-0.03em] text-foreground";
// Quiet chip button ("Pokaż wszystkie"): 44px, chip fill, press-scale.
const CHIP_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-chip px-[18px] text-sm font-medium text-foreground transition-[background-color,transform] duration-200 hover:bg-[var(--chip-hover)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:active:scale-100";

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
      "średnie dzienne wydatki z ostatnich 4 dni w porównaniu z 3 wcześniejszymi (nie z poprzednim okresem)",
    trendHint: "Dzienne wydatki z ostatnich 7 dni",
    ctrHint: "Klikalność (CTR): jaki odsetek osób, które zobaczyły reklamę, kliknął w nią",
    spent: "wydane",
    kicker: "Kampanie w tym okresie",
    status: "Status",
    platform: "Platforma",
    allPlatforms: "Wszystkie",
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
    changeHint: "average daily spend over the last 4 days vs the 3 days before (not the previous period)",
    trendHint: "Daily spend over the last 7 days",
    ctrHint: "Click rate (CTR): share of people who saw the ad and clicked it",
    spent: "spent",
    kicker: "Campaigns in this period",
    status: "Status",
    platform: "Platform",
    allPlatforms: "All",
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

// Spend change = recent half vs earlier half of the 7-day spark. A simple,
// explainable "is this campaign spending more or less than a few days ago".
function spendChange(spark: number[]): number | null {
  if (spark.length < 4) return null;
  const half = Math.floor(spark.length / 2);
  // Daily averages, not sums: a 7-day spark splits 3 + 4 days, and summing
  // made every campaign look ~33% "up" (+76% rows next to a +11% total).
  const priorDays = spark.slice(0, half);
  const recentDays = spark.slice(half);
  const prior = priorDays.reduce((a, b) => a + b, 0) / priorDays.length;
  const recent = recentDays.reduce((a, b) => a + b, 0) / recentDays.length;
  if (prior <= 0) return null;
  return ((recent - prior) / prior) * 100;
}

// Platform tag (board `.tag`): neutral, the name is the information.
function PlatformPill({ provider }: { provider: AdProvider }) {
  return (
    <span className="inline-flex h-[22px] shrink-0 items-center rounded-full bg-chip px-2 text-[11.5px] font-medium text-ink-2">
      {AD_PROVIDER_LABEL[provider]}
    </span>
  );
}

function Dot({ status }: { status: CampaignStatus }) {
  // Long lists: only rows that need a look keep the ping ring moving.
  return <Ping tone={STATUS_PING[status]} still={status === "active" || status === "off"} />;
}

/** Dot + the status in words; the reason rides in the tooltip. */
function StatusText({ c, lang }: { c: CampaignRow; lang: Lang }) {
  const label = STATUS_LABEL[lang][c.status];
  return (
    <span
      className="inline-flex items-center gap-2 whitespace-nowrap"
      title={c.statusReason ? `${label} - ${c.statusReason}` : label}
    >
      <Dot status={c.status} />
      {label}
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
    <span className={cn("inline-flex", className)}>
      <DeltaPill
        tone={up ? "good" : "bad"}
        direction={up ? "up" : "down"}
        className="px-1.5 text-xs"
      >
        {up ? "+" : "-"}
        {Math.abs(Math.round(value))}%
      </DeltaPill>
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
    <tr className="border-t border-line transition-colors hover:bg-chip">
      <td className="max-w-[22rem] py-3.5 pl-2 pr-4">
        <span className="block truncate text-[15px] font-medium" title={c.name}>
          {c.name}
        </span>
        <span className="mt-[5px] flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-ink-2">
          <PlatformPill provider={c.provider} />
          <StatusText c={c} lang={lang} />
        </span>
      </td>
      <td className="py-3.5 pr-4 text-right text-[15px] font-medium tabular-nums">
        {wholePln(c.spendMinorUnits)}
      </td>
      <td className="py-3.5 pr-4 text-right text-[15px] tabular-nums text-ink-2">
        {formatNumberPL(c.clicks)}
      </td>
      <td className="py-3.5 pr-4 text-right text-[15px] tabular-nums text-ink-2">
        {formatPercent(c.ctr)}
      </td>
      <td className="py-3.5 pr-4 text-right text-[15px] tabular-nums text-ink-2">
        {cpcText(c)}
      </td>
      <td className="py-3.5 pr-4 text-right text-sm">
        <ChangeValue value={change} className="justify-end" />
      </td>
      <td className="py-3.5 pr-2">
        {hasSpark ? (
          <Sparkline
            data={c.spark}
            smooth={false}
            tone={(change ?? 0) >= 0 ? "positive" : "negative"}
            className="ml-auto h-7 w-[88px]"
          />
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
      <div className="flex items-center gap-2 text-[12.5px] text-ink-2">
        <PlatformPill provider={c.provider} />
        <span className="ml-auto">
          <StatusText c={c} lang={lang} />
        </span>
      </div>
      <p className="mt-2 break-words text-[15px] font-medium leading-snug">{c.name}</p>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="kick text-[10.5px]">{t.spend}</p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-[1.375rem] font-light tracking-[-0.03em] tabular-nums">
              {wholePln(c.spendMinorUnits)}
            </span>
            <ChangeValue value={change} className="text-sm" />
          </p>
        </div>
        {hasSpark ? (
          <Sparkline
            data={c.spark}
            smooth={false}
            tone={(change ?? 0) >= 0 ? "positive" : "negative"}
            className="mb-1 h-7 w-[88px] shrink-0"
          />
        ) : null}
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 rounded-[18px] bg-chip p-3 text-sm">
        <div className="min-w-0">
          <dt className="truncate text-xs text-ink-3">{t.clicks}</dt>
          <dd className="font-medium tabular-nums">{formatNumberPL(c.clicks)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="truncate text-xs text-ink-3">{t.ctr}</dt>
          <dd className="font-medium tabular-nums">{formatPercent(c.ctr)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="truncate text-xs text-ink-3">{t.cpc}</dt>
          <dd className="font-medium tabular-nums">{cpcText(c)}</dd>
        </div>
      </dl>
    </li>
  );
}

const MOBILE_COLLAPSED = 4;

type PlatformFilter = "all" | AdProvider;

/**
 * Reklamy page version (board "Kampanie"): five columns a first-time visitor
 * can read (status, campaign, spend, clicks, click rate), biggest spenders
 * first, top N with "Pokaż wszystkie", and a Wszystkie | Meta | Google
 * filter when more than one platform runs. Cost per click, the spend change
 * and the 7-day trend live in the full table behind "Pokaż szczegóły".
 * Hidden rows stay in the DOM and print, so the PDF always has every campaign.
 */
function SimpleCampaigns({
  campaigns,
  filter,
  limit,
  lang,
}: {
  campaigns: CampaignRow[];
  filter: PositionFilter;
  limit: number;
  lang: Lang;
}) {
  const t = COPY[lang];
  const en = lang === "en";
  const [showAll, setShowAll] = useState(false);
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  const providers = (["meta_ads", "google_ads", "tiktok_ads"] as AdProvider[]).filter((p) =>
    campaigns.some((c) => c.provider === p)
  );
  const byStatus =
    filter === "active"
      ? campaigns.filter((c) => c.status !== "off")
      : filter === "attention"
        ? campaigns.filter((c) => c.status === "attention" || c.status === "critical")
        : campaigns;
  const base = platform === "all" ? byStatus : byStatus.filter((c) => c.provider === platform);
  const rows = [...base].sort((a, b) => b.spendMinorUnits - a.spendMinorUnits);
  const totalSpend = rows.reduce((s, c) => s + c.spendMinorUnits, 0);
  const collapsed = !showAll && rows.length > limit;
  const hiddenCount = rows.length - limit;
  const headCls = "kick pb-3 text-[10.5px] font-normal";

  return (
    <section aria-labelledby="campaigns-simple-heading" className={CARD}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="kick">{t.kicker}</p>
          <h2 id="campaigns-simple-heading" className={H2}>
            {t.title}
          </h2>
          <p className="mt-1.5 text-sm text-ink-3">
            {summaryText(lang, filter, rows.length)}
            <span aria-hidden> · </span>
            <span className="font-medium tabular-nums text-foreground">
              {wholePln(totalSpend)}
            </span>{" "}
            {t.spent}
          </p>
        </div>
        {providers.length > 1 ? (
          <SegmentedTrack
            role="group"
            aria-label={t.platform}
            className={cn(segmentedTrack, "max-w-full")}
            data-print-hide
          >
            {(["all", ...providers] as PlatformFilter[]).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={platform === p}
                onClick={() => {
                  setPlatform(p);
                  setShowAll(false);
                }}
                className={segmentedItem(platform === p, "min-h-11 px-4")}
              >
                {p === "all" ? t.allPlatforms : AD_PROVIDER_LABEL[p]}
              </button>
            ))}
          </SegmentedTrack>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-ink-3">
          {campaigns.length === 0 ? t.none : t.empty}
        </p>
      ) : (
        <>
          {/* Phones: name + spend on one line, the facts under it. */}
          <ul className="mt-5 md:hidden">
            {rows.map((c, i) => (
              <li
                key={`${c.provider}:${c.campaignId}`}
                className={cn(
                  "flex items-start gap-3 border-t border-line py-3.5",
                  collapsed && i >= limit && "hidden print:flex"
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="break-words text-[15px] font-medium leading-snug">{c.name}</p>
                  {/* Each fact is unbreakable, so a narrow row wraps
                      between facts rather than inside one. */}
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] tabular-nums text-ink-2">
                    <PlatformPill provider={c.provider} />
                    <StatusText c={c} lang={lang} />
                    <span className="whitespace-nowrap">
                      {formatNumberPL(c.clicks)} {en ? "clicks" : plPlural(c.clicks, "kliknięcie", "kliknięcia", "kliknięć")}
                    </span>
                    <span className="whitespace-nowrap">
                      {t.ctr.toLowerCase()} {formatPercent(c.ctr)}
                    </span>
                  </p>
                </div>
                <span className="shrink-0 text-[15px] font-medium tabular-nums">
                  {wholePln(c.spendMinorUnits)}
                </span>
              </li>
            ))}
          </ul>

          <div className="-mx-2 mt-6 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[640px] text-left">
              <caption className="sr-only">
                {en ? "Campaigns by spend" : "Kampanie według wydatków"}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className={cn(headCls, "w-[10.5rem] pl-2 pr-4")}>{t.status}</th>
                  <th scope="col" className={cn(headCls, "pr-4")}>{t.campaign}</th>
                  <th scope="col" className={cn(headCls, "pr-4 text-right")}>{t.spend}</th>
                  <th scope="col" className={cn(headCls, "pr-4 text-right")}>{t.clicks}</th>
                  <th scope="col" className={cn(headCls, "pr-2 text-right")} title={t.ctrHint}>
                    {t.ctr}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c, i) => (
                  <tr
                    key={`${c.provider}:${c.campaignId}`}
                    className={cn(
                      "border-t border-line transition-colors hover:bg-chip",
                      collapsed && i >= limit && "hidden print:table-row"
                    )}
                  >
                    <td className="py-4 pl-2 pr-4 text-[13px] text-ink-2">
                      <StatusText c={c} lang={lang} />
                    </td>
                    <td className="max-w-[28rem] py-4 pr-4">
                      <span className="block truncate text-[15px] font-medium" title={c.name}>
                        {c.name}
                      </span>
                      <span className="mt-1.5 flex">
                        <PlatformPill provider={c.provider} />
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-4 pr-4 text-right text-[15px] font-semibold tabular-nums">
                      {wholePln(c.spendMinorUnits)}
                    </td>
                    <td className="py-4 pr-4 text-right text-[15px] tabular-nums text-ink-2">
                      {formatNumberPL(c.clicks)}
                    </td>
                    <td className="py-4 pr-2 text-right text-[15px] tabular-nums text-ink-2">
                      {formatPercent(c.ctr)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {rows.length > limit ? (
        <div className="mt-1 flex justify-center border-t border-line pt-5" data-print-hide>
          <button
            type="button"
            aria-expanded={showAll}
            onClick={() => setShowAll((v) => !v)}
            className={CHIP_BUTTON}
          >
            {showAll
              ? en
                ? "Show fewer"
                : "Pokaż mniej"
              : en
                ? `Show all (${hiddenCount} more)`
                : `Pokaż wszystkie (jeszcze ${hiddenCount})`}
          </button>
        </div>
      ) : null}
    </section>
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
  variant = "full",
  limit = 6,
  title,
}: {
  campaigns: CampaignRow[];
  initialFilter?: PositionFilter;
  lang?: Lang;
  /**
   * "full" (default): every column, filters and trends. "simple": the
   * five-column Reklamy table with top `limit` rows and "Pokaż wszystkie".
   */
  variant?: "full" | "simple";
  /** Simple variant only: rows shown before "Pokaż wszystkie". */
  limit?: number;
  /** Overrides the card heading (e.g. inside "Pokaż szczegóły"). */
  title?: string;
}) {
  if (variant === "simple") {
    return (
      <SimpleCampaigns
        campaigns={campaigns}
        filter={initialFilter}
        limit={limit}
        lang={lang}
      />
    );
  }
  return (
    <FullCampaigns
      campaigns={campaigns}
      initialFilter={initialFilter}
      lang={lang}
      title={title}
    />
  );
}

function FullCampaigns({
  campaigns,
  initialFilter,
  lang,
  title,
}: {
  campaigns: CampaignRow[];
  initialFilter: PositionFilter;
  lang: Lang;
  title?: string;
}) {
  const t = COPY[lang];
  // Client-side filtering: instant, no navigation, immune to stale-chunk errors
  // after a fresh deploy (which broke the previous URL-param approach).
  const [filter, setFilter] = useState<PositionFilter>(initialFilter);
  // Phones only: each campaign is a tall card, so eight of them were two
  // screens of scrolling. The biggest spenders first, the rest on request.
  const [showAllMobile, setShowAllMobile] = useState(false);

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
    <section aria-labelledby="campaigns-full-heading" className={CARD}>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="kick">{t.kicker}</p>
          <h2 id="campaigns-full-heading" className={H2}>
            {title ?? t.title}
          </h2>
          <p className="mt-1.5 text-sm text-ink-3">
            {summaryText(lang, filter, filtered.length)}
            <span aria-hidden> · </span>
            <span className="font-medium tabular-nums text-foreground">
              {wholePln(totalSpend)}
            </span>{" "}
            {t.spent}
          </p>
        </div>

        <SegmentedTrack
          className={cn(segmentedTrack, "flex w-full md:inline-flex md:w-auto")}
          role="group"
          aria-label={t.title}
        >
          {FILTER_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={segmentedItem(
                filter === key,
                "min-h-11 flex-1 justify-center px-3.5 text-[13px] md:flex-none"
              )}
            >
              {FILTER_LABEL[lang][key]}
            </button>
          ))}
        </SegmentedTrack>
      </div>

      {filtered.length === 0 ? (
        <p className="mt-6 text-sm text-ink-3">
          {campaigns.length === 0 ? t.none : t.empty}
        </p>
      ) : (
        <>
          <ul className="mt-5 divide-y divide-line md:hidden">
            {(showAllMobile ? filtered : filtered.slice(0, MOBILE_COLLAPSED)).map((c) => (
              <MobileCard key={`${c.provider}:${c.campaignId}`} c={c} lang={lang} />
            ))}
          </ul>
          {filtered.length > MOBILE_COLLAPSED ? (
            <button
              type="button"
              data-print-hide
              onClick={() => setShowAllMobile((v) => !v)}
              className={cn(CHIP_BUTTON, "mt-4 w-full md:hidden")}
            >
              {showAllMobile
                ? lang === "en"
                  ? "Show fewer"
                  : "Pokaż mniej"
                : lang === "en"
                  ? `Show all (${filtered.length - MOBILE_COLLAPSED} more)`
                  : `Pokaż wszystkie (jeszcze ${filtered.length - MOBILE_COLLAPSED})`}
            </button>
          ) : null}

          {/* Inner scroll as a safety net for mid-size screens with long names. */}
          <div className="-mx-2 mt-6 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="[&>th]:kick [&>th]:pb-3 [&>th]:text-[10.5px] [&>th]:font-normal">
                  <th scope="col" className="pl-2 pr-4">{t.campaign}</th>
                  <th scope="col" className="pr-4 text-right">{t.spend}</th>
                  <th scope="col" className="pr-4 text-right">{t.clicks}</th>
                  <th scope="col" className="pr-4 text-right" title={t.ctrHint}>
                    {t.ctr}
                  </th>
                  <th scope="col" className="pr-4 text-right">{t.cpc}</th>
                  <th scope="col" className="pr-4 text-right" title={t.changeHint}>
                    {t.change}
                  </th>
                  <th scope="col" className="pr-2 text-right" title={t.trendHint}>
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
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4 text-xs text-ink-3">
          <span>{t.legend}</span>
          {presentStatuses.map((s) => (
            <span key={s} className="inline-flex items-center gap-2">
              <Dot status={s} />
              {STATUS_LABEL[lang][s]}
            </span>
          ))}
          {/* Visible, not only a header tooltip: "+76%" on every row next to
              "+11%" in the summary looked like a contradiction. */}
          <span className="basis-full sm:ml-auto sm:basis-auto">
            {t.change}: {t.changeHint}.
          </span>
        </div>
      ) : null}
    </section>
  );
}
