import {
  detectCampaignEvents,
  EVENT_LOOKBACK_DAYS,
  type CampaignSpendRow,
  type ChartEvent,
} from "@/lib/dashboard/chart-events";
import {
  kpiRate,
  kpiRatio,
  type CampaignRow,
  type CostTrendPoint,
  type DashboardKpis,
  type EcommerceKpis,
  type PlatformSplit,
  type TrendPoint,
} from "@/lib/dashboard/metrics";
import { RANGE_LABELS, type CustomRange, type RangeKey } from "@/lib/dashboard/ranges";
import { addDaysIso } from "@/lib/demo/profile/anonymize";
import { diffDaysIso, type DemoAds, type DemoCampaign, type DemoDay, type DemoSource } from "@/lib/demo/source";

// The demo's getDashboardData (lib/dashboard/metrics.ts): the same ranges,
// the same "today is partial, compare finished days per day" rule, the same
// baseline-coverage rule and the same campaign health statuses - run on the
// demo source's days instead of Supabase rows. Przegląd, Reklamy, Kreacje,
// Strona www and Sprzedaż all start here, so a number can't differ between
// them for the same days.

export type DemoLang = "pl" | "en";

export interface DemoRange {
  start: string;
  end: string;
  prevStart: string;
  prevEnd: string;
  label: string;
}

const monthStartOf = (s: string) => `${s.slice(0, 7)}-01`;
const daysInMonth = (s: string) => {
  const d = new Date(`${monthStartOf(s)}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
};
export const monthEndOf = (s: string) => `${s.slice(0, 7)}-${String(daysInMonth(s)).padStart(2, "0")}`;
const shiftMonths = (monthStart: string, n: number) => {
  const d = new Date(`${monthStart}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)).toISOString().slice(0, 10);
};

const EN_LABELS: Partial<Record<RangeKey, string>> = { "30d": "last 30 days", "7d": "last 7 days" };

/** The selected period and its baseline, as lib/dashboard/metrics.ts resolves them. */
export function resolveDemoRange(key: RangeKey, custom: CustomRange | null, today: string, lang: DemoLang = "pl"): DemoRange {
  // Public page: ignore absurd custom spans instead of looping over decades.
  if (custom && diffDaysIso(custom.start, custom.end) <= 730) {
    const len = diffDaysIso(custom.start, custom.end) + 1;
    const prevEnd = addDaysIso(custom.start, -1);
    return { start: custom.start, end: custom.end, prevStart: addDaysIso(prevEnd, -(len - 1)), prevEnd, label: `${custom.start} - ${custom.end}` };
  }
  const label = (lang === "en" ? EN_LABELS[key] : undefined) ?? RANGE_LABELS[key];
  if (key === "month") {
    const start = monthStartOf(today);
    const prevStart = shiftMonths(start, -1);
    const prevDays = Math.min(Number(today.slice(8)), daysInMonth(prevStart));
    return { start, end: today, prevStart, prevEnd: addDaysIso(prevStart, prevDays - 1), label };
  }
  if (key === "prev_month") {
    const start = shiftMonths(monthStartOf(today), -1);
    const prevStart = shiftMonths(start, -1);
    return { start, end: monthEndOf(start), prevStart, prevEnd: monthEndOf(prevStart), label };
  }
  const days = key === "7d" ? 7 : key === "90d" ? 90 : key === "365d" ? 365 : 30;
  const start = addDaysIso(today, -(days - 1));
  const prevEnd = addDaysIso(start, -1);
  return { start, end: today, prevStart: addDaysIso(prevEnd, -(days - 1)), prevEnd, label };
}

/**
 * Whether the baseline is in the data: every day but a few (the live rule's
 * slack) must have data. A half-empty baseline reads as "+300%".
 */
export function demoBaselineCovered(src: DemoSource, start: string, end: string): boolean {
  const len = diffDaysIso(start, end) + 1;
  if (len <= 0) return false;
  const slack = Math.min(7, Math.floor(len / 4));
  let missing = 0;
  for (let i = 0; i < len; i++) if (!src.day(addDaysIso(start, i))) missing += 1;
  return missing <= slack;
}

