import { fromZonedTime } from "date-fns-tz";

import type { ProductRow } from "@/components/dashboard/ecom/top-products";
import type { EcomAnalysis } from "@/lib/ecom/analysis";
import {
  addDays,
  blackFriday,
  CHANNEL_LABEL,
  dayLabelPl,
  monthLabelPl,
  todayWarsaw,
  type ChannelEfficiency,
  type ChannelKey,
  type ChannelRow,
  type EcomSettings,
  type MonthPacing,
  type SeasonEvent,
  type SeasonPlan,
  type YearOverYear,
} from "@/lib/ecom/insights";
import type { EcommerceKpis, Kpi, TrendPoint } from "@/lib/dashboard/metrics";
import {
  RANGE_LABELS,
  type CustomRange,
  type RangeKey,
} from "@/lib/dashboard/ranges";

// Synthetic e-commerce client for the public /demo-full/sprzedaz showcase: a
// Polish fashion + home shop (~280k zł/month in October, ROAS ~5, 45% margin).
// Every day's numbers are a pure function of its date (hashed seed), so the
// demo is stable across reloads and the same date always shows the same sales,
// whatever "today" is. Shapes mirror lib/ecom/insights.ts so the real widgets
// render exactly as they would for a live client.

const DAY_MS = 86_400_000;
const YOY_SHIFT_DAYS = 364; // 52 weeks, weekday-aligned - same as insights.ts

// Growth is anchored to a fixed date (not "today") so a given day never
// changes value; the shop grows ~18% a year.
const GROWTH_ANCHOR = "2026-10-01";
const YEARLY_GROWTH = 1.18;

const BASE_DAILY_REVENUE = 9_030_00; // grosze, ≈ 280k zł / 31 days in October
const BASE_AOV = 147_00; // grosze
const BASE_CR = 0.016; // orders per session
const BASE_ROAS = 5;
const BASE_CPC = 1_15; // grosze
const BASE_CTR = 0.014;
/** Fraction of today already "synced" - today is always a partial day. */
const TODAY_PARTIAL = 0.42;

// Month index -> demand multiplier (fashion + home: soft summer, big Q4).
const SEASON = [0.82, 0.72, 0.86, 0.92, 0.95, 0.88, 0.8, 0.84, 0.93, 1.0, 1.38, 1.22];
// Sunday evening and Monday are strong in Polish e-commerce; Saturday is weak.
const WEEKDAY = [1.1, 1.08, 1.04, 1.0, 0.98, 0.9, 0.84]; // Sun..Sat

// ---- tiny date + random helpers -------------------------------------------

const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const diffDays = (from: string, to: string) =>
  Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY_MS);
const monthStartOf = (s: string) => `${s.slice(0, 7)}-01`;
const daysInMonth = (s: string) => {
  const d = toDate(monthStartOf(s));
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
};
const monthEndOf = (s: string) =>
  `${s.slice(0, 7)}-${String(daysInMonth(s)).padStart(2, "0")}`;
const shiftMonths = (monthStart: string, n: number) => {
  const d = toDate(monthStart);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))
    .toISOString()
    .slice(0, 10);
};

