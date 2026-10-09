import { fromZonedTime } from "date-fns-tz";

import type { ProductRow } from "@/components/dashboard/ecom/top-products";
import type { EcomAnalysis } from "@/lib/ecom/analysis";
import { buildNewVsReturning, type NewVsReturning } from "@/lib/ecom/new-vs-returning";
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

// Synthetic e-commerce client for the public /demo-full/sprzedaz showcase:
// lokalnepomidorki, the demo's one shop - an online vegetable shop that
// delivers veg boxes, tomatoes and preserves across Poland (~280k zł/month
// in October, ROAS ~5, 45% margin: it buys straight from the growers). Every day's numbers are a pure function
// of its date (hashed seed), so the demo is stable across reloads and the
// same date always shows the same sales, whatever "today" is. Shapes mirror
// lib/ecom/insights.ts so the real widgets render exactly as they would for
// a live client.

const DAY_MS = 86_400_000;
const YOY_SHIFT_DAYS = 364; // 52 weeks, weekday-aligned - same as insights.ts

// Growth is anchored to a fixed date (not "today") so a given day never
// changes value; the shop grows ~18% a year.
const GROWTH_ANCHOR = "2026-10-01";
const YEARLY_GROWTH = 1.18;

const BASE_DAILY_REVENUE = 9_030_00; // grosze, ≈ 280k zł / 31 days in October
const BASE_AOV = 128_00; // grosze: a veg box and a few extras
const BASE_CR = 0.016; // orders per session
const BASE_ROAS = 5;
const BASE_CPC = 1_15; // grosze
const BASE_CTR = 0.014;
/** Fraction of today already "synced" - today is always a partial day. */
const TODAY_PARTIAL = 0.42;

// Month index -> demand multiplier for a weekly veg-box shop: summer is the
// soft spot (holidays, the family allotment's own tomatoes), customers come
// back to weekly orders in September and the year peaks with Christmas
// cooking. The creative-test demo (lib/demo/ab.ts) spends along the same curve.
export const DEMO_MONTH_DEMAND: readonly number[] = [0.92, 0.88, 0.94, 1.0, 0.95, 0.88, 0.8, 0.82, 0.92, 1.0, 1.05, 1.12];
const SEASON = DEMO_MONTH_DEMAND;
// The week's boxes are ordered Sunday to Tuesday; Friday and Saturday are quiet.
const WEEKDAY = [1.12, 1.08, 1.04, 1.0, 0.97, 0.9, 0.86]; // Sun..Sat

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

/** A grocery's calendar: a modest Black Friday (people still buy food, just
 *  more of it on a coupon), the Christmas cooking run-up with bigger baskets
 *  until the last delivery day, the dead days around Christmas and the
 *  "eat better" first weeks of January. */
function eventOf(date: string): { demand: number; aov: number; cr: number } {
  const year = Number(date.slice(0, 4));
  const md = date.slice(5);
  const fromBf = diffDays(blackFriday(year), date);
  const bfCurve: Record<number, number> = { [-1]: 1.15, 0: 1.45, 1: 1.25, 2: 1.15, 3: 1.3 };
  if (fromBf in bfCurve) return { demand: bfCurve[fromBf], aov: 0.95, cr: 1.2 };
  if (md >= "12-10" && md <= "12-20") {
    // Holiday cooking builds up to the last delivery before Christmas Eve.
    const day = Number(md.slice(3));
    return { demand: 1.15 + (day - 10) * 0.05, aov: 1.18, cr: 1.15 };
  }
  if (md >= "12-21" && md <= "12-23") return { demand: 0.75, aov: 1.1, cr: 1.0 };
  if (md >= "12-24" && md <= "12-26") return { demand: 0.25, aov: 0.95, cr: 0.8 };
  if (md >= "12-27" && md <= "12-31") return { demand: 0.8, aov: 0.95, cr: 1.0 };
  if (md >= "01-02" && md <= "01-14") return { demand: 1.1, aov: 0.95, cr: 1.05 };
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
  const days = key === "7d" ? 7 : key === "90d" ? 90 : key === "365d" ? 365 : 30;
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
  { id: "SKR-SEZ-6", name: "Skrzynka warzyw sezonowych – 6 kg", price: 119_00, share: 0.118 },
  { id: "SKR-ROD-10", name: "Skrzynka rodzinna warzyw – 10 kg", price: 169_00, share: 0.087 },
  { id: "POM-MAL-5", name: "Pomidory malinowe – 5 kg", price: 79_00, share: 0.066 },
  { id: "POM-PRZ-10", name: "Pomidory na przetwory – 10 kg", price: 89_00, share: 0.052 },
  { id: "SKR-OW-8", name: "Skrzynka owocowo-warzywna – 8 kg", price: 149_00, share: 0.047 },
  { id: "PAS-DOM-6", name: "Passata domowa – 6 × 700 ml", price: 84_00, share: 0.034 },
  { id: "KAP-KIS-5", name: "Kapusta do kiszenia – 5 kg", price: 39_00, share: 0.026 },
  { id: "POM-KOK-2", name: "Pomidorki koktajlowe mix kolorów – 2 kg", price: 49_00, share: 0.023 },
  { id: "ZIE-JES-15", name: "Ziemniaki jesienne – 15 kg", price: 55_00, share: 0.019 },
  { id: "MIO-WIE-1", name: "Miód wielokwiatowy od sąsiada pszczelarza – 1 kg", price: 69_00, share: 0.014 },
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
  { path: "/skrzynki-warzyw", share: 0.22, engagementRate: 66 },
  { path: "/pomidory", share: 0.15, engagementRate: 63 },
  { path: "/produkt/skrzynka-warzyw-sezonowych-6-kg", share: 0.09, engagementRate: 71 },
  { path: "/przetwory-i-kiszonki", share: 0.08, engagementRate: 61 },
];

