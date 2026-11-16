import type { Anomaly } from "@/lib/alerts/anomalies";
import type { ChartEvent } from "@/lib/dashboard/chart-events";
import type { CampaignRow, CostTrendPoint, DashboardKpis, EcommerceKpis, PlatformSplit, TrendPoint } from "@/lib/dashboard/metrics";
import type { AiSummary, BudgetStatus } from "@/lib/dashboard/overview";
import type { SourceCategory, WebsiteData } from "@/lib/dashboard/ga4-metrics";
import { scoreFromDays, type DailyScore, type ScoreDay } from "@/lib/dashboard/score";
import { buildEngagementYoY, type EngagementYoY } from "@/lib/dashboard/yoy";
import type { CreativeItem } from "@/components/dashboard/creatives-table";
import type { CreativeRow } from "@/components/dashboard/top-creatives";
import { getDemoAlerts } from "@/lib/demo/alerts";
import { DEMO_CREATIVES, DEMO_NEWS, DEMO_PAGES } from "@/lib/demo/brand";
import { demoDashboardData, type DemoLang } from "@/lib/demo/dashboard";
import { addDaysIso } from "@/lib/demo/profile/anonymize";
import { splitExact, type DemoSource } from "@/lib/demo/source";
import { demoAiSummary } from "@/lib/demo/texts";

export type { DemoLang } from "@/lib/demo/dashboard";

export interface DemoNewsItem {
  category: "meta" | "google" | "tiktok" | "ai";
  publishedOn: string;
  title: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
}

export interface DemoDashboard {
  kpis: DashboardKpis;
  ecommerce: EcommerceKpis;
  trend: TrendPoint[];
  /** The 30 days before, for the chart's dashed line; undefined when not in the data. */
  prevTrend?: TrendPoint[];
  comparable: boolean;
  /** Campaign starts, pauses and budget changes (chart markers, agency work). */
  autoEvents: ChartEvent[];
  campaigns: CampaignRow[];
  /** null when the data is too short to score. */
  score: DailyScore | null;
  creatives: CreativeRow[];
  creativesFull: CreativeItem[];
  alerts: Anomaly[];
  budget: BudgetStatus;
  summary: AiSummary;
  costTrend: CostTrendPoint[];
  platformSplit: PlatformSplit;
  website: WebsiteData;
  /** The same 30 days a year earlier; null without last year's data. */
  yoy: EngagementYoY | null;
  news: DemoNewsItem[];
  rangeLabel: string;
}

/** Strona www's 30-day snapshot - Sprzedaż's devices, pages and engagement are the same rows. */
export function demoSite(src: DemoSource): {
  sessions: number;
  devices: Array<{ device: string; sessions: number }>;
  topPages: Array<{ path: string; views: number; engagementRate: number }>;
  engagementRate: number;
} {
  const start = addDaysIso(src.today, -29);
  let sessions = 0;
  let engW = 0;
  let engS = 0;
  for (let d = start; d <= src.today; d = addDaysIso(d, 1)) {
    const v = src.day(d);
    if (!v) continue;
    sessions += v.sessions;
    if (v.engagementRate != null) {
      engW += v.sessions * v.engagementRate;
      engS += v.sessions;
    }
  }
  const devShares = src.devices;
  const devSessions = splitExact(sessions, devShares.map((d) => d.share));
  return {
    sessions,
    devices: devShares.map((d, i) => ({ device: d.device, sessions: devSessions[i] })).sort((a, b) => b.sessions - a.sessions),
    topPages: src.pages.slice(0, DEMO_PAGES.length).map((p, i) => ({
      path: DEMO_PAGES[i],
      views: Math.round(sessions * p.viewsPerSession),
      engagementRate: Math.round(p.engagementRate * 1000) / 10,
    })),
    engagementRate: engS > 0 ? Math.round((engW / engS) * 1000) / 10 : 60,
  };
}

/** GA4 channel groups as the Strona www card buckets them. */
const SOURCE_OF: Record<string, SourceCategory> = {
  meta: "Paid",
  google_ads: "Paid",
  tiktok: "Paid",
  organic_search: "Organic",
  direct: "Direct",
  social_organic: "Social",
  email: "Referral/Inne",
  other: "Referral/Inne",
};

