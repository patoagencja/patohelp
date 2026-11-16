import type { ProductRow } from "@/components/dashboard/ecom/top-products";
import type { EcomAnalysis } from "@/lib/ecom/analysis";
import { buildNewVsReturning, type NewVsReturning } from "@/lib/ecom/new-vs-returning";
import {
  CHANNEL_LABEL,
  monthLabelPl,
  type ChannelEfficiency,
  type ChannelRow,
  type EcomSettings,
  type MonthPacing,
  type SeasonEvent,
  type SeasonPlan,
  type YearOverYear,
} from "@/lib/ecom/insights";
import type { EcommerceKpis, TrendPoint } from "@/lib/dashboard/metrics";
import type { CustomRange, RangeKey } from "@/lib/dashboard/ranges";
import { DEMO_PRODUCTS } from "@/lib/demo/brand";
import { demoDashboardData, monthEndOf } from "@/lib/demo/dashboard";
import { demoSite } from "@/lib/demo/data";
import { addDaysIso } from "@/lib/demo/profile/anonymize";
import { blackFridayOf, diffDaysIso, splitExact, sumDays, type DemoDay, type DemoSource } from "@/lib/demo/source";
import { demoEcomAnalysis, lastDailyRun } from "@/lib/demo/texts";

// The public Sprzedaż tab for the demo shop (Mediaspec, lib/demo/brand.ts):
// the same widgets as app/(dashboard)/[clientSlug]/sprzedaz, fed by the
// demo source (lib/demo/source.ts) - the very days Przegląd, Reklamy and
// Strona www read. Shapes mirror lib/ecom/insights.ts so the real widgets
// render exactly as they would for a live client.

const YOY_SHIFT_DAYS = 364; // 52 weeks, weekday-aligned - same as insights.ts