export function demoTrendPoint(d: DemoDay): TrendPoint {
  return {
    date: d.date,
    spendMinorUnits: d.spend,
    sessions: d.sessions,
    clicks: d.clicks,
    impressions: d.impressions,
    conversions: d.conversions,
    revenueMinorUnits: d.revenue,
    transactions: d.orders,
  };
}

export const campaignName = (c: DemoCampaign, lang: DemoLang) => (lang === "en" ? c.nameEn : c.namePl);

const STATUS_REASON = {
  stopped: ["Brak wyświetleń w ostatnich 48 godzinach", "No impressions in the last 48 hours"],
  cpc: ["Koszt kliknięcia ponad 3× wyższy niż średnia konta", "Cost per click over 3× the account average"],
  ctr: ["Klikalność poniżej połowy średniej konta", "Click-through rate below half the account average"],
} as const;

export interface DemoDashboardData {
  kpis: DashboardKpis;
  ecommerce: EcommerceKpis;
  trend: TrendPoint[];
  /** The baseline's days, index-aligned; undefined when it isn't covered. */
  prevTrend?: TrendPoint[];
  campaigns: CampaignRow[];
  costTrend: CostTrendPoint[];
  platformSplit: PlatformSplit;
  range: DemoRange;
  rangeLabel: string;
  comparable: boolean;
  autoEvents: ChartEvent[];
  /** Percent, sessions-weighted over the range. */
  engagementRate: number | null;
}