/** The "Puls" by the live score rules on the demo's complete days. */
function demoScore(src: DemoSource, lang: DemoLang): DailyScore | null {
  const days: ScoreDay[] = [];
  for (let i = 56; i >= 1; i--) {
    const v = src.day(addDaysIso(src.today, -i));
    if (v) days.push({ date: v.date, spend: v.spend, clicks: v.clicks, impressions: v.impressions, sessions: v.sessions });
  }
  const s = scoreFromDays(days);
  if (!s || lang !== "en") return s;
  const LABEL: Record<string, string> = { CTR: "CTR", Kliknięcia: "Clicks", "Wizyty na stronie": "Sessions", Wyświetlenia: "Impressions", Forma: "Form", Zaangażowanie: "Engagement", Ruch: "Traffic" };
  const factors = s.factors.map((f) => ({ ...f, label: LABEL[f.label] ?? f.label }));
  // The headline by the same rule, in English.
  const best = [...factors].filter((f) => f.deltaPct !== null).sort((a, b) => (b.deltaPct ?? 0) - (a.deltaPct ?? 0))[0];
  const headline =
    best && best.deltaPct! >= 5
      ? `${best.label}: ${best.deltaPct}% above normal this week 🔥`
      : s.score >= 78
        ? "Strong week - the form holds up."
        : best && best.deltaPct! <= -8
          ? `${best.label}: slightly below normal - we're checking what to improve.`
          : "Steady form - close to your normal.";
  return { ...s, headline, factors, rings: s.rings.map((r) => ({ ...r, label: LABEL[r.label] ?? r.label })) };
}

/** Last year's same window, by the live YoY rules (80% coverage). */
export function demoYoY(src: DemoSource, start: string, end: string): EngagementYoY | null {
  const ads = new Map<string, { spend: number; clicks: number; impressions: number; conversions: number }>();
  const ga4 = new Map<string, number>();
  for (let d = addDaysIso(start, -364); d <= addDaysIso(end, -364); d = addDaysIso(d, 1)) {
    const v = src.day(d);
    if (!v) continue;
    ads.set(d, { spend: v.spend, clicks: v.clicks, impressions: v.impressions, conversions: v.conversions });
    if (v.hasSite) ga4.set(d, v.sessions);
  }
  if (ads.size === 0 && ga4.size === 0) return null;
  return { ...buildEngagementYoY(start, end, ads, ga4), endsToday: end === src.today };
}

const PACE = {
  ok: ["Tempo zgodne z planem.", "Spend on track with the budget."],
  fastHard: ["Zbyt szybkie - wydajemy znacznie powyżej planu.", "Too fast - spending well above plan."],
  fast: ["Lekko za szybkie - wydajemy powyżej planu.", "A little fast - spending above plan."],
  slowHard: ["Zbyt wolne - wydajemy znacznie poniżej planu.", "Too slow - spending well below plan."],
  slow: ["Lekko za wolne - wydajemy poniżej planu.", "A little slow - spending below plan."],
} as const;

/**
 * This month's budget: the month's spend so far plus the last week's pace
 * for the days left, rounded up to a round sum - the plan an agency would
 * have set. Spent and pace by the live rules (lib/dashboard/overview.ts).
 */
export function demoBudget(src: DemoSource, en: boolean): BudgetStatus {
  const today = src.today;
  const monthStart = `${today.slice(0, 7)}-01`;
  const dayOfMonth = Number(today.slice(8, 10));
  const [yy, mm] = today.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  let spent = 0;
  let done = 0;
  for (let d = monthStart; d <= today; d = addDaysIso(d, 1)) {
    const v = src.day(d)?.spend ?? 0;
    spent += v;
    if (d < today) done += v;
  }
  const recent = Array.from({ length: 7 }, (_, i) => src.day(addDaysIso(today, -(i + 1)))?.spend).filter((v): v is number => v !== undefined);
  const pace = recent.length ? recent.reduce((a, v) => a + v, 0) / recent.length : 0;
  const projection = done + pace * (daysInMonth - dayOfMonth + 1);
  const step = projection >= 200_000_00 ? 10_000_00 : 5_000_00;
  const budget = Math.max(step, Math.ceil(projection / step) * step);
  const spentPercent = (spent / budget) * 100;
  const monthPercent = (dayOfMonth / daysInMonth) * 100;
  const deviation = spentPercent - monthPercent;
  const [p, key] =
    deviation > 25 ? (["fast", "fastHard"] as const)
    : deviation > 10 ? (["fast", "fast"] as const)
    : deviation < -25 ? (["slow", "slowHard"] as const)
    : deviation < -10 ? (["slow", "slow"] as const)
    : (["ok", "ok"] as const);
  return {
    hasBudget: true,
    budgetMinorUnits: budget,
    spentMinorUnits: spent,
    spentPercent,
    dayOfMonth,
    daysInMonth,
    monthPercent,
    pace: p,
    paceLabel: PACE[key][en ? 1 : 0],
    month: monthStart,
  };
}

