import { format, subDays } from "date-fns";
import { formatInTimeZone, getTimezoneOffset } from "date-fns-tz";

import type { Anomaly } from "@/lib/alerts/anomalies";
import { DEMO_PREV_CHANGE, demoPrevTotal } from "@/lib/dashboard/chart-events";
import { buildFlowAlert, clockLabel, localClock, type FlowAlert, type FlowIncident } from "@/lib/alerts/data-flow";
import { buildStreakAlert, STREAK_WINDOW_DAYS, type DayTotals } from "@/lib/alerts/streaks";
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
import {
  DEMO_DEVICE_SHARES,
  DEMO_ENGAGEMENT_RATE,
  demoMonthSpend,
  demoTopPages,
  getDemoShopDays,
} from "@/lib/demo/ecom";
import { addDays } from "@/lib/ecom/insights";
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

const EN_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const enList = (items: string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/**
 * The weekday-streak card (lib/alerts/streaks.ts) on synthetic days of the
 * demo shop: purchases from ads well below the usual for the last two days
 * while spend, clicks and visits hold. It runs through the very function
 * live clients get, so the demo shows the real wording, weekday forms and
 * hint - whatever weekday "today" is.
 */
function demoStreakAlert(today: Date, en: boolean): Anomaly[] {
  // The demo shop's week (lib/demo/ecom.ts): boxes are ordered Sunday to
  // Tuesday, Friday and Saturday are quiet.
  const week = [1.12, 1.08, 1.04, 1.0, 0.97, 0.9, 0.86]; // Sun..Sat
  const days: Record<string, DayTotals> = {};
  for (let i = 1; i <= STREAK_WINDOW_DAYS; i++) {
    const date = subDays(today, i);
    const w = week[date.getDay()];
    // Yesterday deeper: the streak rules give ad purchases a newest-day
    // allowance for late attribution.
    const dip = i === 1 ? 0.53 : i === 2 ? 0.66 : 1;
    days[format(date, "yyyy-MM-dd")] = {
      spend: Math.round(160_000 * w),
      clicks: Math.round(1_400 * w),
      impressions: Math.round(98_000 * w),
      sessions: Math.round(1_100 * w),
      purchases: Math.round(90 * w * dip),
    };
  }
  const s = buildStreakAlert({ today: format(today, "yyyy-MM-dd"), shop: true, days });
  if (!s) return [];
  const streak = { start: s.start, end: s.end, days: s.days };
  if (!en) {
    return [
      {
        id: s.id,
        severity: s.severity,
        scope: "client",
        scopeLabel: s.scopeLabel,
        metric: s.label,
        direction: s.direction,
        changePct: s.changePct,
        title: s.title,
        description: s.description,
        why: s.why,
        action: s.action,
        streak,
      },
    ];
  }
  const dates = Array.from({ length: s.days }, (_, k) => subDays(today, s.days - k));
  const names = dates.map((d) => EN_WEEKDAYS[d.getDay()]);
  const actual = dates.reduce((a, d) => a + (days[format(d, "yyyy-MM-dd")].purchases ?? 0), 0);
  // changePct = sum(actual) / sum(usual) - 1.
  const usual = Math.round(actual / (1 + s.changePct / 100));
  return [
    {
      id: s.id,
      severity: s.severity,
      scope: "client",
      scopeLabel: "Whole account",
      metric: "Purchases from ads",
      direction: s.direction,
      changePct: s.changePct,
      title: `For ${s.days} days, purchases from ads have been ${Math.round(Math.abs(s.changePct))}% below a usual ${enList(names)}`,
      description: `${enList(names)}: ${actual} purchases from ads, usually about ${usual} on these days.`,
      why: "The ads bring fewer buyers - each purchase from ads gets more expensive. Not a one-off: each day was clearly below the same weekday over the previous 4 weeks.",
      action: "Traffic is unchanged but purchases are down — let's check the website and the cart.",
      streak,
    },
  ];
}

/**
 * The same-day data-flow guards (lib/alerts/data-flow.ts) on the demo shop:
 * payments stuck for 3 hours (Pilne), Analytics catching almost nobody, the
 * Meta pixel counting no purchases, and the shop's sales feed gone quiet.
 * Polish runs through the very wording live clients get; the times are
 * relative to now, so "od 11:00" never lies about the clock the viewer sees.
 */
function demoFlowAlerts(now: Date, en: boolean): Anomaly[] {
  const offset = Math.round(getTimezoneOffset("Europe/Warsaw", now) / 60_000);
  // Today's orders so far, as "Dziś" and Sprzedaż count them - a fixed 23
  // here sat next to "Dziś do tej pory ... z 32 zamówień".
  const todayStr = formatInTimeZone(now, "Europe/Warsaw", "yyyy-MM-dd");
  const shopOrders = getDemoShopDays(todayStr, todayStr, todayStr)[0]?.transactions ?? 0;
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
  const local = (iso: string) => localClock(iso, offset);
  const fromHour = Math.max(0, local(now.toISOString()).hour - 3);
  const lastPushAt = ago(4 * 60 + 20);
  const seen = ago(10);
  const incident = (
    guard: FlowIncident["guard"],
    startedMinAgo: number,
    severity: FlowIncident["severity"],
    facts: FlowIncident["facts"]
  ): FlowIncident => ({
    id: `demo-flow-${guard}`,
    guard,
    since: ago(startedMinAgo),
    startedAt: ago(startedMinAgo),
    lastSeen: seen,
    severity,
    facts,
  });
  const incidents: FlowIncident[] = [
    incident("checkout", 40, "critical", {
      guard: "checkout",
      hint: "payment",
      fromHour,
      hours: 3,
      carts: 34,
      checkouts: 12,
      expected: 7.4,
      orders: null,
    }),
    incident("ga4", 65, "high", { guard: "ga4", users: 1, events: 6, usual: 14, clicks: 52, minutes: 60 }),
    incident("meta-pixel", 70, "high", {
      guard: "meta-pixel",
      clicks: 1_240,
      usualClicks: 1_180,
      purchases: 0,
      expected: 9.3,
      shopPurchases: shopOrders,
      source: "shop",
    }),
    incident("shop-feed", 40, "high", { guard: "shop-feed", lastPushAt, ageMin: 260, usualGapMin: 60 }),
  ];
  const pl = incidents.map((inc) => buildFlowAlert(inc, true, offset)).filter((a): a is FlowAlert => a !== null);
  const ga4From = clockLabel(Math.floor(Math.max(0, local(ago(65)).mod - 30) / 5) * 5);
  const pushAt = clockLabel(local(lastPushAt).mod);
  const english: Record<string, Pick<Anomaly, "scopeLabel" | "metric" | "title" | "description" | "why" | "action"> & { label: string }> = {
    checkout: {
      scopeLabel: "Shop",
      metric: "Cart and payments",
      title: "Cart or payments may be broken",
      description: `${fromHour === 0 ? "Nobody has bought today" : `Nobody has bought since ${fromHour}:00`}, although there were 34 add-to-carts and 12 checkouts started. With this traffic there would usually be about 7 purchases by now.`,
      why: "People want to buy, but something stops them — every hour without purchases is lost sales.",
      action: `Check payments — customers reach the checkout, but nobody has paid ${fromHour === 0 ? "since the morning" : "for 3 hours"}.`,
      label: fromHour === 0 ? "today" : `since ${fromHour}:00`,
    },
    ga4: {
      scopeLabel: "Website traffic · GA4",
      metric: "Analytics",
      title: "Analytics data isn't coming in",
      description: `Since about ${ga4From}, Google Analytics sees only 1 person on the site per half hour, usually about 14 at this time. The ads brought 52 clicks in the last hour.`,
      why: "Without Analytics data you can't see what happens in the shop, and the campaigns lose the signal of who buys. If the site itself went down, every hour means lost orders.",
      action: "Check that the Google tag (gtag/GTM) is on the site — ad traffic is coming, but Analytics sees nothing. Also check that the site opens at all.",
      label: `since about ${ga4From}`,
    },
    "meta-pixel": {
      scopeLabel: "Sales tracking · Meta",
      metric: "Meta pixel",
      title: "Meta pixel isn't counting purchases",
      description: `Meta shows no purchase from ads today, although the ads brought 1,240 clicks — as many as usual by this time. With this traffic Meta usually counts about 9 purchases by now, and the shop has ${shopOrders} orders today.`,
      why: "Meta learns from purchases — without them, sales campaigns don't know whom to look for and get weaker and pricier every hour.",
      action: "Check the Meta pixel / Conversions API — the shop sells, but Meta doesn't see purchases.",
      label: "today",
    },
    "shop-feed": {
      scopeLabel: "Shop",
      metric: "Shop data",
      title: "Shop orders stopped coming in",
      description: `The shop last sent its sales at ${pushAt} (over 4 hours ago); it usually does every hour. The panel doesn't see new orders.`,
      why: "Without the shop's data the panel shows understated sales and won't notice if orders really stop. If the shop itself is down, every hour means lost orders.",
      action: "Check that the shop works and that its job sending sales to the panel (hourly, with an API key) hasn't stopped.",
      label: `since ${pushAt}`,
    },
  };
  return pl.map((a) => {
    const e = english[a.guard];
    return {
      id: a.id,
      severity: a.severity,
      scope: "client",
      scopeLabel: en ? e.scopeLabel : a.scopeLabel,
      metric: en ? e.metric : a.label,
      direction: "down",
      changePct: a.changePct,
      title: en ? e.title : a.title,
      description: en ? e.description : a.description,
      why: en ? e.why : a.why,
      action: en ? e.action : a.action,
      intraday: { since: a.since, label: en ? e.label : a.sinceLabel },
    };
  });
}

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
  // The shop's calendar day, like the Sprzedaż demo (and the live data).
  const todayStr = formatInTimeZone(today, "Europe/Warsaw", "yyyy-MM-dd");

  // --- 30-day trend: the shop's own days (lib/demo/ecom.ts) -----------------
  // Spend, clicks and visits are the Sprzedaż demo's numbers for the same
  // days, so no page of the demo can show another total for the same range.
  // Today is partial, as in the live data. Impressions are set after the
  // campaigns (below), from their click-through rates.
  const shopDays = getDemoShopDays(addDays(todayStr, -(DAYS - 1)), todayStr, todayStr);
  const trend: TrendPoint[] = shopDays.map((v) => ({
    date: v.date,
    spendMinorUnits: v.spend,
    sessions: v.sessions,
    clicks: v.clicks,
    impressions: 0,
    conversions: v.conversions,
    revenueMinorUnits: 0,
    transactions: 0,
  }));

  const sum = (f: (p: TrendPoint) => number) => trend.reduce((a, p) => a + f(p), 0);

  const curSpend = sum((p) => p.spendMinorUnits);
  const curClicks = sum((p) => p.clicks);
  const curSessions = sum((p) => p.sessions);
  const curConv = sum((p) => p.conversions);
  const platformSpend = {
    meta_ads: shopDays.reduce((a, v) => a + v.metaSpend, 0),
    google_ads: shopDays.reduce((a, v) => a + v.googleSpend, 0),
  };

  // --- Campaigns (Meta + Google) --------------------------------------------
  // lokalnepomidorki's own campaigns: the Meta ones are the ones whose ads
  // "Testy kreacji" (lib/demo/ab.ts) compares, with about the same split of
  // the budget; Google covers search, the shop feed and a farm video.
  // Weights split each platform's spend (the shop's own Meta / Google days),
  // so Reklamy's platform split is Sprzedaż's. No two weights are equal
  // within a platform: three campaigns at the same "3 072 zł" looked made up.
  const campaignDefs: Array<{
    id: string;
    provider: "meta_ads" | "google_ads";
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
    { id: "d-g1", provider: "google_ads", namePl: "SEARCH | Marka lokalnepomidorki", nameEn: "SEARCH | Brand lokalnepomidorki", weight: 0.08, ctr: 8.5, status: "active", reasonPl: null, reasonEn: null },
    { id: "d-g2", provider: "google_ads", namePl: "SEARCH | Warzywa z dostawą", nameEn: "SEARCH | Veg delivery", weight: 0.15, ctr: 4.5, status: "active", reasonPl: null, reasonEn: null },
    { id: "d-g3", provider: "google_ads", namePl: "PMAX | Sklep z warzywami", nameEn: "PMAX | Veg shop", weight: 0.13, ctr: 1.8, status: "attention", reasonPl: "Wydatki powyżej normy", reasonEn: "Spend above normal" },
    { id: "d-g4", provider: "google_ads", namePl: "YT | Wideo z gospodarstwa", nameEn: "YT | Farm video", weight: 0.06, ctr: 1.1, status: "active", reasonPl: null, reasonEn: null },
  ];

  /** Split `total` by `weights`, rounding so the parts add up exactly. */
  const split = (total: number, weights: number[]) => {
    const wSum = weights.reduce((a, v) => a + v, 0) || 1;
    const parts = weights.map((w) => Math.round((total * w) / wSum));
    const top = weights.indexOf(Math.max(...weights));
    parts[top] += total - parts.reduce((a, v) => a + v, 0);
    return parts;
  };
  const spends = new Array<number>(campaignDefs.length).fill(0);
  for (const provider of ["meta_ads", "google_ads"] as const) {
    const idx = campaignDefs.flatMap((c, i) => (c.provider === provider ? [i] : []));
    split(platformSpend[provider], idx.map((i) => campaignDefs[i].weight)).forEach((v, k) => {
      spends[idx[k]] = v;
    });
  }

  // Google clicks cost about twice Meta's (search intent), like real
  // accounts; raw shares are normalised so all campaigns still add up to the
  // KPI total. The cost trend below is built around the same averages.
  const PLATFORM_CPC = { meta_ads: 0.72, google_ads: 1.55 } as const;
  const clicksBy = split(
    curClicks,
    campaignDefs.map((c, i) => (spends[i] * (0.9 + rand() * 0.2)) / PLATFORM_CPC[c.provider])
  );
  const convBy = split(curConv, spends);
  const campaigns: CampaignRow[] = campaignDefs.map((c, idx) => {
    const spend = spends[idx];
    const clicks = clicksBy[idx];
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
      conversions: convBy[idx],
      status: c.status,
      statusReason: en ? c.reasonEn : c.reasonPl,
      spark: idx % 4 === 3 ? spark.map((v, i) => Math.round(v * (1.1 - i * 0.05))) : spark,
    };
  });

  // Daily impressions add up to the campaigns' (clicks / their CTR), so the
  // CTR tile is the table's weighted CTR; a gentle wobble keeps its
  // sparkline from being a flat line.
  const curImpr = campaigns.reduce((a, c) => a + c.impressions, 0);
  split(
    curImpr,
    trend.map((p, i) => p.clicks * (1 + 0.06 * Math.sin(i * 1.3) + 0.03 * Math.cos(i * 0.7)))
  ).forEach((v, i) => {
    trend[i].impressions = v;
  });

  const ctrVal = curImpr > 0 ? (curClicks / curImpr) * 100 : 0;
  const cpcVal = curClicks > 0 ? Math.round(curSpend / curClicks) : 0;

  // Today is partial, so the % compares finished days only, per day - the
  // live tiles' rule (metrics.ts kpiRate / kpiRatio) and the chart's. The
  // previous totals are the ones buildDemoChartExtras draws as the dashed
  // line (demoPrevTotal), so tile and chart say the same "+11%".
  const done = trend.slice(0, -1);
  const doneSum = (f: (p: TrendPoint) => number) => done.reduce((a, p) => a + f(p), 0);
  const prev = {
    spend: demoPrevTotal(trend, (p) => p.spendMinorUnits, DEMO_PREV_CHANGE.spend),
    clicks: demoPrevTotal(trend, (p) => p.clicks, DEMO_PREV_CHANGE.clicks),
    sessions: demoPrevTotal(trend, (p) => p.sessions, DEMO_PREV_CHANGE.sessions),
    impressions: demoPrevTotal(trend, (p) => p.impressions, DEMO_PREV_CHANGE.impressions),
    conversions: demoPrevTotal(trend, (p) => p.conversions, DEMO_PREV_CHANGE.conversions),
  };
  const rateKpi = (value: number, previous: number, pick: (p: TrendPoint) => number): Kpi => {
    const prevRate = previous / trend.length;
    return {
      value,
      previous,
      deltaPercent: done.length > 0 && prevRate > 0 ? ((doneSum(pick) / done.length) / prevRate - 1) * 100 : null,
    };
  };
  const ratioKpi = (value: number, previous: number, doneValue: number): Kpi => ({
    value,
    previous,
    deltaPercent: previous > 0 ? ((doneValue - previous) / previous) * 100 : null,
  });
  const doneClicks = doneSum((p) => p.clicks);
  const doneImpr = doneSum((p) => p.impressions);

  const kpis: DashboardKpis = {
    spendMinorUnits: rateKpi(curSpend, prev.spend, (p) => p.spendMinorUnits),
    clicks: rateKpi(curClicks, prev.clicks, (p) => p.clicks),
    sessions: rateKpi(curSessions, prev.sessions, (p) => p.sessions),
    ctr: ratioKpi(
      Number(ctrVal.toFixed(2)),
      prev.impressions > 0 ? Number(((prev.clicks / prev.impressions) * 100).toFixed(2)) : 0,
      doneImpr > 0 ? (doneClicks / doneImpr) * 100 : 0
    ),
    cpcMinorUnits: ratioKpi(
      cpcVal,
      prev.clicks > 0 ? Math.round(prev.spend / prev.clicks) : 0,
      doneClicks > 0 ? doneSum((p) => p.spendMinorUnits) / doneClicks : 0
    ),
    conversions: rateKpi(curConv, prev.conversions, (p) => p.conversions),
  };

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
  // [pl, en, relative spend, CTR %, relative cost per click]. The ads split
  // the Meta campaigns' spend and clicks above, so Kreacje's "Twoja średnia"
  // cost per click is the Meta one on Reklamy (it used to say 0,38 zł next to
  // Meta's 0,73 zł, with ten ads adding up to 10 tys. zł of a 25 tys. zł
  // Meta spend). No thumbnails: random stock photos had nothing to do with a
  // veg shop, and the same ads have none on "Testy kreacji" either.
  const creativeDefs: Array<[string, string, number, number, number]> = [
    ["Skrzynka tygodnia - wideo 15 s", "Weekly box - 15s video", 184050, 2.6, 34],
    ["Co jest w skrzynce? - karuzela", "What's in the box? - carousel", 152300, 2.5, 36],
    ["Lokalne pomidory - grafika marki", "Local tomatoes - brand image", 141200, 0.9, 49],
    ["Opinie klientów - grafika", "Customer reviews - image", 118900, 3.2, 39],
    ["Rozpakowanie skrzynki - film klientki", "Box unboxing - customer video", 104500, 2.3, 32],
    ["Darmowa dostawa od 150 zł - grafika", "Free delivery over 150 zł - image", 96700, 1.3, 46],
    ["Pomidory malinowe z bliska - wideo 10 s", "Raspberry tomatoes close-up - 10s video", 81200, 1.2, 44],
    ["Prosto z krzaka - grafika", "Straight from the vine - image", 72400, 2.4, 34],
    ["Kapusta do kiszenia - karuzela", "Pickling cabbage - carousel", 61300, 2.0, 41],
    ["Passata jak u babci - wideo 20 s", "Grandma's passata - 20s video", 54900, 2.7, 30],
  ];
  const metaRows = campaigns.filter((c) => c.provider === "meta_ads");
  const adSpend = split(
    metaRows.reduce((a, c) => a + c.spendMinorUnits, 0),
    creativeDefs.map((c) => c[2])
  );
  const adClicks = split(
    metaRows.reduce((a, c) => a + c.clicks, 0),
    creativeDefs.map((c) => c[2] / c[4])
  );
  const creativesFull: CreativeItem[] = creativeDefs.map((c, i) => {
    const spend = adSpend[i];
    const clicks = adClicks[i];
    const ctr = c[3];
    return {
      adId: `demo-ad${i + 1}`,
      name: en ? c[1] : c[0],
      thumbnailUrl: null,
      spend,
      impressions: Math.round((clicks / ctr) * 100),
      clicks,
      ctr,
      cpc: clicks > 0 ? Math.round(spend / clicks) : null,
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
  // The shop's 30 days, read the way Sprzedaż reads them: the same devices,
  // pages and engagement rate (lib/demo/ecom.ts). Visits from ads stay below
  // the ad clicks they come from; the rest splits like the shop's channels.
  const S = curSessions;
  const paid = Math.min(Math.round(curClicks * 0.88), S);
  const [organic, direct, social, other] = split(S - paid, [0.19, 0.1, 0.06, 0.04]);
  const users = Math.round(S * 0.74);
  const website: WebsiteData = {
    hasData: true,
    // Sessions only here; sales per channel live on Sprzedaż.
    sources: [
      { category: "Paid", sessions: paid, revenueMinorUnits: 0, transactions: 0 },
      { category: "Organic", sessions: organic, revenueMinorUnits: 0, transactions: 0 },
      { category: "Direct", sessions: direct, revenueMinorUnits: 0, transactions: 0 },
      { category: "Social", sessions: social, revenueMinorUnits: 0, transactions: 0 },
      { category: "Referral/Inne", sessions: other, revenueMinorUnits: 0, transactions: 0 },
    ],
    devices: [
      { device: "mobile", sessions: Math.round(S * DEMO_DEVICE_SHARES.mobile) },
      { device: "desktop", sessions: Math.round(S * DEMO_DEVICE_SHARES.desktop) },
      { device: "tablet", sessions: Math.round(S * DEMO_DEVICE_SHARES.tablet) },
    ],
    topPages: demoTopPages(S),
    engagement: {
      engagementRate: DEMO_ENGAGEMENT_RATE,
      bounceRate: 100 - DEMO_ENGAGEMENT_RATE,
      avgDailySessions: Math.round(S / DAYS),
    },
    newVsReturning: { newUsers: Math.round(users * 0.62), returningUsers: Math.round(users * 0.38) },
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
  // One format in both languages: every other amount on the English demo
  // ("43 885 zł", "1 841 zł") keeps the Polish grouping, so "1,059 zł" in
  // an alert read as a different kind of number.
  const zl = formatPlnWhole;
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
    ...demoFlowAlerts(today, en),
    ...demoStreakAlert(today, en),
    { id: "a3", severity: "medium", scope: "client", scopeLabel: en ? "Whole account" : "Całe konto", metric: "ctr", direction: "up", changePct: 11, title: en ? "CTR rising: +11% vs normal" : "Klikalność rośnie: +11% względem normy", description: en ? "Engagement higher than usual this week." : "Zaangażowanie w tym tygodniu wyższe niż zwykle." },
    { id: "a4", severity: "high", scope: "campaign", scopeLabel: en ? "SEARCH | Veg delivery · Google" : "SEARCH | Warzywa z dostawą · Google", metric: "cpc", direction: "up", changePct: 24, title: en ? "CPC up 24% (7 days)" : "CPC wyższe o 24% (7 dni)", description: en ? "More grocery shops bid on the same searches, which pushes the cost per click up." : "Więcej sklepów spożywczych licytuje te same wyszukiwania, co podbija koszt kliknięcia." },
    { id: "a5", severity: "medium", scope: "campaign", scopeLabel: en ? "SALES | Veg boxes · Meta" : "SPRZEDAŻ | Skrzynki warzyw · Meta", metric: "ctr", direction: "up", changePct: 18, title: en ? "CTR rising: +18%" : "Klikalność rośnie: +18%", description: en ? "The new customer unboxing video clearly beats the average." : "Nowy film klientki rozpakowującej skrzynkę działa wyraźnie lepiej niż średnia." },
    { id: "a6", severity: "medium", scope: "client", scopeLabel: en ? "Whole account" : "Całe konto", metric: "sessions", direction: "up", changePct: 9, title: en ? "Paid sessions +9%" : "Więcej wizyt z reklam: +9%", description: en ? "Campaign traffic growth feeds GA4 sessions." : "Wzrost ruchu z kampanii przekłada się na więcej wizyt na stronie." },
  ];

  // --- Budget ---------------------------------------------------------------
  const dayOfMonth = Number(todayStr.slice(8, 10));
  const [yy, mm] = todayStr.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  // Month-to-date spend from the same trend the KPI cards and chart use (the
  // real card sums ads_daily the same way); an invented figure didn't match
  // the chart's own daily spend for this month. The budget is the shop's
  // planned month rounded to 5 000 zł, so pace stays "ok" in any month (a
  // fixed 50 000 zł ran out before December's end).
  const budgetMinor = Math.max(500_000, Math.round(demoMonthSpend(todayStr) / 500_000) * 500_000);
  const monthStart = `${todayStr.slice(0, 7)}-01`;
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
    month: monthStart,
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