/** Everything the dashboard pages show for a range, from the demo source. */
export function demoDashboardData(
  src: DemoSource,
  rangeKey: RangeKey = "30d",
  custom: CustomRange | null = null,
  lang: DemoLang = "pl"
): DemoDashboardData {
  const today = src.today;
  const range = resolveDemoRange(rangeKey, custom, today, lang);
  const daysOf = (start: string, end: string) => {
    const out: DemoDay[] = [];
    for (let d = start; d <= end; d = addDaysIso(d, 1)) {
      const v = src.day(d);
      if (v) out.push(v);
    }
    return out;
  };

  // --- current range: future days stay out, as in the live data -------------
  const cur = daysOf(range.start, range.end);
  const trend = cur.map(demoTrendPoint);
  const sum = (list: DemoDay[], pick: (d: DemoDay) => number) => list.reduce((a, d) => a + pick(d), 0);
  const tod = cur.find((d) => d.date === today);
  const todOf = (pick: (d: DemoDay) => number) => (tod ? pick(tod) : 0);

  // --- baseline: only when the data reaches it ---------------------------------
  const comparable = demoBaselineCovered(src, range.prevStart, range.prevEnd);
  const prevDays = comparable ? daysOf(range.prevStart, range.prevEnd) : [];
  const prevTrend = comparable
    ? (() => {
        const out: TrendPoint[] = [];
        for (let d = range.prevStart; d <= range.prevEnd; d = addDaysIso(d, 1)) {
          const v = src.day(d);
          out.push(
            v
              ? demoTrendPoint(v)
              : { date: d, spendMinorUnits: 0, sessions: 0, clicks: 0, impressions: 0, conversions: 0, revenueMinorUnits: 0, transactions: 0 }
          );
        }
        return out;
      })()
    : undefined;

  const c = {
    spend: sum(cur, (d) => d.spend),
    clicks: sum(cur, (d) => d.clicks),
    impressions: sum(cur, (d) => d.impressions),
    conversions: sum(cur, (d) => d.conversions),
    sessions: sum(cur, (d) => d.sessions),
    revenue: sum(cur, (d) => d.revenue),
    orders: sum(cur, (d) => d.orders),
  };
  const p = {
    spend: sum(prevDays, (d) => d.spend),
    clicks: sum(prevDays, (d) => d.clicks),
    impressions: sum(prevDays, (d) => d.impressions),
    conversions: sum(prevDays, (d) => d.conversions),
    sessions: sum(prevDays, (d) => d.sessions),
    revenue: sum(prevDays, (d) => d.revenue),
    orders: sum(prevDays, (d) => d.orders),
  };
  const t = {
    spend: todOf((d) => d.spend),
    clicks: todOf((d) => d.clicks),
    impressions: todOf((d) => d.impressions),
    conversions: todOf((d) => d.conversions),
    sessions: todOf((d) => d.sessions),
    revenue: todOf((d) => d.revenue),
    orders: todOf((d) => d.orders),
  };

  // Same comparison rules as getDashboardData.
  const len = (a: string, b: string) => diffDaysIso(a, b) + 1;
  const partialToday = range.end === today;
  const doneDays = len(range.start, range.end) - (partialToday ? 1 : 0);
  const prevLen = len(range.prevStart, range.prevEnd);
  const useRate = partialToday || doneDays !== prevLen;
  const cmp = (curV: number, todV: number) =>
    useRate ? { value: partialToday ? curV - todV : curV, days: doneDays, prevDays: prevLen } : null;
  const doneRatio = (f: () => number, base: number) =>
    !partialToday ? null : doneDays > 0 && base > 0 ? f() : Number.NaN;
  const ratioKpi = (value: number, previous: number, done: number | null) =>
    done !== null && Number.isNaN(done) ? { value, previous, deltaPercent: null } : kpiRatio(value, previous, done);
  const ctrOf = (clicks: number, impr: number) => (impr > 0 ? (clicks / impr) * 100 : 0);
  const cpcOf = (spend: number, clicks: number) => (clicks > 0 ? spend / clicks : 0);
  const roasOf = (rev: number, spend: number) => (spend > 0 ? rev / spend : 0);
  const aovOf = (rev: number, tx: number) => (tx > 0 ? rev / tx : 0);

  const kpis: DashboardKpis = {
    spendMinorUnits: kpiRate(c.spend, p.spend, cmp(c.spend, t.spend)),
    clicks: kpiRate(c.clicks, p.clicks, cmp(c.clicks, t.clicks)),
    sessions: kpiRate(c.sessions, p.sessions, cmp(c.sessions, t.sessions)),
    ctr: ratioKpi(
      ctrOf(c.clicks, c.impressions),
      ctrOf(p.clicks, p.impressions),
      doneRatio(() => ctrOf(c.clicks - t.clicks, c.impressions - t.impressions), c.impressions - t.impressions)
    ),
    cpcMinorUnits: ratioKpi(
      cpcOf(c.spend, c.clicks),
      cpcOf(p.spend, p.clicks),
      doneRatio(() => cpcOf(c.spend - t.spend, c.clicks - t.clicks), c.clicks - t.clicks)
    ),
    conversions: kpiRate(c.conversions, p.conversions, cmp(c.conversions, t.conversions)),
  };
  const ecommerce: EcommerceKpis = {
    revenueMinorUnits: kpiRate(c.revenue, p.revenue, cmp(c.revenue, t.revenue)),
    transactions: kpiRate(c.orders, p.orders, cmp(c.orders, t.orders)),
    roas: ratioKpi(
      Math.round(roasOf(c.revenue, c.spend) * 100),
      Math.round(roasOf(p.revenue, p.spend) * 100),
      doneRatio(() => Math.round(roasOf(c.revenue - t.revenue, c.spend - t.spend) * 100), c.spend - t.spend)
    ),
    aovMinorUnits: ratioKpi(
      Math.round(aovOf(c.revenue, c.orders)),
      Math.round(aovOf(p.revenue, p.orders)),
      doneRatio(() => Math.round(aovOf(c.revenue - t.revenue, c.orders - t.orders)), c.orders - t.orders)
    ),
  };

  // --- campaigns with the live health statuses -----------------------------------
  const recentStart = addDaysIso(range.end, -1);
  const sparkStart = addDaysIso(range.end, -6);
  const rangeIsCurrent = range.end >= addDaysIso(today, -1);
  const avgCtr = ctrOf(c.clicks, c.impressions);
  const avgCpc = cpcOf(c.spend, c.clicks);
  const reasonIdx = lang === "en" ? 1 : 0;
  const campaigns: CampaignRow[] = [];
  for (const camp of src.campaigns) {
    let spend = 0;
    let clicks = 0;
    let impressions = 0;
    let conversions = 0;
    let recentSpend = 0;
    let recentImpressions = 0;
    let earlierSpend = 0;
    let rows = 0;
    const spark: number[] = [];
    for (let d = range.start; d <= range.end; d = addDaysIso(d, 1)) {
      const a = src.campaignDay(camp.id, d);
      if (d >= sparkStart) spark.push(a?.spend ?? 0);
      if (!a) continue;
      if (a.spend <= 0 && a.impressions <= 0 && a.clicks <= 0) continue;
      rows += 1;
      spend += a.spend;
      clicks += a.clicks;
      impressions += a.impressions;
      conversions += a.conversions;
      if (d >= recentStart) {
        recentSpend += a.spend;
        recentImpressions += a.impressions;
      } else earlierSpend += a.spend;
    }
    if (rows === 0) continue;
    const ctr = ctrOf(clicks, impressions);
    const cpc = clicks > 0 ? spend / clicks : null;
    const isActive = recentSpend > 0 || recentImpressions > 0;
    let status: CampaignRow["status"] = isActive ? "active" : "off";
    let statusReason: string | null = null;
    if (isActive || earlierSpend > 0) {
      if (earlierSpend > 0 && recentImpressions === 0 && recentSpend === 0) {
        if (rangeIsCurrent) {
          status = "critical";
          statusReason = STATUS_REASON.stopped[reasonIdx];
        }
      } else if (cpc != null && avgCpc > 0 && cpc > 3 * avgCpc) {
        status = "critical";
        statusReason = STATUS_REASON.cpc[reasonIdx];
      } else if (avgCtr > 0 && impressions > 500 && ctr < 0.5 * avgCtr) {
        status = "attention";
        statusReason = STATUS_REASON.ctr[reasonIdx];
      }
    }
    while (spark.length < 7) spark.unshift(0);
    campaigns.push({
      campaignId: camp.id,
      provider: camp.provider,
      name: campaignName(camp, lang),
      spendMinorUnits: spend,
      clicks,
      impressions,
      ctr,
      cpcMinorUnits: cpc,
      conversions,
      status,
      statusReason,
      spark: spark.slice(-7),
    });
  }
  campaigns.sort((a, b) => b.spendMinorUnits - a.spendMinorUnits);

  // --- cost per click per platform, split -------------------------------------------
  const costTrend: CostTrendPoint[] = cur.map((d) => ({
    date: d.date,
    metaCpcMinorUnits: d.meta.clicks > 0 ? d.meta.spend / d.meta.clicks : null,
    googleCpcMinorUnits: d.google.clicks > 0 ? d.google.spend / d.google.clicks : null,
  }));
  const platformSplit: PlatformSplit = {
    metaSpendMinorUnits: sum(cur, (d) => d.meta.spend),
    googleSpendMinorUnits: sum(cur, (d) => d.google.spend),
    tiktokSpendMinorUnits: 0,
  };

  let engW = 0;
  let engS = 0;
  for (const d of cur) {
    if (d.engagementRate == null) continue;
    engW += d.sessions * d.engagementRate;
    engS += d.sessions;
  }

  return {
    kpis,
    ecommerce,
    trend,
    prevTrend,
    campaigns,
    costTrend,
    platformSplit,
    range,
    rangeLabel: range.label,
    comparable,
    autoEvents: demoCampaignEvents(src, range.start, range.end, lang),
    engagementRate: engS > 0 ? (engW / engS) * 100 : null,
  };
}

