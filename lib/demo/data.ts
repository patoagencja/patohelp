import { format, subDays } from "date-fns";

import type { Anomaly } from "@/lib/alerts/anomalies";
import type {
  CampaignRow,
  CostTrendPoint,
  DashboardKpis,
  Kpi,
  PlatformSplit,
  TrendPoint,
} from "@/lib/dashboard/metrics";
import type { AiSummary, BudgetStatus } from "@/lib/dashboard/overview";
import type { WebsiteData } from "@/lib/dashboard/ga4-metrics";
import type { DailyScore } from "@/lib/dashboard/score";
import type { CreativeItem } from "@/components/dashboard/creatives-table";
import type { CreativeRow } from "@/components/dashboard/top-creatives";
import type { AdProvider } from "@/lib/types";

export interface DemoNewsItem {
  category: "meta" | "google" | "tiktok" | "ai";
  publishedOn: string;
  title: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
}

// Fully synthetic dashboard data for the PUBLIC /demo showcase. No database, no
// real client - just believable numbers so a prospect can see the whole product
// from a single link. Deterministic (seeded) so the numbers are stable.

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const DAYS = 30;

interface DemoDashboard {
  kpis: DashboardKpis;
  trend: TrendPoint[];
  campaigns: CampaignRow[];
  score: DailyScore;
  creatives: CreativeRow[];
  creativesFull: CreativeItem[];
  alerts: Anomaly[];
  alertsFull: Anomaly[];
  budget: BudgetStatus;
  summary: AiSummary;
  costTrend: CostTrendPoint[];
  platformSplit: PlatformSplit;
  website: WebsiteData;
  news: DemoNewsItem[];
  rangeLabel: string;
}

