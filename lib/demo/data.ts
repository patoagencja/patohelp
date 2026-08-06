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

export type DemoLang = "pl" | "en";

export interface DemoNewsItem {
  category: "meta" | "google" | "tiktok" | "ai";
  publishedOn: string;
  title: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
}

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

export function getDemoDashboard(
  lang: DemoLang = "pl",
  today = new Date()
): DemoDashboard {
  const en = lang === "en";
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
      revenueMinorUnits: 0,
      transactions: 0,
    });
  }

  const sum = (f: (p: TrendPoint) => number) => trend.reduce((a, p) => a + f(p), 0);

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

  const kpis: DashboardKpis = {
    spendMinorUnits: mkKpi(curSpend, Math.round(curSpend * 0.9)),
    clicks: mkKpi(curClicks, Math.round(curClicks * 0.86)),
    sessions: mkKpi(curSessions, Math.round(curSessions * 0.83)),
    ctr: mkKpi(Number(ctrVal.toFixed(2)), Number((ctrVal * 0.94).toFixed(2))),
    cpcMinorUnits: mkKpi(cpcVal, Math.round(cpcVal * 1.07)),
    conversions: mkKpi(curConv, Math.round(curConv * 0.88)),
  };

  // --- Campaigns (Meta + Google) --------------------------------------------
  const campaignDefs: Array<{
    id: string;
    provider: AdProvider;
    namePl: string;
    nameEn: string;
    weight: number;
    ctr: number;
    status: CampaignRow["status"];
    reasonPl: string | null;
    reasonEn: string | null;
  }> = [
    { id: "d-m1", provider: "meta_ads", namePl: "BRAND | Świadomość | Reach", nameEn: "BRAND | Awareness | Reach", weight: 0.2, ctr: 0.9, status: "active", reasonPl: null, reasonEn: null },
    { id: "d-m2", provider: "meta_ads", namePl: "TRAFFIC | Ruch na stronę", nameEn: "TRAFFIC | Website visits", weight: 0.17, ctr: 2.1, status: "active", reasonPl: null, reasonEn: null },
    { id: "d-m3", provider: "meta_ads", namePl: "ENGAGEMENT | Instagram", nameEn: "ENGAGEMENT | Instagram", weight: 0.11, ctr: 2.8, status: "active", reasonPl: null, reasonEn: null },
    { id: "d-m4", provider: "meta_ads", namePl: "RETARGETING | Odwiedzający", nameEn: "RETARGETING | Visitors", weight: 0.08, ctr: 2.4, status: "attention", reasonPl: "Rosnący koszt kliknięcia", reasonEn: "Rising cost per click" },
    { id: "d-g1", provider: "google_ads", namePl: "SEARCH | Marka", nameEn: "SEARCH | Brand", weight: 0.08, ctr: 8.5, status: "active", reasonPl: null, reasonEn: null },
    { id: "d-g2", provider: "google_ads", namePl: "SEARCH | Generyczne", nameEn: "SEARCH | Generic", weight: 0.16, ctr: 4.5, status: "active", reasonPl: null, reasonEn: null },
    { id: "d-g3", provider: "google_ads", namePl: "PMAX | Ruch", nameEn: "PMAX | Traffic", weight: 0.13, ctr: 1.8, status: "attention", reasonPl: "Wydatki powyżej normy", reasonEn: "Spend above normal" },
    { id: "d-g4", provider: "google_ads", namePl: "YT | Wideo", nameEn: "YT | Video", weight: 0.07, ctr: 1.1, status: "active", reasonPl: null, reasonEn: null },
  ];

  const campaigns: CampaignRow[] = campaignDefs.map((c, idx) => {
    const spend = Math.round(curSpend * c.weight);
    const clicks = Math.round(curClicks * c.weight * (0.9 + rand() * 0.2));
    const impressions = Math.round((clicks / c.ctr) * 100);
    const cpc = clicks > 0 ? Math.round(spend / clicks) : null;
    const spark = Array.from({ length: 7 }, (_, i) =>
      Math.round((spend / 7) * (0.8 + (i / 6) * 0.5) * (0.9 + rand() * 0.2))
    );
    return {
      campaignId: c.id,
      provider: c.provider,
      name: en ? c.nameEn : c.namePl,
      spendMinorUnits: spend,
      clicks,
      impressions,
      ctr: c.ctr,
      cpcMinorUnits: cpc,
      conversions: Math.round(curConv * c.weight),
      status: c.status,
      statusReason: en ? c.reasonEn : c.reasonPl,
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
    headline: en
      ? "Clicks up 16% this week 🔥"
      : "Kliknięcia w tym tygodniu wyżej o 16% 🔥",
    factors: [
      { key: "ctr", label: "CTR", deltaPct: 8 },
      { key: "clicks", label: en ? "Clicks" : "Kliknięcia", deltaPct: 16 },
      { key: "sessions", label: en ? "Sessions" : "Sesje", deltaPct: 12 },
      { key: "reach", label: en ? "Reach" : "Zasięg", deltaPct: 5 },
    ],
    rings: [
      { key: "form", label: en ? "Form" : "Forma", value: 86, tier: "high" },
      { key: "engagement", label: en ? "Engagement" : "Zaangażowanie", value: 81, tier: "high" },
      { key: "traffic", label: en ? "Traffic" : "Ruch", value: 89, tier: "high" },
    ],
  };

  // --- Creatives -------------------------------------------------------------
  const creativeDefs: Array<[string, string, number, number, number, number]> = [
    ["Wideo | Poradnik montażu 30s", "Video | Install guide 30s", 184050, 2.6, 34, 11],
    ["Karuzela | Nowa kolekcja", "Carousel | New collection", 152300, 2.5, 36, 22],
    ["Grafika | Świadomość marki", "Image | Brand awareness", 141200, 0.9, 49, 33],
    ["Retargeting | Porzucony koszyk", "Retargeting | Abandoned cart", 118900, 3.2, 39, 44],
    ["Reels | Opinie klientów", "Reels | Customer reviews", 104500, 2.3, 32, 55],
    ["Statyk | Promocja -20%", "Static | Promo -20%", 96700, 2.2, 37, 66],
    ["Wideo | Behind the scenes", "Video | Behind the scenes", 81200, 1.2, 44, 77],
    ["Grafika | Bestsellery", "Image | Bestsellers", 72400, 2.4, 34, 88],
    ["Karuzela | Zestawy", "Carousel | Bundles", 61300, 2.0, 41, 99],
    ["Reels | Poradnik 3 kroki", "Reels | 3-step guide", 54900, 2.7, 30, 12],
  ];
  const creativesFull: CreativeItem[] = creativeDefs.map((c, i) => {
    const spend = c[2];
    const ctr = c[3];
    const cpc = c[4];
    const clicks = Math.round(spend / cpc);
    const impressions = Math.round((clicks / ctr) * 100);
    return {
      adId: `demo-ad${i + 1}`,
      name: `DEMO | ${en ? c[1] : c[0]}`,
      thumbnailUrl: `https://picsum.photos/seed/${c[5]}/600/600`,
      spend,
      impressions,
      clicks,
      ctr,
      cpc,
    };
  });
  const creatives: CreativeRow[] = creativesFull.slice(0, 5).map((c) => ({
    adId: c.adId,
    adName: c.name,
    thumbnailUrl: c.thumbnailUrl,
    spendMinorUnits: c.spend,
    ctr: c.ctr,
    cpcMinorUnits: c.cpc,
  }));

  // --- Cost trend ------------------------------------------------------------
  const costTrend: CostTrendPoint[] = trend.map((p, i) => ({
    date: p.date,
    metaCpcMinorUnits: Math.round(62 + Math.sin(i / 4) * 8 + rand() * 6),
    googleCpcMinorUnits: Math.round(138 + Math.cos(i / 5) * 14 + rand() * 10),
  }));

  // --- Platform split --------------------------------------------------------
  const metaSpend = campaigns.filter((c) => c.provider === "meta_ads").reduce((a, c) => a + c.spendMinorUnits, 0);
  const googleSpend = campaigns.filter((c) => c.provider === "google_ads").reduce((a, c) => a + c.spendMinorUnits, 0);
  const platformSplit: PlatformSplit = {
    metaSpendMinorUnits: metaSpend,
    googleSpendMinorUnits: googleSpend,
    tiktokSpendMinorUnits: 0,
  };

  // --- Website (GA4) --------------------------------------------------------
  const S = curSessions;
  const website: WebsiteData = {
    hasData: true,
    // Demo is an engagement client: sessions only, no revenue per channel.
    sources: [
      { category: "Paid", sessions: Math.round(S * 0.4), revenueMinorUnits: 0, transactions: 0 },
      { category: "Organic", sessions: Math.round(S * 0.3), revenueMinorUnits: 0, transactions: 0 },
      { category: "Direct", sessions: Math.round(S * 0.14), revenueMinorUnits: 0, transactions: 0 },
      { category: "Social", sessions: Math.round(S * 0.1), revenueMinorUnits: 0, transactions: 0 },
      { category: "Referral/Inne", sessions: Math.round(S * 0.06), revenueMinorUnits: 0, transactions: 0 },
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
    engagement: { engagementRate: 62, bounceRate: 38, avgDailySessions: Math.round(S / DAYS) },
    newVsReturning: { newUsers: Math.round(S * 0.62), returningUsers: Math.round(S * 0.38) },
    sessionsTrend: trend.map((p) => ({ date: p.date, sessions: p.sessions })),
  };

  // --- News ------------------------------------------------------------------
  const newsPl: DemoNewsItem[] = [
    { category: "meta", publishedOn: format(subDays(today, 1), "yyyy-MM-dd"), title: "Meta rozszerza Advantage+ o nowe formaty wideo", summary: "Nowe automatyczne umiejscowienia wideo w Advantage+ mają poprawić zasięg przy niższym CPM. Warto przetestować na kampaniach świadomościowych.", sourceName: "Meta for Business", sourceUrl: "https://www.facebook.com/business/news" },
    { category: "google", publishedOn: format(subDays(today, 1), "yyyy-MM-dd"), title: "Google Ads: nowe raporty PMax na poziomie kanału", summary: "Performance Max dostaje bardziej szczegółowe raporty pokazujące udział YouTube, Search i Display. Ułatwia to optymalizację budżetu.", sourceName: "Google Ads Blog", sourceUrl: "https://blog.google/products/ads-commerce/" },
    { category: "tiktok", publishedOn: format(subDays(today, 2), "yyyy-MM-dd"), title: "TikTok testuje dłuższe reklamy in-feed", summary: "Nowy format do 60 s ma sprzyjać storytellingowi marek. Wcześni testerzy raportują wyższy czas oglądania.", sourceName: "TikTok Newsroom", sourceUrl: "https://newsroom.tiktok.com" },
    { category: "ai", publishedOn: format(subDays(today, 2), "yyyy-MM-dd"), title: "Nowe modele AI do generowania kreacji reklamowych", summary: "Kolejna generacja modeli obniża koszt produkcji wariantów kreacji. Dla agencji to szybsze testy A/B.", sourceName: "The Verge", sourceUrl: "https://www.theverge.com/ai-artificial-intelligence" },
    { category: "google", publishedOn: format(subDays(today, 3), "yyyy-MM-dd"), title: "AI Overviews wpływa na ruch organiczny", summary: "Coraz więcej zapytań kończy się bez kliknięcia. Marki przenoszą część budżetu na płatny Search i treści eksperckie.", sourceName: "Search Engine Land", sourceUrl: "https://searchengineland.com" },
    { category: "meta", publishedOn: format(subDays(today, 4), "yyyy-MM-dd"), title: "Instagram zmienia zasięgi Reels", summary: "Algorytm mocniej promuje oryginalne treści. Reposty tracą na zasięgu - warto stawiać na własne produkcje.", sourceName: "Instagram", sourceUrl: "https://about.instagram.com" },
  ];
  const newsEn: DemoNewsItem[] = [
    { category: "meta", publishedOn: newsPl[0].publishedOn, title: "Meta expands Advantage+ with new video formats", summary: "New automatic video placements in Advantage+ aim to boost reach at a lower CPM. Worth testing on awareness campaigns.", sourceName: "Meta for Business", sourceUrl: "https://www.facebook.com/business/news" },
    { category: "google", publishedOn: newsPl[1].publishedOn, title: "Google Ads: new channel-level PMax reporting", summary: "Performance Max gets more detailed reports showing the YouTube, Search and Display split - easier budget optimization.", sourceName: "Google Ads Blog", sourceUrl: "https://blog.google/products/ads-commerce/" },
    { category: "tiktok", publishedOn: newsPl[2].publishedOn, title: "TikTok tests longer in-feed ads", summary: "A new format up to 60s favors brand storytelling. Early testers report higher watch time.", sourceName: "TikTok Newsroom", sourceUrl: "https://newsroom.tiktok.com" },
    { category: "ai", publishedOn: newsPl[3].publishedOn, title: "New AI models for generating ad creative", summary: "The next generation of models lowers the cost of producing creative variants - faster A/B testing for agencies.", sourceName: "The Verge", sourceUrl: "https://www.theverge.com/ai-artificial-intelligence" },
    { category: "google", publishedOn: newsPl[4].publishedOn, title: "AI Overviews reshape organic traffic", summary: "More queries end without a click. Brands are shifting budget to paid Search and expert content.", sourceName: "Search Engine Land", sourceUrl: "https://searchengineland.com" },
    { category: "meta", publishedOn: newsPl[5].publishedOn, title: "Instagram changes Reels reach", summary: "The algorithm favors original content more; reposts lose reach - lean into your own productions.", sourceName: "Instagram", sourceUrl: "https://about.instagram.com" },
  ];
  const news = en ? newsEn : newsPl;

  // --- Alerts ----------------------------------------------------------------
  const alerts: Anomaly[] = [
    { id: "a1", severity: "critical", scope: "campaign", scopeLabel: en ? "PMAX | Traffic · Google" : "PMAX | Ruch · Google", metric: "spend", direction: "up", changePct: 128, title: en ? "Spend spike today: 1,809 zł" : "Skok wydatków dziś: 1 809 zł", description: en ? "Campaign spend well above the daily average." : "Wydatki kampanii znacząco powyżej średniej dziennej." },
    { id: "a2", severity: "high", scope: "campaign", scopeLabel: en ? "RETARGETING | Visitors · Meta" : "RETARGETING | Odwiedzający · Meta", metric: "spend", direction: "up", changePct: 42, title: en ? "Elevated spend (7 days): 5,396 zł" : "Podwyższone wydatki (7 dni): 5 396 zł", description: en ? "This week above the previous two weeks." : "Tydzień powyżej poprzednich dwóch tygodni." },
    { id: "a3", severity: "medium", scope: "client", scopeLabel: en ? "Whole profile" : "Cały profil", metric: "ctr", direction: "up", changePct: 11, title: en ? "CTR rising: +11% vs normal" : "CTR rośnie: +11% względem normy", description: en ? "Engagement higher than usual this week." : "Zaangażowanie w tym tygodniu wyższe niż zwykle." },
  ];
  const alertsFull: Anomaly[] = [
    ...alerts,
    { id: "a4", severity: "high", scope: "campaign", scopeLabel: en ? "SEARCH | Generic · Google" : "SEARCH | Generyczne · Google", metric: "cpc", direction: "up", changePct: 24, title: en ? "CPC up 24% (7 days)" : "CPC wyższe o 24% (7 dni)", description: en ? "Rising auction competition pushes cost per click up." : "Rosnąca konkurencja w aukcji podbija koszt kliknięcia." },
    { id: "a5", severity: "medium", scope: "campaign", scopeLabel: en ? "ENGAGEMENT | Instagram · Meta" : "ENGAGEMENT | Instagram · Meta", metric: "ctr", direction: "up", changePct: 18, title: en ? "CTR rising on Instagram: +18%" : "CTR rośnie na Instagramie: +18%", description: en ? "New Reels creatives clearly outperform the average." : "Nowe kreacje Reels pracują wyraźnie lepiej niż średnia." },
    { id: "a6", severity: "medium", scope: "client", scopeLabel: en ? "Whole profile" : "Cały profil", metric: "sessions", direction: "up", changePct: 9, title: en ? "Paid sessions +9%" : "Sesje z ruchu płatnego +9%", description: en ? "Campaign traffic growth feeds GA4 sessions." : "Wzrost ruchu z kampanii przekłada się na sesje w GA4." },
  ];

  // --- Budget ---------------------------------------------------------------
  const dayOfMonth = today.getDate();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const budgetMinor = 5000000;
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
    paceLabel: en ? "Spend on track with the budget" : "Wydatki w tempie zgodnym z budżetem",
    month: format(today, "yyyy-MM-01"),
  };

  // --- AI summary -----------------------------------------------------------
  const summary: AiSummary = {
    summaryText: en
      ? "Campaign traffic is growing this week - clicks are up 16% versus the previous period and CTR stays above average. The best performers are the video campaign „Install guide” and retargeting. GA4 sessions grow mainly from paid and organic Google traffic. Recommendation: shift some budget to the top video creatives and keep retargeting running."
      : "W tym tygodniu ruch z kampanii rośnie - liczba kliknięć wzrosła o 16% względem poprzedniego okresu, a CTR utrzymuje się powyżej średniej. Najlepiej pracuje kampania wideo „Poradnik montażu” oraz retargeting. Sesje w GA4 rosną głównie z ruchu płatnego i organicznego z Google. Rekomendacja: przenieść część budżetu na najlepsze kreacje wideo i utrzymać retargeting.",
    generatedAt: today.toISOString(),
    periodStart: format(subDays(today, 6), "yyyy-MM-dd"),
    periodEnd: format(today, "yyyy-MM-dd"),
  };

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
    rangeLabel: en ? "last 30 days" : "ostatnie 30 dni",
  };
}
