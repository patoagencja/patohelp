import { formatInTimeZone } from "date-fns-tz";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";

// E-commerce insights computed from what we already sync (ga4_daily revenue +
// ads_daily spend) - no external API calls and no AI tokens. Money is grosze
// throughout. Callers must have verified the user can see `clientId` (the
// pages resolve the client through RLS first); reads here use the admin client.

const WARSAW_TZ = "Europe/Warsaw";
const DAY_MS = 86_400_000;
export const VAT_RATE = 0.23;
/** Shift used for year-over-year: 52 weeks keeps weekdays aligned, which
 *  matters far more in retail than matching the calendar date. */
const YOY_SHIFT_DAYS = 364;

const MONTHS_PL = [
  "styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec",
  "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień",
];
const MONTHS_PL_GEN = [
  "stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca",
  "lipca", "sierpnia", "września", "października", "listopada", "grudnia",
];

// ---- date helpers (plain yyyy-MM-dd strings, UTC maths, no TZ drift) ----

const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (s: string, n: number) =>
  iso(new Date(toDate(s).getTime() + n * DAY_MS));
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
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
};
export const todayWarsaw = () =>
  formatInTimeZone(new Date(), WARSAW_TZ, "yyyy-MM-dd");
export const monthLabelPl = (monthStart: string) => {
  const d = toDate(monthStart);
  return `${MONTHS_PL[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
export const dayLabelPl = (s: string) => {
  const d = toDate(s);
  return `${d.getUTCDate()} ${MONTHS_PL_GEN[d.getUTCMonth()]}`;
};

/** Black Friday = the day after US Thanksgiving (4th Thursday of November). */
export function blackFriday(year: number): string {
  const dow = new Date(Date.UTC(year, 10, 1)).getUTCDay(); // 0 = Sunday
  const firstThursday = 1 + ((4 - dow + 7) % 7);
  return iso(new Date(Date.UTC(year, 10, firstThursday + 21 + 1)));
}

// ---- raw series ----

export interface DayRevenue {
  revenue: number; // grosze
  transactions: number;
  sessions: number;
}

/**
 * Daily GA4 totals (the rows with no dimension) in [start, end]. A date absent
 * from the map means "no data synced" - deliberately distinct from a real 0,
 * so a dead integration doesn't masquerade as a sales collapse.
 * Returns null when the revenue columns don't exist yet (pre-0016).
 */
export async function getDailyRevenue(
  clientId: string,
  start: string,
  end: string
): Promise<Map<string, DayRevenue> | null> {
  const admin = createAdminClient();
  try {
    const rows = await fetchAll<Record<string, unknown>>((from, to) =>
      admin
        .from("ga4_daily")
        .select("date, sessions, revenue_minor_units, transactions")
        .eq("client_id", clientId)
        .is("source_medium", null)
        .is("device_category", null)
        .is("page_path", null)
        .gte("date", start)
        .lte("date", end)
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    );
    const out = new Map<string, DayRevenue>();
    for (const r of rows) {
      const date = r.date as string;
      const cur = out.get(date) ?? { revenue: 0, transactions: 0, sessions: 0 };
      cur.revenue += Number(r.revenue_minor_units ?? 0);
      cur.transactions += Number(r.transactions ?? 0);
      cur.sessions += Number(r.sessions ?? 0);
      out.set(date, cur);
    }
    return out;
  } catch {
    return null;
  }
}

export interface DaySpend {
  total: number;
  meta_ads: number;
  google_ads: number;
  tiktok_ads: number;
}

/** Daily ad spend in [start, end], total and per platform. */
export async function getDailySpend(
  clientId: string,
  start: string,
  end: string
): Promise<Map<string, DaySpend>> {
  const admin = createAdminClient();
  const out = new Map<string, DaySpend>();
  try {
    const rows = await fetchAll<Record<string, unknown>>((from, to) =>
      admin
        .from("ads_daily")
        .select("date, provider, spend_minor_units")
        .eq("client_id", clientId)
        .gte("date", start)
        .lte("date", end)
        .order("date", { ascending: true })
        .order("provider", { ascending: true })
        .order("campaign_id", { ascending: true })
        .range(from, to)
    );
    for (const r of rows) {
      const date = r.date as string;
      const cur =
        out.get(date) ?? { total: 0, meta_ads: 0, google_ads: 0, tiktok_ads: 0 };
      const spend = Number(r.spend_minor_units ?? 0);
      cur.total += spend;
      const p = r.provider as keyof Omit<DaySpend, "total">;
      if (p in cur) cur[p] += spend;
      out.set(date, cur);
    }
  } catch {
    // Spend is supplementary here; an empty map degrades to "no ROAS".
  }
  return out;
}

function sumRange<T>(
  map: Map<string, T>,
  start: string,
  end: string,
  pick: (v: T) => number
): { total: number; daysWithData: number; days: number } {
  let total = 0;
  let daysWithData = 0;
  const days = Math.max(0, diffDays(start, end) + 1);
  for (let i = 0; i < days; i++) {
    const v = map.get(addDays(start, i));
    if (v !== undefined) {
      total += pick(v);
      daysWithData += 1;
    }
  }
  return { total, daysWithData, days };
}

// ---- settings & goals ----

export interface EcomSettings {
  marginPct: number | null;
  revenueIncludesVat: boolean;
  /** false until migration 0021 has been applied. */
  available: boolean;
}

export async function getEcomSettings(clientId: string): Promise<EcomSettings> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ecom_settings")
    .select("gross_margin_pct, revenue_includes_vat")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) return { marginPct: null, revenueIncludesVat: true, available: false };
  return {
    marginPct:
      data?.gross_margin_pct != null ? Number(data.gross_margin_pct) : null,
    revenueIncludesVat: data?.revenue_includes_vat ?? true,
    available: true,
  };
}

/** Goals keyed by month start (yyyy-MM-01). Empty when the table is missing. */
export async function getRevenueGoals(
  clientId: string,
  months: string[]
): Promise<Map<string, number>> {
  const admin = createAdminClient();
  const out = new Map<string, number>();
  const { data, error } = await admin
    .from("revenue_goals")
    .select("month, goal_minor_units")
    .eq("client_id", clientId)
    .in("month", months);
  if (error) return out;
  for (const r of data ?? []) {
    out.set(String(r.month).slice(0, 10), Number(r.goal_minor_units));
  }
  return out;
}

// ---- profit ----

export interface ProfitSummary {
  netRevenue: number;
  grossProfit: number;
  profitAfterAds: number;
  roas: number | null;
  /** Profit on ad spend: gross profit per 1 zł of ads. >1 means ads pay. */
  poas: number | null;
  /** ROAS (on the GA4 revenue figure) at which ads exactly pay for themselves. */
  breakEvenRoas: number;
  marginPct: number;
}

export function computeProfit(
  revenue: number,
  spend: number,
  settings: Pick<EcomSettings, "marginPct" | "revenueIncludesVat">
): ProfitSummary | null {
  if (settings.marginPct == null || settings.marginPct <= 0) return null;
  const m = settings.marginPct / 100;
  const vatDivisor = settings.revenueIncludesVat ? 1 + VAT_RATE : 1;
  const netRevenue = revenue / vatDivisor;
  const grossProfit = netRevenue * m;
  return {
    netRevenue,
    grossProfit,
    profitAfterAds: grossProfit - spend,
    roas: spend > 0 ? revenue / spend : null,
    poas: spend > 0 ? grossProfit / spend : null,
    breakEvenRoas: vatDivisor / m,
    marginPct: settings.marginPct,
  };
}

// ---- month pacing & forecast ----

export interface MonthPacing {
  monthStart: string;
  monthLabel: string;
  daysInMonth: number;
  /** Fully finished days so far (today is partial and excluded from maths). */
  completeDays: number;
  remainingDays: number;
  /** Revenue of complete days only. */
  mtdRevenue: number;
  /** Today's revenue so far (partial, shown for context). */
  todayRevenue: number;
  mtdSpend: number;
  mtdRoas: number | null;
  recentDailyAvg: number;
  /** Last-year shape of the rest of the month vs its recent pace; null when
   *  last year's data is too thin to trust. */
  seasonalFactor: number | null;
  forecast: number;
  goal: number | null;
  progressPct: number | null;
  forecastPct: number | null;
  requiredDaily: number | null;
  lastYearMonthRevenue: number | null;
  /** Days this month with no synced GA4 data - forecast is understated. */
  missingDays: number;
  /** false when the 14-day pace window is mostly unsynced (a dead GA4
   *  integration): the forecast would confidently say "0 zł", so hide it. */
  forecastReliable: boolean;
  status: "ahead" | "on_track" | "behind" | "no_goal";
}

export async function getMonthPacing(
  clientId: string,
  today = todayWarsaw()
): Promise<MonthPacing | null> {
  const monthStart = monthStartOf(today);
  const monthEnd = monthEndOf(today);
  const dim = daysInMonth(today);
  const yesterday = addDays(today, -1);
  const completeDays = diffDays(monthStart, today); // days before today
  const remainingDays = dim - completeDays;

  // One read covers: this month, the 14-day pace window, and last year's
  // aligned windows (+ the calendar month a year ago).
  const lyMonthStart = shiftMonths(monthStart, -12);
  const lyMonthEnd = monthEndOf(lyMonthStart);
  const recentStart = addDays(yesterday, -13);
  const readStart = [lyMonthStart, addDays(recentStart, -YOY_SHIFT_DAYS)].sort()[0];

  const [revenue, spend, goals] = await Promise.all([
    getDailyRevenue(clientId, readStart, today),
    getDailySpend(clientId, monthStart, today),
    getRevenueGoals(clientId, [monthStart]),
  ]);
  if (!revenue) return null;

  const mtd =
    completeDays > 0
      ? sumRange(revenue, monthStart, yesterday, (v) => v.revenue)
      : { total: 0, daysWithData: 0, days: 0 };
  const todayRevenue = revenue.get(today)?.revenue ?? 0;
  const mtdSpend = sumRange(spend, monthStart, yesterday, (v) => v.total).total;

  const recent = sumRange(revenue, recentStart, yesterday, (v) => v.revenue);
  const recentDailyAvg =
    recent.daysWithData > 0 ? recent.total / recent.daysWithData : 0;

  // Seasonal factor from last year: how the remaining days of this month
  // performed relative to the 14 days before - this is what makes a November
  // forecast expect the Black Friday spike instead of extrapolating October.
  let seasonalFactor: number | null = null;
  const lyRemaining = sumRange(
    revenue,
    addDays(today, -YOY_SHIFT_DAYS),
    addDays(monthEnd, -YOY_SHIFT_DAYS),
    (v) => v.revenue
  );
  const lyRecent = sumRange(
    revenue,
    addDays(recentStart, -YOY_SHIFT_DAYS),
    addDays(yesterday, -YOY_SHIFT_DAYS),
    (v) => v.revenue
  );
  if (
    lyRemaining.days > 0 &&
    lyRemaining.daysWithData / lyRemaining.days >= 0.7 &&
    lyRecent.daysWithData / Math.max(1, lyRecent.days) >= 0.7 &&
    lyRecent.total > 0
  ) {
    const raw =
      lyRemaining.total /
      lyRemaining.daysWithData /
      (lyRecent.total / lyRecent.daysWithData);
    seasonalFactor = Math.min(3, Math.max(0.5, raw));
  }

  const forecast =
    mtd.total + recentDailyAvg * (seasonalFactor ?? 1) * remainingDays;

  const lyMonth = sumRange(revenue, lyMonthStart, lyMonthEnd, (v) => v.revenue);
  const lastYearMonthRevenue =
    lyMonth.days > 0 && lyMonth.daysWithData / lyMonth.days >= 0.8
      ? lyMonth.total
      : null;

  const goal = goals.get(monthStart) ?? null;
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
    missingDays: completeDays - mtd.daysWithData,
    forecastReliable: recent.daysWithData >= 7,
    status: recent.daysWithData >= 7 ? status : "no_goal",
  };
}

// ---- year over year ----

export interface YearOverYear {
  available: boolean;
  /** Share of last-year days that have synced data (0..1). */
  coverage: number;
  lyStart: string;
  lyEnd: string;
  revenue: number;
  transactions: number;
  sessions: number;
  spend: number;
  /** Last year's revenue per CURRENT date, for overlaying on the chart. */
  series: Array<{ date: string; revenue: number | null }>;
}

export async function getYearOverYear(
  clientId: string,
  start: string,
  end: string
): Promise<YearOverYear> {
  const lyStart = addDays(start, -YOY_SHIFT_DAYS);
  const lyEnd = addDays(end, -YOY_SHIFT_DAYS);
  const [revenue, spend] = await Promise.all([
    getDailyRevenue(clientId, lyStart, lyEnd),
    getDailySpend(clientId, lyStart, lyEnd),
  ]);
  const days = Math.max(1, diffDays(start, end) + 1);
  const series: YearOverYear["series"] = [];
  let rev = 0;
  let tx = 0;
  let sess = 0;
  let withData = 0;
  for (let i = 0; i < days; i++) {
    const v = revenue?.get(addDays(lyStart, i));
    if (v) {
      rev += v.revenue;
      tx += v.transactions;
      sess += v.sessions;
      withData += 1;
    }
    series.push({ date: addDays(start, i), revenue: v ? v.revenue : null });
  }
  const coverage = withData / days;
  return {
    // A sparse last year gives misleading deltas - only show it when solid.
    available: Boolean(revenue) && coverage >= 0.8 && rev > 0,
    coverage,
    lyStart,
    lyEnd,
    revenue: rev,
    transactions: tx,
    sessions: sess,
    spend: sumRange(spend, lyStart, lyEnd, (v) => v.total).total,
    series,
  };
}

// ---- Q4 / peak season plan ----

export interface SeasonEvent {
  key: string;
  label: string;
  date: string;
  daysTo: number;
  /** Same event last year, from the client's own data. */
  lastYearDate: string;
  lastYearRevenue: number | null;
}

export interface SeasonPlan {
  today: string;
  events: SeasonEvent[];
  lastYear: null | {
    year: number;
    octRevenue: number | null;
    novRevenue: number | null;
    decRevenue: number | null;
    novSpend: number;
    novRoas: number | null;
    /** Thursday before Black Friday through Cyber Monday. */
    bfWeekStart: string;
    bfWeekEnd: string;
    bfWeekRevenue: number | null;
    bfWeekShareOfNov: number | null;
    bestDay: { date: string; revenue: number } | null;
    novVsOct: number | null;
  };
  novemberGoal: number | null;
  /** Budget needed to hit the November goal (or repeat last November) at
   *  last November's ROAS. */
  suggestedNovBudget: number | null;
  suggestedBudgetBasis: "goal" | "repeat_last_year" | null;
  warmupStart: string;
}

/**
 * Peak-season planner built from the client's OWN last year: what November,
 * Black Friday week and December did, at what ROAS, and what that implies for
 * this year's budget. Relevant from September through December.
 */
export async function getSeasonPlan(
  clientId: string,
  today = todayWarsaw()
): Promise<SeasonPlan | null> {
  const month = Number(today.slice(5, 7));
  if (month < 9) return null;

  const year = Number(today.slice(0, 4));
  const ly = year - 1;
  const bf = blackFriday(year);
  const lyBf = blackFriday(ly);
  const evDate = (y: number, mmdd: string) => `${y}-${mmdd}`;

  const lyOct = `${ly}-10-01`;
  const lyDecEnd = `${ly}-12-31`;
  const [revenue, spend, goals] = await Promise.all([
    getDailyRevenue(clientId, lyOct, lyDecEnd),
    getDailySpend(clientId, `${ly}-11-01`, `${ly}-11-30`),
    getRevenueGoals(clientId, [`${year}-11-01`]),
  ]);

  const monthTotal = (start: string) => {
    if (!revenue) return null;
    const r = sumRange(revenue, start, monthEndOf(start), (v) => v.revenue);
    return r.daysWithData / r.days >= 0.8 ? r.total : null;
  };
  const dayRevenue = (d: string) => revenue?.get(d)?.revenue ?? null;

  const octRevenue = monthTotal(lyOct);
  const novRevenue = monthTotal(`${ly}-11-01`);
  const decRevenue = monthTotal(`${ly}-12-01`);
  const novSpend = sumRange(spend, `${ly}-11-01`, `${ly}-11-30`, (v) => v.total).total;

  const bfWeekStart = addDays(lyBf, -1);
  const bfWeekEnd = addDays(lyBf, 3); // Cyber Monday
  const bfWeek = revenue
    ? sumRange(revenue, bfWeekStart, bfWeekEnd, (v) => v.revenue)
    : null;
  const bfWeekRevenue =
    bfWeek && bfWeek.daysWithData === bfWeek.days ? bfWeek.total : null;

  let bestDay: { date: string; revenue: number } | null = null;
  for (const [date, v] of revenue ?? []) {
    if (date >= `${ly}-11-01` && v.revenue > (bestDay?.revenue ?? 0)) {
      bestDay = { date, revenue: v.revenue };
    }
  }

  const hasLastYear = novRevenue !== null || decRevenue !== null;
  const novRoas = novRevenue !== null && novSpend > 0 ? novRevenue / novSpend : null;

  const events: SeasonEvent[] = [
    { key: "bf", label: "Black Friday", date: bf, lastYearDate: lyBf },
    {
      key: "cm",
      label: "Cyber Monday",
      date: addDays(bf, 3),
      lastYearDate: addDays(lyBf, 3),
    },
    {
      key: "mikolajki",
      label: "Mikołajki",
      date: evDate(year, "12-06"),
      lastYearDate: evDate(ly, "12-06"),
    },
    {
      key: "xmas",
      label: "Ostatnie zamówienia przed Świętami",
      date: evDate(year, "12-18"),
      lastYearDate: evDate(ly, "12-18"),
    },
  ]
    .map((e) => ({
      ...e,
      daysTo: diffDays(today, e.date),
      lastYearRevenue: dayRevenue(e.lastYearDate),
    }))
    .filter((e) => e.daysTo >= 0);

  const novemberGoal = goals.get(`${year}-11-01`) ?? null;
  let suggestedNovBudget: number | null = null;
  let suggestedBudgetBasis: SeasonPlan["suggestedBudgetBasis"] = null;
  if (novRoas && novRoas > 0) {
    if (novemberGoal) {
      suggestedNovBudget = novemberGoal / novRoas;
      suggestedBudgetBasis = "goal";
    } else if (novRevenue) {
      suggestedNovBudget = novRevenue / novRoas;
      suggestedBudgetBasis = "repeat_last_year";
    }
  }

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
          bfWeekShareOfNov:
            bfWeekRevenue !== null && novRevenue ? bfWeekRevenue / novRevenue : null,
          bestDay,
          novVsOct: novRevenue && octRevenue ? novRevenue / octRevenue : null,
        }
      : null,
    novemberGoal,
    suggestedNovBudget,
    suggestedBudgetBasis,
    warmupStart: addDays(bf, -21),
  };
}

// ---- channel efficiency (GA4 last-click revenue vs platform spend) ----

export type ChannelKey =
  | "meta"
  | "google_ads"
  | "tiktok"
  | "organic_search"
  | "social_organic"
  | "direct"
  | "email"
  | "other";

export const CHANNEL_LABEL: Record<ChannelKey, string> = {
  meta: "Meta Ads",
  google_ads: "Google Ads",
  tiktok: "TikTok Ads",
  organic_search: "Wyszukiwarka (bezpłatnie)",
  social_organic: "Social media (bezpłatnie)",
  direct: "Wejścia bezpośrednie",
  email: "E-mail / newsletter",
  other: "Pozostałe",
};

const PAID_MEDIUM = /(cpc|ppc|paid|cpm|cpv|cpa|ads|display|retargeting|remarketing)/;

export function channelOf(sourceMedium: string): ChannelKey {
  const sm = sourceMedium.toLowerCase();
  const [source = "", medium = ""] = sm.split("/").map((s) => s.trim());
  const paid = PAID_MEDIUM.test(medium);

  if (/(facebook|instagram|^fb$|^ig$|meta|^an$|messenger)/.test(source)) {
    return paid ? "meta" : "social_organic";
  }
  if (source.includes("tiktok")) return paid ? "tiktok" : "social_organic";
  if (/(google|youtube)/.test(source) && (paid || medium === "pmax")) {
    return "google_ads";
  }
  if (medium === "organic") return "organic_search";
  if (source === "(direct)") return "direct";
  if (/(email|newsletter|mail)/.test(medium) || /(klaviyo|mailchimp|getresponse|freshmail|newsletter)/.test(source)) {
    return "email";
  }
  if (/(social|linkedin|pinterest|twitter|x\.com|youtube)/.test(sm)) {
    return "social_organic";
  }
  return "other";
}

export interface ChannelRow {
  channel: ChannelKey;
  label: string;
  revenue: number;
  transactions: number;
  sessions: number;
  spend: number | null; // null for unpaid channels
  roas: number | null;
  cpa: number | null; // cost per order
  conversionRate: number | null; // transactions / sessions
  share: number; // of attributed revenue
}

export interface ChannelEfficiency {
  windowStart: string;
  windowEnd: string;
  rows: ChannelRow[];
  totalRevenue: number;
  /** Revenue on source rows is synced from the latest release on; until the
   *  next sync every row is 0 even though daily revenue exists. */
  revenuePending: boolean;
  /** Paid platforms spending money GA4 can't see - usually missing UTMs. */
  untrackedPaid: ChannelKey[];
}

const PAID_PROVIDER: Partial<Record<ChannelKey, keyof Omit<DaySpend, "total">>> = {
  meta: "meta_ads",
  google_ads: "google_ads",
  tiktok: "tiktok_ads",
};

export async function getChannelEfficiency(
  clientId: string
): Promise<ChannelEfficiency | null> {
  const admin = createAdminClient();

  // Latest source snapshot (one per sync, covering the 30 days before it).
  const { data: latest, error } = await admin
    .from("ga4_daily")
    .select("date")
    .eq("client_id", clientId)
    .not("source_medium", "is", null)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !latest?.date) return null;
  const windowEnd = latest.date as string;
  const windowStart = addDays(windowEnd, -29);

  const { data: rows, error: rowsErr } = await admin
    .from("ga4_daily")
    .select("source_medium, sessions, revenue_minor_units, transactions")
    .eq("client_id", clientId)
    .eq("date", windowEnd)
    .not("source_medium", "is", null);
  if (rowsErr) return null;

  const byChannel = new Map<
    ChannelKey,
    { revenue: number; transactions: number; sessions: number }
  >();
  for (const r of rows ?? []) {
    const ch = channelOf(String(r.source_medium));
    const cur = byChannel.get(ch) ?? { revenue: 0, transactions: 0, sessions: 0 };
    cur.revenue += Number(r.revenue_minor_units ?? 0);
    cur.transactions += Number(r.transactions ?? 0);
    cur.sessions += Number(r.sessions ?? 0);
    byChannel.set(ch, cur);
  }

  const spend = await getDailySpend(clientId, windowStart, windowEnd);
  const spendBy = (p: keyof Omit<DaySpend, "total">) =>
    sumRange(spend, windowStart, windowEnd, (v) => v[p]).total;

  // Paid platforms always appear when they spend, even with zero GA4 revenue -
  // that gap is exactly what the agency needs to see.
  for (const ch of ["meta", "google_ads", "tiktok"] as ChannelKey[]) {
    if (!byChannel.has(ch) && spendBy(PAID_PROVIDER[ch]!) > 0) {
      byChannel.set(ch, { revenue: 0, transactions: 0, sessions: 0 });
    }
  }

  const totalRevenue = [...byChannel.values()].reduce((a, v) => a + v.revenue, 0);
  const untrackedPaid: ChannelKey[] = [];

  const out: ChannelRow[] = [...byChannel.entries()].map(([channel, v]) => {
    const provider = PAID_PROVIDER[channel];
    const s = provider ? spendBy(provider) : null;
    if (provider && s && s > 0 && v.sessions === 0) untrackedPaid.push(channel);
    return {
      channel,
      label: CHANNEL_LABEL[channel],
      revenue: v.revenue,
      transactions: v.transactions,
      sessions: v.sessions,
      spend: s,
      roas: s && s > 0 ? v.revenue / s : null,
      cpa: s && s > 0 && v.transactions > 0 ? s / v.transactions : null,
      conversionRate: v.sessions > 0 ? v.transactions / v.sessions : null,
      share: totalRevenue > 0 ? v.revenue / totalRevenue : 0,
    };
  });

  out.sort((a, b) => {
    const paidA = a.spend !== null ? 1 : 0;
    const paidB = b.spend !== null ? 1 : 0;
    return paidB - paidA || b.revenue - a.revenue;
  });

  return {
    windowStart,
    windowEnd,
    rows: out,
    totalRevenue,
    revenuePending:
      totalRevenue === 0 && out.some((r) => r.sessions > 0),
    untrackedPaid,
  };
}