function demoAnalysis(warmupLabel: string): EcomAnalysis {
  return {
    headline:
      "Sprzedaż rośnie szybciej niż rok temu, a reklamy zarabiają z zapasem - po sezonie pomidorowym to dobry moment, żeby przestawić reklamy na skrzynki warzyw i przygotować budżet na Święta.",
    performance:
      "W ostatnich 30 dniach sklep sprzedawał średnio za ok. 8 tys. zł dziennie, czyli wyraźnie więcej niż w tym samym okresie rok temu. Na każdą złotówkę wydaną na reklamy wraca ok. 5 zł przychodu, a to prawie dwa razy więcej niż próg opłacalności przy Twojej marży. Najlepiej sprzedają się skrzynki warzyw sezonowych, a pomidory na przetwory jeszcze się trzymają, choć sezon się kończy.",
    peaks: [
      { label: "Niedziele i poniedziałki", note: "klienci zamawiają skrzynki na cały tydzień - o ok. 40% więcej niż w soboty" },
      { label: "Koniec sezonu na przetwory", note: "pomidory na przetwory i passata sprzedawały się najmocniej we wrześniu" },
      { label: "Święta rok temu", note: "10 dni przed Wigilią przyniosło ok. 1,5 razy więcej niż zwykły tydzień" },
    ],
    seasonality:
      "Skrzynki warzyw najsłabiej idą latem (urlopy, własne działki), a od września klienci wracają do cotygodniowych zamówień. Szczyt roku to ok. 10 dni przed Wigilią, kiedy zamawiają warzywa do świątecznego gotowania - z większym koszykiem niż zwykle. Black Friday daje warzywniakom tylko niewielki skok.",
    market:
      "Coraz więcej osób kupuje warzywa przez internet regularnie, co tydzień, a nie tylko od święta. Klienci zwracają uwagę na pochodzenie i świeżość, więc „od lokalnego rolnika” i dostawa następnego dnia działają w reklamach lepiej niż rabaty. Przed Świętami koszt kliknięcia zwykle rośnie o 15-25%, bo reklamują się wszystkie sklepy spożywcze.",
    recommendations: [
      "Przenieść budżet z kampanii pomidorowych na skrzynki warzyw - sezon na pomidory gruntowe właśnie się kończy.",
      "Zaproponować stałą dostawę skrzynki co tydzień - stali klienci zamawiają częściej i więcej.",
      `Od ${warmupLabel} budować listy remarketingowe, a w grudniu pokazać świąteczne skrzynki na Wigilię.`,
      "Wyraźnie komunikować ostatni dzień zamówień z dostawą przed Wigilią (20 grudnia).",
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
  const base = 290_000_00 * (SEASON[m - 1] / SEASON[9]);
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
    {
      key: "xmas",
      label: "Ostatnie zamówienia przed Świętami",
      // Fresh food ships later than parcels: the last box goes out on the 20th.
      date: `${year}-12-20`,
      lastYearDate: `${ly}-12-20`,
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

/**
 * "Nowi czy stali klienci" for the demo shop: the same 30-day snapshot window
 * as the live GA4 sync (30daysAgo..yesterday). A growing veg-box shop - most
 * orders from new buyers, returning ones spend a bit more per basket.
 */
export function getDemoNewVsReturning(today = todayWarsaw()): NewVsReturning | null {
  const windowStart = addDays(today, -30);
  const windowEnd = addDays(today, -1);
  const total = (pick: (v: DemoDay) => number) =>
    sumRange(windowStart, windowEnd, today, pick).total;
  const revenue = total((v) => v.revenue);
  const orders = total((v) => v.transactions);
  const sessions = total((v) => v.sessions);
  if (orders <= 0) return null;

  const r = rng(`demo-ecom-nvr:${windowEnd}`);
  const newOrderShare = 0.58 * jitter(r, 0.04);
  const newOrders = Math.round(orders * newOrderShare);
  const newRevenue = Math.round(newOrders * (revenue / orders) * 0.91);
  const newSessions = Math.round(sessions * 0.66);
  return buildNewVsReturning(
    today,
    {
      new: {
        revenueMinorUnits: newRevenue,
        transactions: newOrders,
        users: Math.round(newSessions * 0.97),
        sessions: newSessions,
      },
      returning: {
        revenueMinorUnits: revenue - newRevenue,
        transactions: orders - newOrders,
        users: Math.round((sessions - newSessions) * 0.55),
        sessions: sessions - newSessions,
      },
    },
    total((v) => v.spend)
  );
}
