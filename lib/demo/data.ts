import { format, subDays } from "date-fns";

import type { Anomaly } from "@/lib/alerts/anomalies";
import type {
  CampaignRow,
  DashboardKpis,
  Kpi,
  TrendPoint,
} from "@/lib/dashboard/metrics";
import type { AiSummary, BudgetStatus } from "@/lib/dashboard/overview";
import type { DailyScore } from "@/lib/dashboard/score";
import type { CreativeRow } from "@/components/dashboard/top-creatives";
import type { AdProvider } from "@/lib/types";

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
  alerts: Anomaly[];
  budget: BudgetStatus;
  summary: AiSummary;
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

  return {
    kpis,
    trend,
    campaigns,
    score,
    creatives,
    alerts,
    budget,
    summary,
    rangeLabel: "ostatnie 30 dni",
  };
}
