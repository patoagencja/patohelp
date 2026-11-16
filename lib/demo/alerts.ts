import { getTimezoneOffset } from "date-fns-tz";

import { scanChangeAnomalies, type Anomaly } from "@/lib/alerts/anomalies";
import { buildFlowAlert, clockLabel, localClock, type FlowAlert, type FlowIncident } from "@/lib/alerts/data-flow";
import { ecomAnomaliesFromDays, type EcomDay } from "@/lib/alerts/ecom";
import { buildStreakAlert, mergeStreak, streakWindowStart, type DayTotals } from "@/lib/alerts/streaks";
import { campaignName, type DemoLang } from "@/lib/demo/dashboard";
import { addDaysIso } from "@/lib/demo/profile/anonymize";
import { TODAY_PARTIAL, type DemoSource } from "@/lib/demo/source";
import { formatNumberPL } from "@/lib/utils";

// The demo's alerts, by the production rules on the demo's own days: the
// 3-days-vs-14 checks (scanChangeAnomalies), the shop's sales checks, the
// weekday streaks, and the same-day data-flow guards. Every number in every
// card comes from the same days the other pages show; whether a card shows
// at all depends on those days, like for a live client. One list feeds the
// overview, the bell and Alerty.

const RANK = { critical: 0, high: 1, medium: 2 } as const;

