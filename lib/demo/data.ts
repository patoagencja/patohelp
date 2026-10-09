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
import { formatPlnWhole } from "@/lib/utils";

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
    // Derived from the previous spend and clicks above, so the tile agrees
    // with the chart's dashed previous-period line (buildDemoChartExtras).
    cpcMinorUnits: mkKpi(cpcVal, Math.round((curSpend * 0.9) / (curClicks * 0.86))),
    conversions: mkKpi(curConv, Math.round(curConv * 0.88)),
  };

  // --- Campaigns (Meta + Google) --------------------------------------------
  // lokalnepomidorki's own campaigns: the Meta ones are the ones whose ads
  // "Testy kreacji" (lib/demo/ab.ts) compares, with about the same split of
  // the budget; Google covers search, the shop feed and a farm video.
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
    { id: "d-m1", provider: "meta_ads", namePl: "SPRZEDAŻ | Skrzynki warzyw", nameEn: "SALES | Veg boxes", weight: 0.24, ctr: 1.9, status: "active", reasonPl: null, reasonEn: null },
    { id: "d-m2", provider: "meta_ads", namePl: "SPRZEDAŻ | Pomidory i przetwory", nameEn: "SALES | Tomatoes & preserves", weight: 0.19, ctr: 1.7, status: "active", reasonPl: null, reasonEn: null },
    { id: "d-m3", provider: "meta_ads", namePl: "SPRZEDAŻ | Dostawa jutro", nameEn: "SALES | Next-day delivery", weight: 0.07, ctr: 1.8, status: "active", reasonPl: null, reasonEn: null },
    { id: "d-m4", provider: "meta_ads", namePl: "REMARKETING | Sklep", nameEn: "REMARKETING | Shop", weight: 0.08, ctr: 2.4, status: "attention", reasonPl: "Rosnący koszt kliknięcia", reasonEn: "Rising cost per click" },
    { id: "d-g1", provider: "google_ads", namePl: "SEARCH | Marka lokalnepomidorki", nameEn: "SEARCH | Brand lokalnepomidorki", weight: 0.07, ctr: 8.5, status: "active", reasonPl: null, reasonEn: null },
    { id: "d-g2", provider: "google_ads", namePl: "SEARCH | Warzywa z dostawą", nameEn: "SEARCH | Veg delivery", weight: 0.15, ctr: 4.5, status: "active", reasonPl: null, reasonEn: null },
    { id: "d-g3", provider: "google_ads", namePl: "PMAX | Sklep z warzywami", nameEn: "PMAX | Veg shop", weight: 0.13, ctr: 1.8, status: "attention", reasonPl: "Wydatki powyżej normy", reasonEn: "Spend above normal" },
    { id: "d-g4", provider: "google_ads", namePl: "YT | Wideo z gospodarstwa", nameEn: "YT | Farm video", weight: 0.07, ctr: 1.1, status: "active", reasonPl: null, reasonEn: null },
  ];

  // Google clicks cost about twice Meta's (search intent), like real
  // accounts; raw shares are normalised so all campaigns still add up to the
  // KPI total. The cost trend below is built around the same averages.
  const PLATFORM_CPC = { meta_ads: 0.72, google_ads: 1.55, tiktok_ads: 1 } as const;
  const rawShares = campaignDefs.map(
    (c) => (c.weight * (0.9 + rand() * 0.2)) / (PLATFORM_CPC[c.provider] ?? 1)
  );
  const rawTotal = rawShares.reduce((a, v) => a + v, 0) || 1;
  const campaigns: CampaignRow[] = campaignDefs.map((c, idx) => {
    const spend = Math.round(curSpend * c.weight);
    const clicks = Math.round((curClicks * rawShares[idx]) / rawTotal);
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
      : "Kliknięcia: w tym tygodniu o 16% powyżej normy 🔥",
    factors: [
      { key: "ctr", label: "CTR", deltaPct: 8 },
      { key: "clicks", label: en ? "Clicks" : "Kliknięcia", deltaPct: 16 },
      { key: "sessions", label: en ? "Sessions" : "Wizyty na stronie", deltaPct: 12 },
      { key: "reach", label: en ? "Reach" : "Zasięg", deltaPct: 5 },
    ],
    rings: [
      { key: "form", label: en ? "Form" : "Forma", value: 86, tier: "high" },
      { key: "engagement", label: en ? "Engagement" : "Zaangażowanie", value: 81, tier: "high" },
      { key: "traffic", label: en ? "Traffic" : "Ruch", value: 89, tier: "high" },
    ],
  };

  // --- Creatives -------------------------------------------------------------
  // The shop's Meta ads, named as in "Testy kreacji" (lib/demo/ab.ts) and
  // pulling the same way there: the free-delivery image and the tomato
  // close-up lag here on clicks and there on purchases; the unboxing video
  // holds attention best here and sells best there.
  const creativeDefs: Array<[string, string, number, number, number, number]> = [
    ["Skrzynka tygodnia - wideo 15 s", "Weekly box - 15s video", 184050, 2.6, 34, 11],
    ["Co jest w skrzynce? - karuzela", "What's in the box? - carousel", 152300, 2.5, 36, 22],
    ["Lokalne pomidory - grafika marki", "Local tomatoes - brand image", 141200, 0.9, 49, 33],
    ["Opinie klientów - grafika", "Customer reviews - image", 118900, 3.2, 39, 44],
    ["Rozpakowanie skrzynki - film klientki", "Box unboxing - customer video", 104500, 2.3, 32, 55],
    ["Darmowa dostawa od 150 zł - grafika", "Free delivery over 150 zł - image", 96700, 1.3, 46, 66],
    ["Pomidory malinowe z bliska - wideo 10 s", "Raspberry tomatoes close-up - 10s video", 81200, 1.2, 44, 77],
    ["Prosto z krzaka - grafika", "Straight from the vine - image", 72400, 2.4, 34, 88],
    ["Kapusta do kiszenia - karuzela", "Pickling cabbage - carousel", 61300, 2.0, 41, 99],
    ["Passata jak u babci - wideo 20 s", "Grandma's passata - 20s video", 54900, 2.7, 30, 12],
  ];
  const creativesFull: CreativeItem[] = creativeDefs.map((c, i) => {
    const spend = c[2];
    const ctr = c[3];
    const cpc = c[4];
    const clicks = Math.round(spend / cpc);
    const impressions = Math.round((clicks / ctr) * 100);
    return {
      adId: `demo-ad${i + 1}`,
      name: en ? c[1] : c[0],
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
  const avgCpc = (provider: AdProvider) => {
    const rows = campaigns.filter((c) => c.provider === provider);
    const sp = rows.reduce((a, c) => a + c.spendMinorUnits, 0);
    const cl = rows.reduce((a, c) => a + c.clicks, 0);
    return cl > 0 ? sp / cl : 0;
  };
  const metaAvgCpc = avgCpc("meta_ads");
  const googleAvgCpc = avgCpc("google_ads");
  const costTrend: CostTrendPoint[] = trend.map((p, i) => ({
    date: p.date,
    metaCpcMinorUnits: Math.round(metaAvgCpc * (1 + Math.sin(i / 4) * 0.1 + (rand() - 0.5) * 0.08)),
    googleCpcMinorUnits: Math.round(googleAvgCpc * (1 + Math.cos(i / 5) * 0.08 + (rand() - 0.5) * 0.06)),
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
      { path: "/skrzynki-warzyw", views: Math.round(S * 0.62), engagementRate: 68 },
      { path: "/pomidory", views: Math.round(S * 0.28), engagementRate: 72 },
      { path: "/dostawa", views: Math.round(S * 0.21), engagementRate: 55 },
      { path: "/przepisy/passata-domowa", views: Math.round(S * 0.18), engagementRate: 74 },
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
  // One list for every place that counts alerts (overview status + alert
  // line, the bell, Alerty): two lists drifted to "Pilne: 2" next to a bell
  // showing 3. The amounts come from the campaign rows above, so an alert
  // can't name a spend its own campaign never had.
  const campaignOf = (id: string) => campaigns.find((c) => c.campaignId === id);
  const zl = (minor: number) =>
    en ? `${Math.round(minor / 100).toLocaleString("en-GB")} zł` : formatPlnWhole(minor);
  // PMAX started 22 days ago (the chart's "Start kampanii" marker), so its
  // window spend covers 23 days; today runs at +128% of that average.
  const pmaxSpend = campaignOf("d-g3")?.spendMinorUnits ?? 0;
  const pmaxToday = Math.round((pmaxSpend / 23) * 2.28);
  // This week +42% over the two before: 7 × 1.42x + 23x = the 30-day spend.
  const remarketingSpend = campaignOf("d-m4")?.spendMinorUnits ?? 0;
  const remarketingWeek = Math.round((remarketingSpend * 7 * 1.42) / (7 * 1.42 + 23));
  const alerts: Anomaly[] = [
    { id: "a1", severity: "critical", scope: "campaign", scopeLabel: en ? "PMAX | Veg shop · Google" : "PMAX | Sklep z warzywami · Google", metric: "spend", direction: "up", changePct: 128, title: en ? `Spend spike today: ${zl(pmaxToday)}` : `Skok wydatków dziś: ${zl(pmaxToday)}`, description: en ? "Campaign spend well above the daily average." : "Wydatki kampanii znacząco powyżej średniej dziennej." },
    { id: "a2", severity: "high", scope: "campaign", scopeLabel: en ? "REMARKETING | Shop · Meta" : "REMARKETING | Sklep · Meta", metric: "spend", direction: "up", changePct: 42, title: en ? `Elevated spend (7 days): ${zl(remarketingWeek)}` : `Podwyższone wydatki (7 dni): ${zl(remarketingWeek)}`, description: en ? "This week above the previous two weeks." : "Tydzień powyżej poprzednich dwóch tygodni." },
    { id: "a3", severity: "medium", scope: "client", scopeLabel: en ? "Whole profile" : "Cały profil", metric: "ctr", direction: "up", changePct: 11, title: en ? "CTR rising: +11% vs normal" : "Klikalność rośnie: +11% względem normy", description: en ? "Engagement higher than usual this week." : "Zaangażowanie w tym tygodniu wyższe niż zwykle." },
    { id: "a4", severity: "high", scope: "campaign", scopeLabel: en ? "SEARCH | Veg delivery · Google" : "SEARCH | Warzywa z dostawą · Google", metric: "cpc", direction: "up", changePct: 24, title: en ? "CPC up 24% (7 days)" : "CPC wyższe o 24% (7 dni)", description: en ? "More grocery shops bid on the same searches, which pushes the cost per click up." : "Więcej sklepów spożywczych licytuje te same wyszukiwania, co podbija koszt kliknięcia." },
    { id: "a5", severity: "medium", scope: "campaign", scopeLabel: en ? "SALES | Veg boxes · Meta" : "SPRZEDAŻ | Skrzynki warzyw · Meta", metric: "ctr", direction: "up", changePct: 18, title: en ? "CTR rising: +18%" : "Klikalność rośnie: +18%", description: en ? "The new customer unboxing video clearly beats the average." : "Nowy film klientki rozpakowującej skrzynkę działa wyraźnie lepiej niż średnia." },
    { id: "a6", severity: "medium", scope: "client", scopeLabel: en ? "Whole profile" : "Cały profil", metric: "sessions", direction: "up", changePct: 9, title: en ? "Paid sessions +9%" : "Więcej wizyt z reklam: +9%", description: en ? "Campaign traffic growth feeds GA4 sessions." : "Wzrost ruchu z kampanii przekłada się na więcej wizyt na stronie." },
  ];

  // --- Budget ---------------------------------------------------------------
  const dayOfMonth = today.getDate();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const budgetMinor = 5000000;
  // Month-to-date spend from the same trend the KPI cards and chart use (the
  // real card sums ads_daily the same way); an invented figure didn't match
  // the chart's own daily spend for this month. Pace stays "ok": the demo
  // trend runs ~48k zł/month against this 50k zł budget.
  const monthStart = format(today, "yyyy-MM-01");
  const spentMinor = trend
    .filter((p) => p.date >= monthStart)
    .reduce((a, p) => a + p.spendMinorUnits, 0);
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
      ? "Campaign traffic is growing this week - clicks are up 16% versus the previous period and CTR stays above average. The best performers are the customer video unboxing a veg box and the ads reminding shop visitors of their basket. GA4 sessions grow mainly from paid and organic Google traffic. Recommendation: shift some budget to the top videos and keep remarketing running."
      : "W tym tygodniu ruch z kampanii rośnie - liczba kliknięć wzrosła o 16% względem poprzedniego okresu, a klikalność reklam utrzymuje się powyżej średniej. Najlepiej działa film klientki rozpakowującej skrzynkę warzyw oraz reklamy przypominające o koszyku osobom, które już były w sklepie. Wizyt na stronie przybywa głównie z reklam i z bezpłatnych wyników Google. Warto omówić przesunięcie części budżetu na najlepsze filmy.",
    generatedAt: today.toISOString(),
    // Same window as the real cron: the last 7 complete days.
    periodStart: format(subDays(today, 7), "yyyy-MM-dd"),
    periodEnd: format(subDays(today, 1), "yyyy-MM-dd"),
  };

  return {
    kpis,
    trend,
    campaigns,
    score,
    creatives,
    creativesFull,
    alerts,
    budget,
    summary,
    costTrend,
    platformSplit,
    website,
    news,
    rangeLabel: en ? "last 30 days" : "ostatnie 30 dni",
  };
}