const monthStartOf = (s: string) => `${s.slice(0, 7)}-01`;
const shiftMonths = (monthStart: string, n: number) => {
  const d = new Date(`${monthStart}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)).toISOString().slice(0, 10);
};
const hasSales = (d: DemoDay) => d.hasSales;
const rev = (d: DemoDay) => d.revenue;

/** An electronics shop's gross margin: thin, which is why ROAS has to be high. */
export const DEMO_ECOM_SETTINGS: EcomSettings = {
  marginPct: 22,
  revenueIncludesVat: true,
  available: true,
};

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

/**
 * The month's revenue goal, as the shop would have set it: last year's same
 * month + 10% when last year is in the data, else the month's projection
 * from its own pace; rounded to 10 000 zł.
 */
export function demoRevenueGoal(src: DemoSource, monthStart: string): number | null {
  const ly = shiftMonths(monthStart, -12);
  const lyMonth = sumDays(src, ly, monthEndOf(ly), rev, hasSales);
  const round = (v: number) => Math.max(10_000_00, Math.round(v / 10_000_00) * 10_000_00);
  if (lyMonth.days > 0 && lyMonth.daysWithData / lyMonth.days >= 0.8) return round(lyMonth.total * 1.1);
  if (monthStart !== monthStartOf(src.today)) return null;
  const yesterday = addDaysIso(src.today, -1);
  const mtd = sumDays(src, monthStart, yesterday, rev, hasSales);
  const recent = sumDays(src, addDaysIso(yesterday, -13), yesterday, rev, hasSales);
  if (recent.daysWithData < 7) return null;
  const remaining = diffDaysIso(src.today, monthEndOf(monthStart)) + 1;
  return round(mtd.total + (recent.total / recent.daysWithData) * remaining);
}

/** "Czy dowieziemy cel?" - the live month pacing (lib/ecom/insights.ts) on the demo's days. */
export function demoMonthPacing(src: DemoSource): MonthPacing {
  const today = src.today;
  const monthStart = monthStartOf(today);
  const monthEnd = monthEndOf(today);
  const dim = diffDaysIso(monthStart, monthEnd) + 1;
  const yesterday = addDaysIso(today, -1);
  const completeDays = diffDaysIso(monthStart, today);
  const remainingDays = dim - completeDays;
  const lyMonthStart = shiftMonths(monthStart, -12);
  const recentStart = addDaysIso(yesterday, -13);

  const mtd = completeDays > 0 ? sumDays(src, monthStart, yesterday, rev, hasSales) : { total: 0, daysWithData: 0, days: 0 };
  const todayRevenue = src.day(today)?.revenue ?? 0;
  const mtdSpend = sumDays(src, monthStart, yesterday, (d) => d.spend).total;
  const recent = sumDays(src, recentStart, yesterday, rev, hasSales);
  const recentDailyAvg = recent.daysWithData > 0 ? recent.total / recent.daysWithData : 0;

  const lyRemaining = sumDays(src, addDaysIso(today, -YOY_SHIFT_DAYS), addDaysIso(monthEnd, -YOY_SHIFT_DAYS), rev, hasSales);
  const lyRecent = sumDays(src, addDaysIso(recentStart, -YOY_SHIFT_DAYS), addDaysIso(yesterday, -YOY_SHIFT_DAYS), rev, hasSales);
  const seasonalFactor =
    lyRemaining.days > 0 &&
    lyRemaining.daysWithData / lyRemaining.days >= 0.7 &&
    lyRecent.daysWithData / Math.max(1, lyRecent.days) >= 0.7 &&
    lyRecent.total > 0
      ? Math.min(3, Math.max(0.5, lyRemaining.total / lyRemaining.daysWithData / (lyRecent.total / lyRecent.daysWithData)))
      : null;

  const forecast = mtd.total + recentDailyAvg * (seasonalFactor ?? 1) * remainingDays;
  const lyMonth = sumDays(src, lyMonthStart, monthEndOf(lyMonthStart), rev, hasSales);
  const lastYearMonthRevenue = lyMonth.days > 0 && lyMonth.daysWithData / lyMonth.days >= 0.8 ? lyMonth.total : null;
  const goal = demoRevenueGoal(src, monthStart);
  const forecastPct = goal ? forecast / goal : null;
  const status: MonthPacing["status"] =
    forecastPct === null ? "no_goal" : forecastPct >= 1.05 ? "ahead" : forecastPct >= 0.95 ? "on_track" : "behind";

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
    requiredDaily: goal && remainingDays > 0 ? Math.max(0, goal - mtd.total) / remainingDays : null,
    lastYearMonthRevenue,
    missingDays: completeDays - mtd.daysWithData,
    forecastReliable: recent.daysWithData >= 7,
    status: recent.daysWithData >= 7 ? status : "no_goal",
  };
}

function buildYoy(src: DemoSource, start: string, end: string): YearOverYear {
  const lyStart = addDaysIso(start, -YOY_SHIFT_DAYS);
  const lyEnd = addDaysIso(end, -YOY_SHIFT_DAYS);
  const days = Math.max(1, diffDaysIso(start, end) + 1);
  const series: YearOverYear["series"] = [];
  let revenue = 0;
  let transactions = 0;
  let sessions = 0;
  let withData = 0;
  for (let i = 0; i < days; i++) {
    const v = src.day(addDaysIso(lyStart, i));
    const ok = v && v.hasSales;
    if (ok) {
      revenue += v.revenue;
      transactions += v.orders;
      sessions += v.sessions;
      withData += 1;
    }
    series.push({ date: addDaysIso(start, i), revenue: ok ? v.revenue : null });
  }
  const coverage = withData / days;
  return {
    available: coverage >= 0.8 && revenue > 0,
    coverage,
    lyStart,
    lyEnd,
    revenue,
    transactions,
    sessions,
    spend: sumDays(src, lyStart, lyEnd, (d) => d.spend).total,
    series,
  };
}

/** The Q4 planner (lib/ecom/insights.ts getSeasonPlan) on last year's days. */
function buildSeason(src: DemoSource): SeasonPlan | null {
  const today = src.today;
  if (Number(today.slice(5, 7)) < 9) return null;
  const year = Number(today.slice(0, 4));
  const ly = year - 1;
  const bf = blackFridayOf(year);
  const lyBf = blackFridayOf(ly);
  const month = (start: string) => {
    const r = sumDays(src, start, monthEndOf(start), rev, hasSales);
    return r.daysWithData / r.days >= 0.8 ? r.total : null;
  };
  const octRevenue = month(`${ly}-10-01`);
  const novRevenue = month(`${ly}-11-01`);
  const decRevenue = month(`${ly}-12-01`);
  const novSpend = sumDays(src, `${ly}-11-01`, `${ly}-11-30`, (d) => d.spend).total;
  const bfWeekStart = addDaysIso(lyBf, -1);
  const bfWeekEnd = addDaysIso(lyBf, 3);
  const bfWeek = sumDays(src, bfWeekStart, bfWeekEnd, rev, hasSales);
  const bfWeekRevenue = bfWeek.daysWithData === bfWeek.days ? bfWeek.total : null;

  let bestDay: { date: string; revenue: number } | null = null;
  for (let d = `${ly}-11-01`; d <= `${ly}-12-31`; d = addDaysIso(d, 1)) {
    const v = src.day(d);
    if (v?.hasSales && v.revenue > (bestDay?.revenue ?? 0)) bestDay = { date: d, revenue: v.revenue };
  }
  const dayRevenue = (d: string) => {
    const v = src.day(d);
    return v?.hasSales ? v.revenue : null;
  };
  const events: SeasonEvent[] = [
    { key: "bf", label: "Black Friday", date: bf, lastYearDate: lyBf },
    { key: "cm", label: "Cyber Monday", date: addDaysIso(bf, 3), lastYearDate: addDaysIso(lyBf, 3) },
    { key: "mikolajki", label: "Mikołajki", date: `${year}-12-06`, lastYearDate: `${ly}-12-06` },
    { key: "xmas", label: "Ostatnie zamówienia przed Świętami", date: `${year}-12-18`, lastYearDate: `${ly}-12-18` },
  ]
    .map((e) => ({ ...e, daysTo: diffDaysIso(today, e.date), lastYearRevenue: dayRevenue(e.lastYearDate) }))
    .filter((e) => e.daysTo >= 0);

  const hasLastYear = novRevenue !== null || decRevenue !== null;
  const novRoas = novRevenue !== null && novSpend > 0 ? novRevenue / novSpend : null;
  const novemberGoal = demoRevenueGoal(src, `${year}-11-01`);
  const suggested =
    novRoas && novRoas > 0
      ? novemberGoal
        ? { budget: novemberGoal / novRoas, basis: "goal" as const }
        : novRevenue
          ? { budget: novRevenue / novRoas, basis: "repeat_last_year" as const }
          : null
      : null;
  return {
    today,
    events,
    lastYear: hasLastYear
      ? {
          year: ly,
          octRevenue,
          novRevenue,
          decRevenue,
          novSpend,
          novRoas,
          bfWeekStart,
          bfWeekEnd,
          bfWeekRevenue,
          bfWeekShareOfNov: bfWeekRevenue !== null && novRevenue ? bfWeekRevenue / novRevenue : null,
          bestDay,
          novVsOct: novRevenue && octRevenue ? novRevenue / octRevenue : null,
        }
      : null,
    novemberGoal,
    suggestedNovBudget: suggested?.budget ?? null,
    suggestedBudgetBasis: suggested?.basis ?? null,
    warmupStart: addDaysIso(bf, -21),
  };
}

/** GA4 last-click revenue by channel vs platform spend, over the 30 days to yesterday. */
function buildChannels(src: DemoSource): ChannelEfficiency {
  const windowEnd = addDaysIso(src.today, -1);
  const windowStart = addDaysIso(windowEnd, -29);
  const sum = (pick: (d: DemoDay) => number) => sumDays(src, windowStart, windowEnd, pick).total;
  const totals = {
    revenue: sum(rev),
    orders: sum((d) => d.orders),
    sessions: sum((d) => d.sessions),
    meta: sum((d) => d.meta.spend),
    google: sum((d) => d.google.spend),
  };
  const ch = src.channels;
  // Split exactly, so the table's footer is the KPIs' totals.
  const revenue = splitExact(totals.revenue, ch.map((c) => c.revenueShare));
  const orders = splitExact(totals.orders, ch.map((c) => c.ordersShare));
  const sessions = splitExact(totals.sessions, ch.map((c) => c.sessionsShare));
  const rows: ChannelRow[] = ch
    .map((c, i) => {
      const spend = c.channel === "meta" ? totals.meta : c.channel === "google_ads" ? totals.google : null;
      return {
        channel: c.channel,
        label: CHANNEL_LABEL[c.channel],
        revenue: revenue[i],
        transactions: orders[i],
        sessions: sessions[i],
        spend,
        roas: spend ? revenue[i] / spend : null,
        cpa: spend && orders[i] > 0 ? spend / orders[i] : null,
        conversionRate: sessions[i] > 0 ? orders[i] / sessions[i] : null,
        share: totals.revenue > 0 ? revenue[i] / totals.revenue : 0,
      };
    })
    .sort((a, b) => (b.spend !== null ? 1 : 0) - (a.spend !== null ? 1 : 0) || b.revenue - a.revenue);
  return { windowStart, windowEnd, rows, totalRevenue: totals.revenue, revenuePending: false, untrackedPaid: [] };
}

/** Best sellers for a range: the shop's revenue split by the profile's ranks. */
function buildProducts(src: DemoSource, rangeRevenue: number): ProductRow[] {
  const total = rangeRevenue * src.productsCoverage;
  return src.products
    .slice(0, DEMO_PRODUCTS.length)
    .map((s, i) => {
      const p = DEMO_PRODUCTS[i];
      const quantity = Math.max(rangeRevenue > 0 ? 1 : 0, Math.round((total * s.revenueShare) / p.price));
      return { itemId: p.id, itemName: p.name, quantity, revenueMinorUnits: quantity * p.price };
    })
    .sort((a, b) => b.revenueMinorUnits - a.revenueMinorUnits);
}

export function getDemoEcom(src: DemoSource, rangeKey: RangeKey = "30d", custom: CustomRange | null = null): DemoEcom {
  const dd = demoDashboardData(src, rangeKey, custom, "pl");
  const site = demoSite(src);
  const products = buildProducts(src, dd.ecommerce.revenueMinorUnits.value);
  // The analysis names the best sellers of its own 30 days.
  const top30 = buildProducts(src, sumDays(src, addDaysIso(src.today, -30), addDaysIso(src.today, -1), rev).total);
  return {
    today: src.today,
    rangeLabel: dd.rangeLabel,
    rangeStart: dd.range.start,
    rangeEnd: dd.range.end,
    trend: dd.trend,
    ecommerce: dd.ecommerce,
    spend: dd.kpis.spendMinorUnits.value,
    settings: DEMO_ECOM_SETTINGS,
    pacing: demoMonthPacing(src),
    yoy: buildYoy(src, dd.range.start, dd.range.end),
    season: buildSeason(src),
    channels: buildChannels(src),
    products,
    topPages: site.topPages,
    devices: site.devices,
    engagementRate: dd.engagementRate ?? site.engagementRate,
    analysis: demoEcomAnalysis(src, DEMO_ECOM_SETTINGS, top30.map((p) => p.itemName)),
    analysisGeneratedAt: lastDailyRun(src.today),
  };
}

/**
 * "Nowi czy stali klienci" for the demo shop: the same 30-day snapshot window
 * as the live GA4 sync (30daysAgo..yesterday). Most orders come from new
 * buyers; returning ones spend a little more per order (accessories,
 * a second appliance).
 */
export function getDemoNewVsReturning(src: DemoSource): NewVsReturning | null {
  const windowStart = addDaysIso(src.today, -30);
  const windowEnd = addDaysIso(src.today, -1);
  const total = (pick: (v: DemoDay) => number) => sumDays(src, windowStart, windowEnd, pick).total;
  const revenue = total(rev);
  const orders = total((v) => v.orders);
  const sessions = total((v) => v.sessions);
  const newSessions = total((v) => v.newUsers);
  if (orders <= 0) return null;
  const newOrders = Math.round(orders * 0.64);
  const newRevenue = Math.round(newOrders * (revenue / orders) * 0.94);
  const newSess = Math.min(sessions, Math.round(newSessions * 1.05));
  return buildNewVsReturning(
    src.today,
    {
      new: { revenueMinorUnits: newRevenue, transactions: newOrders, users: newSessions, sessions: newSess },
      returning: {
        revenueMinorUnits: revenue - newRevenue,
        transactions: orders - newOrders,
        users: Math.round((sessions - newSess) * 0.55),
        sessions: sessions - newSess,
      },
    },
    total((v) => v.spend)
  );
}