/** Deterministic PRNG seeded from a string (FNV-1a + LCG). */
function rng(key: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let s = h >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const jitter = (r: () => number, spread: number) => 1 - spread + r() * spread * 2;

// ---- the day model ---------------------------------------------------------

interface DemoDay {
  revenue: number; // grosze
  transactions: number;
  sessions: number;
  spend: number; // grosze
  metaSpend: number;
  googleSpend: number;
  clicks: number;
  impressions: number;
  conversions: number;
}

/** Smooth monthly seasonality: interpolate between mid-month anchors so the
 *  chart has no cliffs on the 1st of each month. */
function seasonOf(date: string): number {
  const d = toDate(date);
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const dim = daysInMonth(date);
  const mid = dim / 2;
  if (day >= mid) {
    const t = (day - mid) / dim;
    return SEASON[m] + (SEASON[(m + 1) % 12] - SEASON[m]) * t;
  }
  const t = (mid - day) / dim;
  return SEASON[m] + (SEASON[(m + 11) % 12] - SEASON[m]) * t;
}

/** Retail calendar spikes: Black Week, Mikołajki, the pre-Christmas cut-off,
 *  the dead days around Christmas and January sales. */
function eventOf(date: string): { demand: number; aov: number; cr: number } {
  const year = Number(date.slice(0, 4));
  const md = date.slice(5);
  const fromBf = diffDays(blackFriday(year), date);
  const bfCurve: Record<number, number> = { [-1]: 1.6, 0: 3.0, 1: 2.0, 2: 1.8, 3: 2.2 };
  if (fromBf in bfCurve) return { demand: bfCurve[fromBf], aov: 0.88, cr: 1.55 };
  if (fromBf >= -7 && fromBf <= -2) return { demand: 1.25, aov: 0.93, cr: 1.15 };
  if (fromBf >= 4 && fromBf <= 6) return { demand: 1.15, aov: 0.95, cr: 1.05 };
  if (md === "12-06") return { demand: 1.5, aov: 1.05, cr: 1.2 };
  if (md >= "12-07" && md <= "12-18") {
    // Gift buying builds up to the last-shipping day.
    const day = Number(md.slice(3));
    return { demand: 1.15 + (day - 7) * 0.03, aov: 1.1, cr: 1.15 };
  }
  if (md >= "12-01" && md <= "12-05") return { demand: 1.1, aov: 1.08, cr: 1.05 };
  if (md >= "12-19" && md <= "12-23") return { demand: 0.62, aov: 1.0, cr: 0.9 };
  if (md >= "12-24" && md <= "12-26") return { demand: 0.3, aov: 0.95, cr: 0.8 };
  if (md >= "12-27" && md <= "12-31") return { demand: 0.85, aov: 0.9, cr: 1.0 };
  if (md >= "01-02" && md <= "01-10") return { demand: 1.2, aov: 0.85, cr: 1.1 };
  return { demand: 1, aov: 1, cr: 1 };
}

const dayCache = new Map<string, DemoDay>();

function computeDay(date: string): DemoDay {
  const cached = dayCache.get(date);
  if (cached) return cached;
  const r = rng(`demo-ecom:${date}`);
  const growth = YEARLY_GROWTH ** (diffDays(GROWTH_ANCHOR, date) / 365);
  const season = seasonOf(date);
  const ev = eventOf(date);
  const weekday = WEEKDAY[toDate(date).getUTCDay()];

  const revenue = BASE_DAILY_REVENUE * growth * season * ev.demand * weekday * jitter(r, 0.12);
  const aov = BASE_AOV * ev.aov * jitter(r, 0.06);
  const transactions = Math.max(1, Math.round(revenue / aov));
  const cr = BASE_CR * ev.cr * jitter(r, 0.08);
  const sessions = Math.round(transactions / cr);

  // Spend follows demand, but flatter than revenue - that is why ROAS rises
  // in peak weeks and sags in the dead days after Christmas.
  const spend =
    (BASE_DAILY_REVENUE / BASE_ROAS) *
    growth *
    season ** 0.75 *
    ev.demand ** 0.6 *
    jitter(r, 0.08);
  const metaShare = 0.48 * jitter(r, 0.05);
  const cpc = BASE_CPC * season ** 0.3 * ev.demand ** 0.15 * jitter(r, 0.07);
  const clicks = Math.round(spend / cpc);

  const out: DemoDay = {
    revenue: Math.round(revenue),
    transactions,
    sessions,
    spend: Math.round(spend),
    metaSpend: Math.round(spend * metaShare),
    googleSpend: Math.round(spend) - Math.round(spend * metaShare),
    clicks,
    impressions: Math.round(clicks / (BASE_CTR * jitter(r, 0.1))),
    conversions: Math.round(transactions * 0.52),
  };
  dayCache.set(date, out);
  return out;
}

/** A day's data as the sync would have it: nothing in the future, and today
 *  only partially counted. */
function dayData(date: string, today: string): DemoDay | undefined {
  if (date > today) return undefined;
  const d = computeDay(date);
  if (date < today) return d;
  const part = (n: number) => Math.round(n * TODAY_PARTIAL);
  return {
    revenue: part(d.revenue),
    transactions: part(d.transactions),
    sessions: part(d.sessions),
    spend: part(d.spend),
    metaSpend: part(d.metaSpend),
    googleSpend: part(d.googleSpend),
    clicks: part(d.clicks),
    impressions: part(d.impressions),
    conversions: part(d.conversions),
  };
}

function sumRange(
  start: string,
  end: string,
  today: string,
  pick: (v: DemoDay) => number
): { total: number; daysWithData: number; days: number } {
  let total = 0;
  let daysWithData = 0;
  const days = Math.max(0, diffDays(start, end) + 1);
  for (let i = 0; i < days; i++) {
    const v = dayData(addDays(start, i), today);
    if (v) {
      total += pick(v);
      daysWithData += 1;
    }
  }
  return { total, daysWithData, days };
}

// ---- range resolution (mirrors lib/dashboard/metrics.ts) -------------------

interface ResolvedRange {
  start: string;
  end: string;
  prevStart: string;
  prevEnd: string;
  label: string;
}

function resolveRange(key: RangeKey, custom: CustomRange | null, today: string): ResolvedRange {
  // Public page: ignore absurd custom spans instead of looping over decades.
  if (custom && diffDays(custom.start, custom.end) <= 730) {
    const len = diffDays(custom.start, custom.end) + 1;
    const prevEnd = addDays(custom.start, -1);
    return {
      start: custom.start,
      end: custom.end,
      prevStart: addDays(prevEnd, -(len - 1)),
      prevEnd,
      label: `${custom.start} - ${custom.end}`,
    };
  }
  if (key === "month") {
    const start = monthStartOf(today);
    const prevStart = shiftMonths(start, -1);
    const dayOfMonth = Number(today.slice(8));
    const prevDays = Math.min(dayOfMonth, daysInMonth(prevStart));
    return {
      start,
      end: today,
      prevStart,
      prevEnd: addDays(prevStart, prevDays - 1),
      label: RANGE_LABELS[key],
    };
  }
  if (key === "prev_month") {
    const start = shiftMonths(monthStartOf(today), -1);
    const prevStart = shiftMonths(start, -1);
    return {
      start,
      end: monthEndOf(start),
      prevStart,
      prevEnd: monthEndOf(prevStart),
      label: RANGE_LABELS[key],
    };
  }
  const days = key === "7d" ? 7 : key === "90d" ? 90 : 30;
  const start = addDays(today, -(days - 1));
  const prevEnd = addDays(start, -1);
  return {
    start,
    end: today,
    prevStart: addDays(prevEnd, -(days - 1)),
    prevEnd,
    label: RANGE_LABELS[key],
  };
}

const kpi = (value: number, previous: number): Kpi => ({
  value,
  previous,
  deltaPercent: previous > 0 ? ((value - previous) / previous) * 100 : null,
});

// ---- static catalogue -------------------------------------------------------

const PRODUCTS: Array<{ id: string; name: string; price: number; share: number }> = [
  { id: "SW-MER-OVS-BEZ", name: "Sweter oversize z wełną merino – beżowy", price: 289_00, share: 0.068 },
  { id: "PL-WEL-DRZ-CAM", name: "Płaszcz wełniany dwurzędowy – camel", price: 699_00, share: 0.051 },
  { id: "KC-WAF-150-SZA", name: "Koc z bawełny waflowej 150×200 – szałwia", price: 219_00, share: 0.046 },
  { id: "PS-LEN-200-PIA", name: "Komplet pościeli lnianej 200×220 – piaskowy", price: 449_00, share: 0.039 },
  { id: "KR-ALP-ECR", name: "Kardigan z alpaką – ecru", price: 349_00, share: 0.034 },
  { id: "BT-SKO-SLU-CZA", name: "Botki skórzane na słupku – czarne", price: 399_00, share: 0.03 },
  { id: "SZ-KSZ-BUT", name: "Szal z kaszmirem – butelkowa zieleń", price: 199_00, share: 0.027 },
  { id: "SW-SOJ-JLAS-300", name: "Świeca sojowa Jesienny Las 300 g", price: 59_00, share: 0.024 },
  { id: "PD-BOU-45-KRE", name: "Poduszka dekoracyjna bouclé 45×45 – kremowa", price: 89_00, share: 0.021 },
  { id: "KB-CER-350", name: "Kubek ceramiczny ręcznie robiony 350 ml", price: 49_00, share: 0.018 },
];

// Share of GA4 last-click revenue and sessions per channel. Meta brings cheap
// browsing traffic that converts later (lower CR); e-mail converts best.
const CHANNELS: Array<{ key: ChannelKey; revenue: number; sessions: number }> = [
  { key: "google_ads", revenue: 0.35, sessions: 0.27 },
  { key: "meta", revenue: 0.29, sessions: 0.34 },
  { key: "organic_search", revenue: 0.16, sessions: 0.19 },
  { key: "direct", revenue: 0.11, sessions: 0.1 },
  { key: "email", revenue: 0.06, sessions: 0.04 },
  { key: "social_organic", revenue: 0.03, sessions: 0.06 },
];

const TOP_PAGES: Array<{ path: string; share: number; engagementRate: number }> = [
  { path: "/", share: 0.41, engagementRate: 57 },
  { path: "/kolekcja/jesien-2026", share: 0.22, engagementRate: 66 },
  { path: "/kategoria/swetry-i-kardigany", share: 0.15, engagementRate: 63 },
  { path: "/produkt/sweter-oversize-welna-merino-bezowy", share: 0.09, engagementRate: 71 },
  { path: "/kategoria/dom-i-dekoracje", share: 0.08, engagementRate: 61 },
];

function demoAnalysis(warmupLabel: string): EcomAnalysis {
  return {
    headline:
      "Sprzedaż rośnie szybciej niż rok temu, a reklamy zarabiają z zapasem - to dobry moment, żeby przygotować budżet na Black Week.",
    performance:
      "W ostatnich 30 dniach sklep sprzedawał średnio za ok. 9 tys. zł dziennie, czyli wyraźnie więcej niż w tym samym okresie rok temu. Na każdą złotówkę wydaną na reklamy wraca ok. 5 zł przychodu, a to prawie dwa razy więcej niż próg opłacalności przy Waszej marży. Najlepiej sprzedają się ciepłe swetry i płaszcze z nowej kolekcji jesiennej.",
    peaks: [
      { label: "Niedziele i poniedziałki", note: "regularnie o 10-15% wyższa sprzedaż niż w soboty" },
      { label: "Premiera kolekcji jesiennej", note: "najmocniejszy tydzień od początku września" },
      { label: "Black Friday rok temu", note: "jeden dzień przyniósł tyle, co zwykle 3 dni sprzedaży" },
    ],
    seasonality:
      "W modzie i dekoracjach wnętrz listopad i pierwsza połowa grudnia to zwykle 30-40% sprzedaży całego kwartału. Szczyt przypada na Black Friday i Cyber Monday, potem drugi na prezenty przed Mikołajkami i do ok. 18 grudnia, kiedy kurierzy jeszcze zdążą z dostawą.",
    market:
      "Klienci coraz wcześniej zaczynają szukać promocji - pierwsze kampanie „Black Week” ruszają już w połowie listopada, a koszt kliknięcia w tygodniu Black Friday rośnie zwykle o 20-40%. Rośnie też popularność zakupów na raty i darmowych zwrotów.",
    recommendations: [
      `Od ${warmupLabel} stopniowo zwiększać budżet i budować listy remarketingowe, zanim kliknięcia zdrożeją.`,
      "Przygotować osobne kreacje na Black Week z bestsellerami: sweter z merino, płaszcz wełniany, koc waflowy.",
      "Zaplanować newsletter z wcześniejszym dostępem do promocji - e-mail ma u Was najwyższą konwersję.",
      "Wyraźnie komunikować ostatni dzień zamówień z dostawą przed Świętami (18 grudnia).",
    ],
  };
}

// ---- public API -------------------------------------------------------------

export interface DemoEcom {
  today: string;
  rangeLabel: string;
  rangeStart: string;
  rangeEnd: string;
  trend: TrendPoint[];
  ecommerce: EcommerceKpis;
  spend: number;
  settings: EcomSettings;
  pacing: MonthPacing;
  yoy: YearOverYear;
  season: SeasonPlan | null;
  channels: ChannelEfficiency;
  products: ProductRow[];
  topPages: Array<{ path: string; views: number; engagementRate: number }>;
  devices: Array<{ device: string; sessions: number }>;
  engagementRate: number; // percent
  analysis: EcomAnalysis;
  analysisGeneratedAt: string; // ISO, UTC
}

export const DEMO_ECOM_SETTINGS: EcomSettings = {
  marginPct: 45,
  revenueIncludesVat: true,
  available: true,
};

/** Monthly revenue goals (grosze) the demo shop has set. */
function goalFor(monthStart: string): number | null {
  const m = Number(monthStart.slice(5, 7));
  // Goals sit a touch above the seasonal norm, so pacing has something to chase.
  const base = 300_000_00 * (SEASON[m - 1] / SEASON[9]);
  return Math.round(base / 1000_00) * 1000_00;
}

function buildPacing(today: string): MonthPacing {
  const monthStart = monthStartOf(today);
  const monthEnd = monthEndOf(today);
  const dim = daysInMonth(today);
  const yesterday = addDays(today, -1);
  const completeDays = diffDays(monthStart, today);
  const remainingDays = dim - completeDays;
  const lyMonthStart = shiftMonths(monthStart, -12);
  const recentStart = addDays(yesterday, -13);
  const rev = (v: DemoDay) => v.revenue;

  const mtd =
    completeDays > 0
      ? sumRange(monthStart, yesterday, today, rev)
      : { total: 0, daysWithData: 0, days: 0 };
  const todayRevenue = dayData(today, today)?.revenue ?? 0;
  const mtdSpend = sumRange(monthStart, yesterday, today, (v) => v.spend).total;
  const recent = sumRange(recentStart, yesterday, today, rev);
  const recentDailyAvg = recent.daysWithData > 0 ? recent.total / recent.daysWithData : 0;

  const lyRemaining = sumRange(
    addDays(today, -YOY_SHIFT_DAYS),
    addDays(monthEnd, -YOY_SHIFT_DAYS),
    today,
    rev
  );
  const lyRecent = sumRange(
    addDays(recentStart, -YOY_SHIFT_DAYS),
    addDays(yesterday, -YOY_SHIFT_DAYS),
    today,
    rev
  );
  const seasonalFactor =
    lyRecent.total > 0 && lyRemaining.daysWithData > 0
      ? Math.min(
          3,
          Math.max(
            0.5,
            lyRemaining.total /
              lyRemaining.daysWithData /
              (lyRecent.total / lyRecent.daysWithData)
          )
        )
      : null;

  const forecast = mtd.total + recentDailyAvg * (seasonalFactor ?? 1) * remainingDays;
  const lastYearMonthRevenue = sumRange(
    lyMonthStart,
    monthEndOf(lyMonthStart),
    today,
    rev
  ).total;
  const goal = goalFor(monthStart);
  const forecastPct = goal ? forecast / goal : null;
  const status: MonthPacing["status"] =
    forecastPct === null
      ? "no_goal"
      : forecastPct >= 1.05
        ? "ahead"
        : forecastPct >= 0.95
          ? "on_track"
          : "behind";

  return {
    monthStart,
    monthLabel: monthLabelPl(monthStart),
    daysInMonth: dim,
    completeDays,
    remainingDays,
    mtdRevenue: mtd.total,
    todayRevenue,
    mtdSpend,
    mtdRoas: mtdSpend > 0 ? mtd.total / mtdSpend : null,
    recentDailyAvg,
    seasonalFactor,
    forecast,
    goal,
    progressPct: goal ? mtd.total / goal : null,
    forecastPct,
    requiredDaily:
      goal && remainingDays > 0 ? Math.max(0, goal - mtd.total) / remainingDays : null,
    lastYearMonthRevenue,
    missingDays: 0,
    forecastReliable: true,
    status,
  };
}

function buildYoy(start: string, end: string, today: string): YearOverYear {
  const lyStart = addDays(start, -YOY_SHIFT_DAYS);
  const lyEnd = addDays(end, -YOY_SHIFT_DAYS);
  const days = Math.max(1, diffDays(start, end) + 1);
  const series: YearOverYear["series"] = [];
  let revenue = 0;
  let transactions = 0;
  let sessions = 0;
  for (let i = 0; i < days; i++) {
    const v = dayData(addDays(lyStart, i), today);
    if (v) {
      revenue += v.revenue;
      transactions += v.transactions;
      sessions += v.sessions;
    }
    series.push({ date: addDays(start, i), revenue: v ? v.revenue : null });
  }
  return {
    available: revenue > 0,
    coverage: 1,
    lyStart,
    lyEnd,
    revenue,
    transactions,
    sessions,
    spend: sumRange(lyStart, lyEnd, today, (v) => v.spend).total,
    series,
  };
}

function buildSeason(today: string): SeasonPlan | null {
  if (Number(today.slice(5, 7)) < 9) return null;
  const year = Number(today.slice(0, 4));
  const ly = year - 1;
  const bf = blackFriday(year);
  const lyBf = blackFriday(ly);
  const rev = (v: DemoDay) => v.revenue;
  const month = (start: string) => sumRange(start, monthEndOf(start), today, rev).total;

  const octRevenue = month(`${ly}-10-01`);
  const novRevenue = month(`${ly}-11-01`);
  const decRevenue = month(`${ly}-12-01`);
  const novSpend = sumRange(`${ly}-11-01`, `${ly}-11-30`, today, (v) => v.spend).total;
  const bfWeekStart = addDays(lyBf, -1);
  const bfWeekEnd = addDays(lyBf, 3);
  const bfWeekRevenue = sumRange(bfWeekStart, bfWeekEnd, today, rev).total;

  let bestDay: { date: string; revenue: number } | null = null;
  for (let d = `${ly}-11-01`; d <= `${ly}-12-31`; d = addDays(d, 1)) {
    const v = computeDay(d).revenue;
    if (v > (bestDay?.revenue ?? 0)) bestDay = { date: d, revenue: v };
  }

  const events: SeasonEvent[] = [
    { key: "bf", label: "Black Friday", date: bf, lastYearDate: lyBf },
    { key: "cm", label: "Cyber Monday", date: addDays(bf, 3), lastYearDate: addDays(lyBf, 3) },
    { key: "mikolajki", label: "Mikołajki", date: `${year}-12-06`, lastYearDate: `${ly}-12-06` },
    {
      key: "xmas",
      label: "Ostatnie zamówienia przed Świętami",
      date: `${year}-12-18`,
      lastYearDate: `${ly}-12-18`,
    },
  ]
    .map((e) => ({
      ...e,
      daysTo: diffDays(today, e.date),
      lastYearRevenue: computeDay(e.lastYearDate).revenue,
    }))
    .filter((e) => e.daysTo >= 0);

  const novRoas = novSpend > 0 ? novRevenue / novSpend : null;
  const novemberGoal = goalFor(`${year}-11-01`);
  return {
    today,
    events,
    lastYear: {
      year: ly,
      octRevenue,
      novRevenue,
      decRevenue,
      novSpend,
      novRoas,
      bfWeekStart,
      bfWeekEnd,
      bfWeekRevenue,
      bfWeekShareOfNov: novRevenue ? bfWeekRevenue / novRevenue : null,
      bestDay,
      novVsOct: octRevenue ? novRevenue / octRevenue : null,
    },
    novemberGoal,
    suggestedNovBudget: novRoas && novemberGoal ? novemberGoal / novRoas : null,
    suggestedBudgetBasis: novRoas && novemberGoal ? "goal" : null,
    warmupStart: addDays(bf, -21),
  };
}

function buildChannels(today: string): ChannelEfficiency {
  // GA4 source snapshots cover the 30 days up to the last full sync (yesterday).
  const windowEnd = addDays(today, -1);
  const windowStart = addDays(windowEnd, -29);
  const r = rng(`demo-ecom-channels:${windowEnd}`);
  const totals = {
    revenue: sumRange(windowStart, windowEnd, today, (v) => v.revenue).total,
    sessions: sumRange(windowStart, windowEnd, today, (v) => v.sessions).total,
    transactions: sumRange(windowStart, windowEnd, today, (v) => v.transactions).total,
    meta: sumRange(windowStart, windowEnd, today, (v) => v.metaSpend).total,
    google: sumRange(windowStart, windowEnd, today, (v) => v.googleSpend).total,
  };
  const aovBy: Partial<Record<ChannelKey, number>> = {
    meta: 0.92,
    google_ads: 1.04,
    email: 1.08,
  };

  const split = CHANNELS.map((c) => ({
    key: c.key,
    revenue: Math.round(totals.revenue * c.revenue * jitter(r, 0.04)),
    sessions: Math.round(totals.sessions * c.sessions * jitter(r, 0.04)),
    weight: (totals.revenue * c.revenue) / (aovBy[c.key] ?? 1),
  }));
  // Orders are split by revenue / channel AOV, then scaled so the channels add
  // up to the shop's real order count - the table footer must match the KPIs.
  const weightSum = split.reduce((a, c) => a + c.weight, 0);
  const raw = split.map((c) => ({
    channel: c.key,
    revenue: c.revenue,
    sessions: c.sessions,
    transactions: Math.round((totals.transactions * c.weight) / weightSum),
    spend: c.key === "meta" ? totals.meta : c.key === "google_ads" ? totals.google : null,
  }));
  const totalRevenue = raw.reduce((a, v) => a + v.revenue, 0);
  const rows: ChannelRow[] = raw
    .map((v) => ({
      channel: v.channel,
      label: CHANNEL_LABEL[v.channel],
      revenue: v.revenue,
      transactions: v.transactions,
      sessions: v.sessions,
      spend: v.spend,
      roas: v.spend ? v.revenue / v.spend : null,
      cpa: v.spend && v.transactions > 0 ? v.spend / v.transactions : null,
      conversionRate: v.sessions > 0 ? v.transactions / v.sessions : null,
      share: totalRevenue > 0 ? v.revenue / totalRevenue : 0,
    }))
    .sort((a, b) => {
      const paidA = a.spend !== null ? 1 : 0;
      const paidB = b.spend !== null ? 1 : 0;
      return paidB - paidA || b.revenue - a.revenue;
    });

  return {
    windowStart,
    windowEnd,
    rows,
    totalRevenue,
    revenuePending: false,
    untrackedPaid: [],
  };
}

/** The AI analysis "runs" daily at 06:10 Warsaw time; before that hour the
 *  latest one is yesterday's, so the timestamp is never in the future. */
function lastDailyRun(today: string): string {
  const run = fromZonedTime(`${today}T06:10:00`, "Europe/Warsaw");
  const latest =
    run.getTime() <= Date.now()
      ? run
      : fromZonedTime(`${addDays(today, -1)}T06:10:00`, "Europe/Warsaw");
  return latest.toISOString();
}

export function getDemoEcom(
  rangeKey: RangeKey = "30d",
  custom: CustomRange | null = null,
  today = todayWarsaw()
): DemoEcom {
  const range = resolveRange(rangeKey, custom, today);

  const trend: TrendPoint[] = [];
  for (let d = range.start; d <= range.end; d = addDays(d, 1)) {
    const v = dayData(d, today);
    // Future days of a custom/"month" range stay out of the chart, as in the
    // real data layer (no rows synced yet).
    if (!v) continue;
    trend.push({
      date: d,
      spendMinorUnits: v.spend,
      sessions: v.sessions,
      clicks: v.clicks,
      impressions: v.impressions,
      conversions: v.conversions,
      revenueMinorUnits: v.revenue,
      transactions: v.transactions,
    });
  }

  const sum = (start: string, end: string, pick: (v: DemoDay) => number) =>
    sumRange(start, end, today, pick).total;
  const cur = {
    revenue: sum(range.start, range.end, (v) => v.revenue),
    transactions: sum(range.start, range.end, (v) => v.transactions),
    spend: sum(range.start, range.end, (v) => v.spend),
  };
  const prev = {
    revenue: sum(range.prevStart, range.prevEnd, (v) => v.revenue),
    transactions: sum(range.prevStart, range.prevEnd, (v) => v.transactions),
    spend: sum(range.prevStart, range.prevEnd, (v) => v.spend),
  };
  const roasOf = (rev: number, spend: number) => (spend > 0 ? rev / spend : 0);
  const aovOf = (rev: number, tx: number) => (tx > 0 ? rev / tx : 0);
  const ecommerce: EcommerceKpis = {
    revenueMinorUnits: kpi(cur.revenue, prev.revenue),
    transactions: kpi(cur.transactions, prev.transactions),
    roas: kpi(
      Math.round(roasOf(cur.revenue, cur.spend) * 100),
      Math.round(roasOf(prev.revenue, prev.spend) * 100)
    ),
    aovMinorUnits: kpi(
      Math.round(aovOf(cur.revenue, cur.transactions)),
      Math.round(aovOf(prev.revenue, prev.transactions))
    ),
  };

  // Products scale with the selected range's revenue, like the GA4 items read.
  const products: ProductRow[] = PRODUCTS.map((p) => {
    const r = rng(`demo-ecom-product:${p.id}:${range.start}:${range.end}`);
    const revenue = cur.revenue * p.share * jitter(r, 0.05);
    const quantity = Math.max(cur.revenue > 0 ? 1 : 0, Math.round(revenue / p.price));
    return {
      itemId: p.id,
      itemName: p.name,
      quantity,
      revenueMinorUnits: quantity * p.price,
    };
  }).sort((a, b) => b.revenueMinorUnits - a.revenueMinorUnits);

  // Website widgets in the real app read a fixed last-30-days window.
  const w30Start = addDays(today, -29);
  const sessions30 = sum(w30Start, today, (v) => v.sessions);
  const topPages = TOP_PAGES.map((p) => ({
    path: p.path,
    views: Math.round(sessions30 * p.share * 1.6),
    engagementRate: p.engagementRate,
  }));
  const devices = [
    { device: "mobile", sessions: Math.round(sessions30 * 0.71) },
    { device: "desktop", sessions: Math.round(sessions30 * 0.25) },
    { device: "tablet", sessions: Math.round(sessions30 * 0.04) },
  ];

  return {
    today,
    rangeLabel: range.label,
    rangeStart: range.start,
    rangeEnd: range.end,
    trend,
    ecommerce,
    spend: cur.spend,
    settings: DEMO_ECOM_SETTINGS,
    pacing: buildPacing(today),
    yoy: buildYoy(range.start, range.end, today),
    season: buildSeason(today),
    channels: buildChannels(today),
    products,
    topPages,
    devices,
    engagementRate: 58,
    analysis: demoAnalysis(dayLabelPl(addDays(blackFriday(Number(today.slice(0, 4))), -21))),
    analysisGeneratedAt: lastDailyRun(today),
  };
}