export function getDemoDashboard(today = new Date()): DemoDashboard {
  const rand = seeded(20260729);

  // --- 30-day trend with a gentle upward drift and weekend dips -------------
  const trend: TrendPoint[] = [];
  for (let i = 0; i < DAYS; i++) {
    const date = subDays(today, DAYS - 1 - i);
    const dow = date.getDay();
    const weekend = dow === 0 || dow === 6 ? 0.78 : 1;
    const drift = 1 + (i / (DAYS - 1)) * 0.28;
    const noise = 0.9 + rand() * 0.2;
    const spend = Math.round(135000 * drift * weekend * noise); // grosze/day
    const clicks = Math.round((spend / 100 / 0.95) * (0.95 + rand() * 0.1));
    const impressions = Math.round(clicks / (0.019 + rand() * 0.004));
    const sessions = Math.round(clicks * (0.72 + rand() * 0.12));
    const conversions = Math.round(clicks * (0.028 + rand() * 0.01));
    trend.push({
      date: format(date, "yyyy-MM-dd"),
      spendMinorUnits: spend,
      sessions,
      clicks,
      impressions,
      conversions,
    });
  }

  const sum = (f: (p: TrendPoint) => number) => trend.reduce((a, p) => a + f(p), 0);
  const half = Math.floor(DAYS / 2);
  const recent = trend.slice(half);
  const older = trend.slice(0, half);
  const sumR = (f: (p: TrendPoint) => number) => recent.reduce((a, p) => a + f(p), 0);
  const sumO = (f: (p: TrendPoint) => number) => older.reduce((a, p) => a + f(p), 0);

  const mkKpi = (value: number, previous: number): Kpi => ({
    value,
    previous,
    deltaPercent: previous > 0 ? ((value - previous) / previous) * 100 : null,
  });

  const curSpend = sum((p) => p.spendMinorUnits);
  const curClicks = sum((p) => p.clicks);
  const curSessions = sum((p) => p.sessions);
  const curImpr = sum((p) => p.impressions);
  const curConv = sum((p) => p.conversions);
  const ctrVal = (curClicks / curImpr) * 100;
  const cpcVal = Math.round(curSpend / curClicks);

  // Previous period (scaled down so most deltas read positive).
  const kpis: DashboardKpis = {
    spendMinorUnits: mkKpi(curSpend, Math.round(curSpend * 0.9)),
    clicks: mkKpi(curClicks, Math.round(curClicks * 0.86)),
    sessions: mkKpi(curSessions, Math.round(curSessions * 0.83)),
    ctr: mkKpi(
      Number(ctrVal.toFixed(2)),
      Number((ctrVal * 0.94).toFixed(2))
    ),
    cpcMinorUnits: mkKpi(cpcVal, Math.round(cpcVal * 1.07)), // cpc down = good
    conversions: mkKpi(curConv, Math.round(curConv * 0.88)),
  };

  // --- Campaigns (Meta + Google) --------------------------------------------
  const campaignDefs: Array<{
    id: string;
    provider: AdProvider;
    name: string;
    weight: number;
    ctr: number;
    status: CampaignRow["status"];
    reason: string | null;
  }> = [
    { id: "d-m1", provider: "meta_ads", name: "BRAND | Świadomość | Reach", weight: 0.2, ctr: 0.9, status: "active", reason: null },
    { id: "d-m2", provider: "meta_ads", name: "TRAFFIC | Ruch na stronę", weight: 0.17, ctr: 2.1, status: "active", reason: null },
    { id: "d-m3", provider: "meta_ads", name: "ENGAGEMENT | Instagram", weight: 0.11, ctr: 2.8, status: "active", reason: null },
    { id: "d-m4", provider: "meta_ads", name: "RETARGETING | Odwiedzający", weight: 0.08, ctr: 2.4, status: "attention", reason: "Rosnący koszt kliknięcia" },
    { id: "d-g1", provider: "google_ads", name: "SEARCH | Marka", weight: 0.08, ctr: 8.5, status: "active", reason: null },
    { id: "d-g2", provider: "google_ads", name: "SEARCH | Generyczne", weight: 0.16, ctr: 4.5, status: "active", reason: null },
    { id: "d-g3", provider: "google_ads", name: "PMAX | Ruch", weight: 0.13, ctr: 1.8, status: "attention", reason: "Wydatki powyżej normy" },
    { id: "d-g4", provider: "google_ads", name: "YT | Wideo", weight: 0.07, ctr: 1.1, status: "active", reason: null },
  ];

  const campaigns: CampaignRow[] = campaignDefs.map((c, idx) => {
    const spend = Math.round(curSpend * c.weight);
    const clicks = Math.round(curClicks * c.weight * (0.9 + rand() * 0.2));
    const impressions = Math.round((clicks / c.ctr) * 100);
    const cpc = clicks > 0 ? Math.round(spend / clicks) : null;
    // last-7 spark with a slight rising tilt
    const spark = Array.from({ length: 7 }, (_, i) =>
      Math.round((spend / 7) * (0.8 + (i / 6) * 0.5) * (0.9 + rand() * 0.2))
    );
    return {
      campaignId: c.id,
      provider: c.provider,
      name: c.name,
      spendMinorUnits: spend,
      clicks,
      impressions,
      ctr: c.ctr,
      cpcMinorUnits: cpc,
      conversions: Math.round(curConv * c.weight),
      status: c.status,
      statusReason: c.reason,
      spark: idx % 4 === 3 ? spark.map((v, i) => Math.round(v * (1.1 - i * 0.05))) : spark,
    };
  });

  // --- Puls (3 rings) --------------------------------------------------------
  const score: DailyScore = {
    score: 86,
    prevScore: 82,
    delta: 4,
    tier: "high",
    streak: 14,
    date: format(today, "yyyy-MM-dd"),
    headline: "Kliknięcia w tym tygodniu wyżej o 16% 🔥",
    factors: [
      { key: "ctr", label: "CTR", deltaPct: 8 },
      { key: "clicks", label: "Kliknięcia", deltaPct: 16 },
      { key: "sessions", label: "Sesje", deltaPct: 12 },
      { key: "reach", label: "Zasięg", deltaPct: 5 },
    ],
    rings: [
      { key: "form", label: "Forma", value: 86, tier: "high" },
      { key: "engagement", label: "Zaangażowanie", value: 81, tier: "high" },
      { key: "traffic", label: "Ruch", value: 89, tier: "high" },
    ],
  };

  // --- Creatives (sharp placeholder images) ----------------------------------
  const creatives: CreativeRow[] = [
    ["Wideo | Poradnik montażu 30s", 184050, 2.6, 34, 11],
    ["Karuzela | Nowa kolekcja", 152300, 2.5, 36, 22],
    ["Grafika | Świadomość marki", 141200, 0.9, 49, 33],
    ["Retargeting | Porzucony koszyk", 118900, 3.2, 39, 44],
    ["Reels | Opinie klientów", 104500, 2.3, 32, 55],
  ].map((c, i) => ({
    adId: `demo-ad${i + 1}`,
    adName: `DEMO | ${c[0]}`,
    thumbnailUrl: `https://picsum.photos/seed/${c[4]}/600/600`,
    spendMinorUnits: c[1] as number,
    ctr: c[2] as number,
    cpcMinorUnits: c[3] as number,
  }));

  // --- Alerts (drive the animated digest) -----------------------------------
  const alerts: Anomaly[] = [
    {
      id: "a1",
      severity: "critical",
      scope: "campaign",
      scopeLabel: "PMAX | Ruch · Google",
      metric: "spend",
      direction: "up",
      changePct: 128,
      title: "Skok wydatków dziś: 1 809 zł",
      description: "Wydatki kampanii znacząco powyżej średniej dziennej.",
    },
    {
      id: "a2",
      severity: "high",
      scope: "campaign",
      scopeLabel: "RETARGETING | Odwiedzający · Meta",
      metric: "spend",
      direction: "up",
      changePct: 42,
      title: "Podwyższone wydatki (7 dni): 5 396 zł",
      description: "Tydzień powyżej poprzednich dwóch tygodni.",
    },
    {
      id: "a3",
      severity: "medium",
      scope: "client",
      scopeLabel: "Cały profil",
      metric: "ctr",
      direction: "up",
      changePct: 11,
      title: "CTR rośnie: +11% względem normy",
      description: "Zaangażowanie w tym tygodniu wyższe niż zwykle.",
    },
  ];

  // --- Budget ---------------------------------------------------------------
  const dayOfMonth = today.getDate();
  const daysInMonth = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    0
  ).getDate();
  const budgetMinor = 5000000; // 50 000 zł
  const spentMinor = Math.round(budgetMinor * (dayOfMonth / daysInMonth) * 0.94);
  const budget: BudgetStatus = {
    hasBudget: true,
    budgetMinorUnits: budgetMinor,
    spentMinorUnits: spentMinor,
    spentPercent: (spentMinor / budgetMinor) * 100,
    dayOfMonth,
    daysInMonth,
    monthPercent: (dayOfMonth / daysInMonth) * 100,
    pace: "ok",
    paceLabel: "Wydatki w tempie zgodnym z budżetem",
    month: format(today, "yyyy-MM-01"),
  };

  // --- AI summary -----------------------------------------------------------
  const summary: AiSummary = {
    summaryText:
      "W tym tygodniu ruch z kampanii rośnie - liczba kliknięć wzrosła o 16% względem poprzedniego okresu, a CTR utrzymuje się powyżej średniej. Najlepiej pracuje kampania wideo „Poradnik montażu” oraz retargeting. Sesje w GA4 rosną głównie z ruchu płatnego i organicznego z Google. Rekomendacja: przenieść część budżetu na najlepsze kreacje wideo i utrzymać retargeting.",
    generatedAt: today.toISOString(),
    periodStart: format(subDays(today, 6), "yyyy-MM-dd"),
    periodEnd: format(today, "yyyy-MM-dd"),
  };

  // --- Creatives (full fields, for the Kreacje table + podium) ---------------
  const creativesFull: CreativeItem[] = [
    ["Wideo | Poradnik montażu 30s", 184050, 2.6, 34, 11],
    ["Karuzela | Nowa kolekcja", 152300, 2.5, 36, 22],
    ["Grafika | Świadomość marki", 141200, 0.9, 49, 33],
    ["Retargeting | Porzucony koszyk", 118900, 3.2, 39, 44],
    ["Reels | Opinie klientów", 104500, 2.3, 32, 55],
    ["Statyk | Promocja -20%", 96700, 2.2, 37, 66],
    ["Wideo | Behind the scenes", 81200, 1.2, 44, 77],
    ["Grafika | Bestsellery", 72400, 2.4, 34, 88],
    ["Karuzela | Zestawy", 61300, 2.0, 41, 99],
    ["Reels | Poradnik 3 kroki", 54900, 2.7, 30, 12],
  ].map((c, i) => {
    const spend = c[1] as number;
    const ctr = c[2] as number;
    const cpc = c[3] as number;
    const clicks = Math.round(spend / cpc);
    const impressions = Math.round((clicks / ctr) * 100);
    return {
      adId: `demo-ad${i + 1}`,
      name: `DEMO | ${c[0]}`,
      thumbnailUrl: `https://picsum.photos/seed/${c[4]}/600/600`,
      spend,
      impressions,
      clicks,
      ctr,
      cpc,
    };
  });

  // --- Cost trend (Meta vs Google CPC over the range) ------------------------
  const costTrend: CostTrendPoint[] = trend.map((p, i) => ({
    date: p.date,
    metaCpcMinorUnits: Math.round(62 + Math.sin(i / 4) * 8 + rand() * 6),
    googleCpcMinorUnits: Math.round(138 + Math.cos(i / 5) * 14 + rand() * 10),
  }));

  // --- Platform split (share of spend) --------------------------------------
  const metaSpend = campaigns
    .filter((c) => c.provider === "meta_ads")
    .reduce((a, c) => a + c.spendMinorUnits, 0);
  const googleSpend = campaigns
    .filter((c) => c.provider === "google_ads")
    .reduce((a, c) => a + c.spendMinorUnits, 0);
  const platformSplit: PlatformSplit = {
    metaSpendMinorUnits: metaSpend,
    googleSpendMinorUnits: googleSpend,
    tiktokSpendMinorUnits: 0,
  };

  // --- Website (GA4) --------------------------------------------------------
  const S = curSessions;
  const website: WebsiteData = {
    hasData: true,
    sources: [
      { category: "Paid", sessions: Math.round(S * 0.4) },
      { category: "Organic", sessions: Math.round(S * 0.3) },
      { category: "Direct", sessions: Math.round(S * 0.14) },
      { category: "Social", sessions: Math.round(S * 0.1) },
      { category: "Referral/Inne", sessions: Math.round(S * 0.06) },
    ],
    devices: [
      { device: "mobile", sessions: Math.round(S * 0.66) },
      { device: "desktop", sessions: Math.round(S * 0.29) },
      { device: "tablet", sessions: Math.round(S * 0.05) },
    ],
    topPages: [
      { path: "/", views: Math.round(S * 0.9), engagementRate: 61 },
      { path: "/produkty", views: Math.round(S * 0.62), engagementRate: 68 },
      { path: "/kontakt", views: Math.round(S * 0.28), engagementRate: 72 },
      { path: "/o-nas", views: Math.round(S * 0.21), engagementRate: 55 },
      { path: "/blog/poradnik", views: Math.round(S * 0.18), engagementRate: 74 },
    ],
    engagement: {
      engagementRate: 62,
      bounceRate: 38,
      avgDailySessions: Math.round(S / DAYS),
    },
    newVsReturning: {
      newUsers: Math.round(S * 0.62),
      returningUsers: Math.round(S * 0.38),
    },
    sessionsTrend: trend.map((p) => ({ date: p.date, sessions: p.sessions })),
  };

  // --- News feed ------------------------------------------------------------
  const news: DemoNewsItem[] = [
    { category: "meta", publishedOn: format(subDays(today, 1), "yyyy-MM-dd"), title: "Meta rozszerza Advantage+ o nowe formaty wideo", summary: "Nowe automatyczne umiejscowienia wideo w Advantage+ mają poprawić zasięg przy niższym CPM. Warto przetestować na kampaniach świadomościowych.", sourceName: "Meta for Business", sourceUrl: "https://www.facebook.com/business/news" },
    { category: "google", publishedOn: format(subDays(today, 1), "yyyy-MM-dd"), title: "Google Ads: nowe raporty PMax na poziomie kanału", summary: "Performance Max dostaje bardziej szczegółowe raporty pokazujące udział YouTube, Search i Display. Ułatwia to optymalizację budżetu.", sourceName: "Google Ads Blog", sourceUrl: "https://blog.google/products/ads-commerce/" },
    { category: "tiktok", publishedOn: format(subDays(today, 2), "yyyy-MM-dd"), title: "TikTok testuje dłuższe reklamy in-feed", summary: "Nowy format do 60 s ma sprzyjać storytellingowi marek. Wcześni testerzy raportują wyższy czas oglądania.", sourceName: "TikTok Newsroom", sourceUrl: "https://newsroom.tiktok.com" },
    { category: "ai", publishedOn: format(subDays(today, 2), "yyyy-MM-dd"), title: "Nowe modele AI do generowania kreacji reklamowych", summary: "Kolejna generacja modeli obniża koszt produkcji wariantów kreacji. Dla agencji to szybsze testy A/B.", sourceName: "The Verge", sourceUrl: "https://www.theverge.com/ai-artificial-intelligence" },
    { category: "google", publishedOn: format(subDays(today, 3), "yyyy-MM-dd"), title: "AI Overviews wpływa na ruch organiczny", summary: "Coraz więcej zapytań kończy się bez kliknięcia. Marki przenoszą część budżetu na płatny Search i treści eksperckie.", sourceName: "Search Engine Land", sourceUrl: "https://searchengineland.com" },
    { category: "meta", publishedOn: format(subDays(today, 4), "yyyy-MM-dd"), title: "Instagram zmienia zasięgi Reels", summary: "Algorytm mocniej promuje oryginalne treści. Reposty tracą na zasięgu - warto stawiać na własne produkcje.", sourceName: "Instagram", sourceUrl: "https://about.instagram.com" },
  ];

  // --- Alerts (full list for the Alerty tab) --------------------------------
  const alertsFull: Anomaly[] = [
    ...alerts,
    {
      id: "a4",
      severity: "high",
      scope: "campaign",
      scopeLabel: "SEARCH | Generyczne · Google",
      metric: "cpc",
      direction: "up",
      changePct: 24,
      title: "CPC wyższe o 24% (7 dni)",
      description: "Rosnąca konkurencja w aukcji podbija koszt kliknięcia.",
    },
    {
      id: "a5",
      severity: "medium",
      scope: "campaign",
      scopeLabel: "ENGAGEMENT | Instagram · Meta",
      metric: "ctr",
      direction: "up",
      changePct: 18,
      title: "CTR rośnie na Instagramie: +18%",
      description: "Nowe kreacje Reels pracują wyraźnie lepiej niż średnia.",
    },
    {
      id: "a6",
      severity: "medium",
      scope: "client",
      scopeLabel: "Cały profil",
      metric: "sessions",
      direction: "up",
      changePct: 9,
      title: "Sesje z ruchu płatnego +9%",
      description: "Wzrost ruchu z kampanii przekłada się na sesje w GA4.",
    },
  ];

  return {
    kpis,
    trend,
    campaigns,
    score,
    creatives,
    creativesFull,
    alerts,
    alertsFull,
    budget,
    summary,
    costTrend,
    platformSplit,
    website,
    news,
    rangeLabel: "ostatnie 30 dni",
  };
}