const EN_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const enList = (items: string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
const pct = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n)}%`;

const SCOPE_EN: Record<string, string> = {
  "Całe konto": "Whole account",
  "Ruch na stronie": "Website traffic",
  Sklep: "Shop",
};
const METRIC_EN: Record<string, string> = {
  CPC: "CPC",
  CTR: "CTR",
  Kliknięcia: "Clicks",
  Wydatki: "Spend",
  Sesje: "Sessions",
  Zamówienia: "Orders",
  Konwersja: "Conversion",
  Przychód: "Revenue",
};
const STREAK_EN: Record<string, string> = {
  sales: "sales",
  orders: "orders",
  purchases: "purchases from ads",
  cr: "the shop's conversion rate",
  cpa: "the cost of a purchase from ads",
  sessions: "site visits",
  clicks: "clicks",
  ctr: "the click-through rate",
  cpc: "the cost per click",
};

/** "rose to X (usually: Y)" -> [X, Y] from the Polish card. */
const fromTo = (description: string) => /do (.+?) \(zwykle: (.+?)\)/.exec(description)?.slice(1) ?? ["", ""];

function english(a: Anomaly, names: Map<string, string>): Anomaly {
  const id = a.id;
  const scopeLabel = a.scope === "campaign" ? names.get(id.replace(/^camp-(.+)-(clicks|cpc|ctr)$/, "$1")) ?? a.scopeLabel : SCOPE_EN[a.scopeLabel] ?? a.scopeLabel;
  const base = { ...a, scopeLabel, metric: METRIC_EN[a.metric] ?? a.metric };
  const [x, y] = fromTo(a.description);
  if (id.endsWith("-cpc") || id === "client-cpc-up")
    return { ...base, title: `Cost per click up ${pct(a.changePct)}`, description: `The average cost per click rose to ${x} (usually: ${y}).` };
  if (id.endsWith("-ctr") || id === "client-ctr-down")
    return { ...base, title: `Click-through rate down ${pct(a.changePct)}`, description: `CTR fell to ${x} (usually: ${y}).` };
  if (id === "client-clicks-down")
    return { ...base, title: `Clicks down ${pct(a.changePct)}`, description: "Daily clicks fell against the last 2 weeks." };
  if (id.endsWith("-clicks"))
    return { ...base, title: `Clicks down ${pct(a.changePct)}`, description: "The campaign still spends, but its daily clicks fell sharply against the last 2 weeks." };
  if (id === "client-spend")
    return {
      ...base,
      title: `Spend ${a.direction === "up" ? "spike" : "drop"} ${pct(a.changePct)}`,
      description: `Daily spend ${a.direction === "up" ? "rose" : "fell"} against the last 2 weeks.`,
    };
  if (id === "client-sessions-down")
    return { ...base, title: `Traffic down ${pct(a.changePct)}`, description: "Daily site visits clearly fell against the last 2 weeks." };
  if (id === "ecom-zero-orders")
    return { ...base, title: "Zero orders yesterday with normal traffic", description: "Visitors came but nobody bought. Check the cart, the payment gateway and the GA4 purchase tag." };
  if (id === "ecom-conversion-drop")
    return { ...base, title: `Shop conversion ${pct(a.changePct)}`, description: "The last 2 days brought far fewer orders than the usual conversion rate would give. Traffic is there, people don't buy: check the checkout, prices and stock." };
  if (id === "ecom-revenue-drop")
    return { ...base, title: `Revenue down ${pct(a.changePct)}`, description: "Daily revenue over the last 3 days is clearly below the 4-week average." };
  return base;
}

/** Same-day data-flow guards (lib/alerts/data-flow.ts), with today's own numbers. */
function demoFlowAlerts(src: DemoSource, now: Date, en: boolean): Anomaly[] {
  const today = src.today;
  const now0 = src.day(today);
  const full = src.fullDay(today);
  if (!now0 || !full) return [];
  const offset = Math.round(getTimezoneOffset("Europe/Warsaw", now) / 60_000);
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
  const local = (iso: string) => localClock(iso, offset);
  const fromHour = Math.max(0, local(now.toISOString()).hour - 3);
  const lastPushAt = ago(4 * 60 + 20);

  // Daytime hours carry ~1.3x the day's hourly average.
  const perHour = (v: number) => (v / 24) * 1.3;
  const carts = Math.max(8, Math.round(perHour(full.sessions) * 3 * 0.045));
  const checkouts = Math.max(3, Math.round(carts * 0.38));
  const expected = Math.max(2, Math.round(perHour(full.orders) * 3 * 10) / 10);
  const usualHalfHour = Math.max(4, Math.round(perHour(full.sessions) / 2));
  const lastHourClicks = Math.max(10, Math.round(perHour(full.clicks)));

  // Meta clicks so far today vs the same weekday over the last 4 weeks.
  const sameWeekday = [7, 14, 21, 28].map((k) => src.day(addDaysIso(today, -k))).filter((d) => d !== undefined);
  const usualMetaClicks = sameWeekday.length
    ? Math.round((sameWeekday.reduce((a, d) => a + d.meta.clicks, 0) / sameWeekday.length) * TODAY_PARTIAL)
    : now0.meta.clicks;
  let metaClicks28 = 0;
  let metaConv28 = 0;
  for (let k = 1; k <= 28; k++) {
    const d = src.day(addDaysIso(today, -k));
    if (!d) continue;
    metaClicks28 += d.meta.clicks;
    metaConv28 += d.meta.conversions;
  }
  const pixelExpected = metaClicks28 > 0 ? Math.round(((now0.meta.clicks * metaConv28) / metaClicks28) * 10) / 10 : 0;

  const incident = (guard: FlowIncident["guard"], startedMinAgo: number, severity: FlowIncident["severity"], facts: FlowIncident["facts"]): FlowIncident => ({
    id: `demo-flow-${guard}`,
    guard,
    since: ago(startedMinAgo),
    startedAt: ago(startedMinAgo),
    lastSeen: ago(10),
    severity,
    facts,
  });
  const incidents: FlowIncident[] = [
    incident("checkout", 40, "critical", { guard: "checkout", hint: "payment", fromHour, hours: 3, carts, checkouts, expected, orders: null }),
    incident("ga4", 65, "high", { guard: "ga4", users: 1, events: 6, usual: usualHalfHour, clicks: lastHourClicks, minutes: 60 }),
    incident("meta-pixel", 70, "high", {
      guard: "meta-pixel",
      clicks: now0.meta.clicks,
      usualClicks: usualMetaClicks,
      purchases: 0,
      expected: pixelExpected,
      shopPurchases: now0.orders,
      source: "shop",
    }),
    incident("shop-feed", 40, "high", { guard: "shop-feed", lastPushAt, ageMin: 260, usualGapMin: 60 }),
  ];
  const pl = incidents.map((inc) => buildFlowAlert(inc, true, offset)).filter((a): a is FlowAlert => a !== null);
  const ga4From = clockLabel(Math.floor(Math.max(0, local(ago(65)).mod - 30) / 5) * 5);
  const pushAt = clockLabel(local(lastPushAt).mod);
  const n = (v: number) => formatNumberPL(Math.round(v));
  const english: Record<string, Pick<Anomaly, "scopeLabel" | "metric" | "title" | "description" | "why" | "action"> & { label: string }> = {
    checkout: {
      scopeLabel: "Shop",
      metric: "Cart and payments",
      title: "Cart or payments may be broken",
      description: `${fromHour === 0 ? "Nobody has bought today" : `Nobody has bought since ${fromHour}:00`}, although there were ${n(carts)} add-to-carts and ${n(checkouts)} checkouts started. With this traffic there would usually be about ${n(expected)} purchases by now.`,
      why: "People want to buy, but something stops them — every hour without purchases is lost sales.",
      action: `Check payments — customers reach the checkout, but nobody has paid ${fromHour === 0 ? "since the morning" : "for 3 hours"}.`,
      label: fromHour === 0 ? "today" : `since ${fromHour}:00`,
    },
    ga4: {
      scopeLabel: "Website traffic · GA4",
      metric: "Analytics",
      title: "Analytics data isn't coming in",
      description: `Since about ${ga4From}, Google Analytics sees only 1 person on the site per half hour, usually about ${n(usualHalfHour)} at this time. The ads brought ${n(lastHourClicks)} clicks in the last hour.`,
      why: "Without Analytics data you can't see what happens in the shop, and the campaigns lose the signal of who buys. If the site itself went down, every hour means lost orders.",
      action: "Check that the Google tag (gtag/GTM) is on the site — ad traffic is coming, but Analytics sees nothing. Also check that the site opens at all.",
      label: `since about ${ga4From}`,
    },
    "meta-pixel": {
      scopeLabel: "Sales tracking · Meta",
      metric: "Meta pixel",
      title: "Meta pixel isn't counting purchases",
      description: `Meta shows no purchase from ads today, although the ads brought ${n(now0.meta.clicks)} clicks (usually about ${n(usualMetaClicks)} by this time). With this traffic Meta usually counts about ${n(pixelExpected)} purchases by now, and the shop has ${n(now0.orders)} orders today.`,
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

/** Every alert the demo shop has right now, most urgent first. */
export function getDemoAlerts(src: DemoSource, lang: DemoLang = "pl", now = new Date()): Anomaly[] {
  const en = lang === "en";
  const today = src.today;
  const yesterday = addDaysIso(today, -1);
  const readStart = streakWindowStart(today);

  // ads_daily- and ga4_daily-shaped rows of the demo's days.
  const rows: Array<Record<string, unknown>> = [];
  const ga4Rows: Array<Record<string, unknown>> = [];
  const sales = new Map<string, EcomDay>();
  const extra: Record<string, DayTotals> = {};
  for (let d = readStart; d <= yesterday; d = addDaysIso(d, 1)) {
    const day = src.day(d);
    if (!day) continue;
    for (const c of src.campaigns) {
      const a = src.campaignDay(c.id, d);
      if (!a) continue;
      rows.push({ campaign_id: c.id, campaign_name: c.namePl, date: d, spend_minor_units: a.spend, clicks: a.clicks, impressions: a.impressions });
    }
    if (day.hasSite) ga4Rows.push({ date: d, sessions: day.sessions });
    if (day.hasSales) {
      sales.set(d, { sessions: day.sessions, transactions: day.orders, revenue: day.revenue });
      extra[d] = { purchases: day.conversions, orders: day.orders, sales: day.revenue };
    }
  }

  const { anomalies, streakDays } = scanChangeAnomalies(rows, ga4Rows, today);
  anomalies.push(...ecomAnomaliesFromDays(sales, today));

  let out: Anomaly[] = anomalies;
  for (const [date, e] of Object.entries(extra)) streakDays[date] = { ...streakDays[date], ...e };
  const streak = buildStreakAlert({ today, shop: true, days: streakDays });
  if (streak) {
    const merged = mergeStreak(anomalies, streak);
    out = merged.alerts;
    const dates = Array.from({ length: streak.days }, (_, k) => addDaysIso(streak.end, -(streak.days - 1 - k)));
    const names = dates.map((d) => EN_WEEKDAYS[new Date(`${d}T12:00:00Z`).getUTCDay()]);
    const down = streak.direction === "down";
    out.push({
      id: streak.id,
      severity: merged.severity ?? streak.severity,
      scope: "client",
      scopeLabel: en ? SCOPE_EN[streak.scopeLabel] ?? streak.scopeLabel : streak.scopeLabel,
      metric: en ? STREAK_EN[streak.metric] ?? streak.label : streak.label,
      direction: streak.direction,
      changePct: streak.changePct,
      title: en
        ? `For ${streak.days} days, ${STREAK_EN[streak.metric]} ${down ? "below" : "above"} a usual ${enList(names)} by ${Math.round(Math.abs(streak.changePct))}%`
        : streak.title,
      description: en
        ? `${enList(names)}: each day clearly ${down ? "below" : "above"} the same weekday over the previous 4 weeks.`
        : streak.description,
      why: en ? "Not a one-off: each day was clearly off the same weekday over the previous 4 weeks." : streak.why,
      action: en ? "We are looking at what changed on those days." : streak.action,
      streak: { start: streak.start, end: streak.end, days: streak.days },
    });
  }

  out.push(...demoFlowAlerts(src, now, en));
  const names = new Map(src.campaigns.map((c) => [c.id, campaignName(c, "en")]));
  return out
    .map((a) => (en && !a.intraday ? english(a, names) : a))
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 25);
}