/**
 * "Why did the curve move": campaign starts, pauses and budget changes, by
 * the live detector (detectCampaignEvents) on the demo's campaign days. The
 * chart markers and "Co dla Ciebie zrobiliśmy" both read these.
 */
export function demoCampaignEvents(src: DemoSource, start: string, end: string, lang: DemoLang = "pl"): ChartEvent[] {
  const readStart = [addDaysIso(start, -EVENT_LOOKBACK_DAYS), src.campaignStart].sort().reverse()[0];
  if (readStart > end) return [];
  const rows: CampaignSpendRow[] = [];
  const known: string[] = [];
  for (let d = readStart; d <= end && d <= src.today; d = addDaysIso(d, 1)) {
    let any = false;
    for (const camp of src.campaigns) {
      const a: DemoAds | undefined = src.campaignDay(camp.id, d);
      if (!a) continue;
      any = true;
      if (a.spend > 0) {
        rows.push({ provider: camp.provider, campaignId: camp.id, campaignName: campaignName(camp, lang), date: d, spendMinorUnits: a.spend });
      }
    }
    if (any) known.push(d);
  }
  if (rows.length === 0) return [];
  return detectCampaignEvents({
    rows,
    dataStart: readStart,
    rangeStart: start < readStart ? readStart : start,
    rangeEnd: end,
    today: src.today,
    knownDates: known,
    lang,
  });
}