export function getDemoDashboard(src: DemoSource, lang: DemoLang = "pl", now = new Date()): DemoDashboard {
  const en = lang === "en";
  const dd = demoDashboardData(src, "30d", null, lang);
  const { trend, campaigns } = dd;

  // --- Creatives: the Meta campaigns' spend, clicks and impressions, ad by ad.
  const meta = campaigns.filter((c) => c.provider === "meta_ads");
  const sumMeta = (pick: (c: CampaignRow) => number) => meta.reduce((a, c) => a + pick(c), 0);
  const adSpend = splitExact(sumMeta((c) => c.spendMinorUnits), DEMO_CREATIVES.map((c) => c[2]));
  const clickW = DEMO_CREATIVES.map((c) => c[2] / c[4]);
  const adClicks = splitExact(sumMeta((c) => c.clicks), clickW);
  const adImpr = splitExact(sumMeta((c) => c.impressions), clickW.map((w, i) => w / DEMO_CREATIVES[i][3]));
  const creativesFull: CreativeItem[] = DEMO_CREATIVES.map((c, i) => ({
    adId: `demo-ad${i + 1}`,
    name: en ? c[1] : c[0],
    thumbnailUrl: null,
    spend: adSpend[i],
    impressions: adImpr[i],
    clicks: adClicks[i],
    ctr: adImpr[i] > 0 ? Math.round((adClicks[i] / adImpr[i]) * 10_000) / 100 : 0,
    cpc: adClicks[i] > 0 ? Math.round(adSpend[i] / adClicks[i]) : null,
  }));
  const creatives: CreativeRow[] = creativesFull.slice(0, 5).map((c) => ({
    adId: c.adId,
    adName: c.name,
    thumbnailUrl: c.thumbnailUrl,
    spendMinorUnits: c.spend,
    ctr: c.ctr,
    cpcMinorUnits: c.cpc,
  }));

  // --- Website: the same 30 days, split like the shop's GA4 channels.
  const site = demoSite(src);
  const S = trend.reduce((a, p) => a + p.sessions, 0);
  const groups: SourceCategory[] = ["Paid", "Organic", "Direct", "Social", "Referral/Inne"];
  const groupShare = groups.map((g) => src.channels.filter((c) => SOURCE_OF[c.channel] === g).reduce((a, c) => a + c.sessionsShare, 0));
  const groupSessions = splitExact(S, groupShare);
  const done = trend.filter((p) => p.date < src.today);
  let newUsers = 0;
  let returningUsers = 0;
  for (const p of trend) {
    const v = src.day(p.date);
    newUsers += v?.newUsers ?? 0;
    returningUsers += v?.returningUsers ?? 0;
  }
  const website: WebsiteData = {
    hasData: S > 0,
    // Sessions only here; sales per channel live on Sprzedaż.
    sources: groups
      .map((category, i) => ({ category, sessions: groupSessions[i], revenueMinorUnits: 0, transactions: 0 }))
      .filter((s) => s.sessions > 0)
      .sort((a, b) => b.sessions - a.sessions),
    devices: site.devices,
    topPages: site.topPages,
    engagement: {
      engagementRate: site.engagementRate,
      bounceRate: 100 - site.engagementRate,
      avgDailySessions: done.length ? Math.round(done.reduce((a, p) => a + p.sessions, 0) / done.length) : 0,
    },
    newVsReturning: { newUsers, returningUsers },
    sessionsTrend: trend.map((p) => ({ date: p.date, sessions: p.sessions })),
  };

  const news: DemoNewsItem[] = DEMO_NEWS.map((n) => ({
    category: n.category,
    publishedOn: addDaysIso(src.today, -n.ago),
    title: en ? n.en[0] : n.pl[0],
    summary: en ? n.en[1] : n.pl[1],
    sourceName: n.sourceName,
    sourceUrl: n.sourceUrl,
  }));

  return {
    kpis: dd.kpis,
    ecommerce: dd.ecommerce,
    trend,
    prevTrend: dd.prevTrend,
    comparable: dd.comparable,
    autoEvents: dd.autoEvents,
    campaigns,
    score: demoScore(src, lang),
    creatives,
    creativesFull,
    alerts: getDemoAlerts(src, lang, now),
    budget: demoBudget(src, en),
    summary: demoAiSummary(src, lang, now),
    costTrend: dd.costTrend,
    platformSplit: dd.platformSplit,
    website,
    yoy: demoYoY(src, dd.range.start, dd.range.end),
    news,
    rangeLabel: dd.rangeLabel,
  };
}
