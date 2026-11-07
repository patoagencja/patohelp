// "Dziś" (the phone-first Today view): the morning brief, the same-weekday
// baseline it compares against, and the picking / ordering of what the view
// shows. Pure and import-free: the unit tests run it directly under Node's
// type stripping. Money is minor units (grosze), dates are Warsaw
// "yyyy-MM-dd" calendar days.

/**
 * Which figures the brief speaks in. Shops: sales and orders. Everyone else
 * (engagement clients, or a shop whose sales aren't tracked yet): ad clicks,
 * or site visits when no ads ran - never revenue words.
 */
export type BriefKind = "sales" | "clicks" | "visits";

/** Where the brief's numbers come from (one plain line under it). */
export type BriefSource = "shop" | "ga4" | "ads";

export interface BriefDay {
  date: string;
  /** sales: revenue (grosze); clicks: ad clicks; visits: sessions. null = nothing reported that day. */
  primary: number | null;
  /** sales: orders; clicks: site visits; visits: unused. null = not known. */
  secondary: number | null;
}

/** How many earlier same weekdays make "usual" (Thursday vs the 4 Thursdays before). */
export const BASELINE_WEEKS = 4;
/** Fewer weeks with data than this: no comparison at all, rather than a shaky one. */
export const MIN_BASELINE_WEEKS = 2;
/**
 * Up to this many percent either way (as the sentence would round it) the
 * day reads "tyle, ile zwykle": "o 4% więcej" next to a "better" chip
 * would make noise sound like news.
 */
export const FLAT_PCT = 5;

const isFlat = (change: number) => Math.round(Math.abs(change) * 100) <= FLAT_PCT;

// ---------------------------------------------------------------- dates

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday (calendar day, no time zone involved). */
export function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/** Every day from start to end inclusive. */
export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

// ------------------------------------------------------------- Polish words

const NBSP = " ";
const WEEKDAY = ["niedziela", "poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota"];
/** "zwykle w czwartki" - the plural after "w", "we wtorki". */
const ON_WEEKDAYS = ["w niedziele", "w poniedziałki", "we wtorki", "w środy", "w czwartki", "w piątki", "w soboty"];
const MONTH_GEN = [
  "stycznia",
  "lutego",
  "marca",
  "kwietnia",
  "maja",
  "czerwca",
  "lipca",
  "sierpnia",
  "września",
  "października",
  "listopada",
  "grudnia",
];

/** Polish plural: 1 kliknięcie, 2 kliknięcia, 5 kliknięć (same rule as lib/dashboard/story plPlural). */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.round(n));
  if (abs === 1) return one;
  const last = abs % 10;
  const lastTwo = abs % 100;
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return few;
  return many;
}

/** "12 400" with non-breaking spaces (as formatNumberPL), so a figure never wraps. */
export function groupNumber(n: number): string {
  const r = Math.round(n);
  return `${r < 0 ? "-" : ""}${String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)}`;
}

/** Whole złoty from grosze: "12 400 zł" (as formatPlnWhole). */
export function zl(minor: number): string {
  return `${groupNumber(minor / 100)}${NBSP}zł`;
}

/** "Sobota, 7 listopada". */
export function dateLine(iso: string): string {
  const day = WEEKDAY[weekdayOf(iso)];
  return `${day.charAt(0).toUpperCase()}${day.slice(1)}, ${Number(iso.slice(8, 10))} ${MONTH_GEN[Number(iso.slice(5, 7)) - 1]}`;
}

/** "Dzień dobry" until the evening, "Dobry wieczór" from 18:00 (and past midnight). */
export function greeting(hour: number): string {
  return hour >= 18 || hour < 4 ? "Dobry wieczór" : "Dzień dobry";
}

/** "2 razy", "2,5 raza" (a fraction takes the genitive). */
function times(ratio: number): string {
  const v = Math.round(ratio * 10) / 10;
  return Number.isInteger(v) ? `${v} razy` : `${String(v).replace(".", ",")} raza`;
}

// ---------------------------------------------------------- daily series

/** The dashboard's per-day totals (lib/dashboard/metrics TrendPoint), structurally. */
export interface TrendDay {
  date: string;
  revenueMinorUnits: number;
  transactions: number;
  clicks: number;
  sessions: number;
}

/** The shop's own sales per day (lib/shop/sales ShopSales.days), structurally. */
export interface ShopDay {
  date: string;
  revenue: number;
  orders: number;
}

/**
 * Zero-filled daily totals -> brief days. Days before the first day with a
 * figure are "no data yet", not zero: a shop connected three weeks ago would
 * otherwise get a Thursday baseline of zeros and read "o 300% więcej".
 */
export function daysFromTrend(
  trend: readonly TrendDay[],
  primary: (d: TrendDay) => number,
  secondary: ((d: TrendDay) => number) | null
): BriefDay[] {
  const first = trend.findIndex((d) => primary(d) > 0);
  return trend.map((d, i) =>
    first < 0 || i < first
      ? { date: d.date, primary: null, secondary: null }
      : { date: d.date, primary: primary(d), secondary: secondary ? secondary(d) : null }
  );
}

/** The shop's own days over [start, end]; a date the shop didn't send stays null. */
export function daysFromShop(days: readonly ShopDay[], start: string, end: string): BriefDay[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  return eachDay(start, end).map((date) => {
    const d = byDate.get(date);
    return d ? { date, primary: d.revenue, secondary: d.orders } : { date, primary: null, secondary: null };
  });
}

/**
 * What the brief is about. Shops: the shop's own sales when it sends them
 * (its system is the truth - and a seasonal shop may have no GA4 revenue at
 * all), unless its last upload stopped short of yesterday while GA4 has the
 * days since; else GA4 purchases. A shop with neither yet, and every
 * engagement client, gets ad clicks (+ site visits), or visits alone
 * without ads. null = nothing synced at all.
 */
export function pickBriefSource(input: {
  isShop: boolean;
  trend: readonly TrendDay[];
  /** null = not read (engagement) or the shop sales table doesn't exist. */
  shopDays: readonly ShopDay[] | null;
  start: string;
  /** Today: the window's last day. */
  end: string;
}): { kind: BriefKind; source: BriefSource; days: BriefDay[] } | null {
  const { isShop, trend, shopDays, start, end } = input;
  if (isShop) {
    const own = (shopDays ?? []).filter((d) => d.date >= start && d.date <= end);
    const ga4Sales = trend.some((d) => d.revenueMinorUnits > 0 || d.transactions > 0);
    // A shop uploading a CSV now and then: a two-week-old file must not hide
    // yesterday's GA4 sales behind "the shop hasn't sent yesterday yet".
    const ownIsCurrent = own.some((d) => d.date >= addDays(end, -1));
    if (own.length > 0 && (ownIsCurrent || !ga4Sales)) {
      return { kind: "sales", source: "shop", days: daysFromShop(own, start, end) };
    }
    if (ga4Sales) {
      return {
        kind: "sales",
        source: "ga4",
        days: daysFromTrend(trend, (d) => d.revenueMinorUnits, (d) => d.transactions),
      };
    }
  }
  const hasSessions = trend.some((d) => d.sessions > 0);
  if (trend.some((d) => d.clicks > 0)) {
    return {
      kind: "clicks",
      source: "ads",
      days: daysFromTrend(trend, (d) => d.clicks, hasSessions ? (d) => d.sessions : null),
    };
  }
  if (hasSessions) return { kind: "visits", source: "ga4", days: daysFromTrend(trend, (d) => d.sessions, null) };
  return null;
}

// ------------------------------------------------------- weekday baseline

export interface WeekdayBaseline {
  /** Average over the same weekdays that had data. */
  primary: number;
  secondary: number | null;
  /** How many of the BASELINE_WEEKS weekdays had data. */
  weeks: number;
}

/**
 * "Usual" for `date`: the average of the same weekday over the previous
 * `weeks` weeks (date-7, date-14, ...), counting only days with data. Shops
 * sell differently on a Monday and a Saturday, so "yesterday vs the day
 * before" would cry wolf every weekend. null with fewer than
 * MIN_BASELINE_WEEKS such days.
 */
export function weekdayBaseline(
  days: readonly BriefDay[],
  date: string,
  weeks = BASELINE_WEEKS
): WeekdayBaseline | null {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const hits: BriefDay[] = [];
  for (let k = 1; k <= weeks; k++) {
    const d = byDate.get(addDays(date, -7 * k));
    if (d && d.primary !== null) hits.push(d);
  }
  if (hits.length < MIN_BASELINE_WEEKS) return null;
  const withSecondary = hits.filter((d) => d.secondary !== null);
  return {
    primary: hits.reduce((a, d) => a + (d.primary ?? 0), 0) / hits.length,
    secondary:
      withSecondary.length > 0
        ? withSecondary.reduce((a, d) => a + (d.secondary ?? 0), 0) / withSecondary.length
        : null,
    weeks: hits.length,
  };
}

// ------------------------------------------------------------- the brief

/** A sentence piece; `hl` pieces are the figures, set in the foreground ink. */
export type BriefPart = string | { hl: string };

export interface Brief {
  greeting: string;
  /** "Sobota, 7 listopada". */
  dateLine: string;
  /** Yesterday against the usual same weekday - the one sentence to read. */
  lead: BriefPart[];
  /** Today so far, when today has numbers yet. */
  todayLine: BriefPart[] | null;
  /** Yesterday vs the weekday baseline (0.18 = +18%); null = not compared. */
  change: number | null;
  tone: "up" | "down" | "flat" | null;
  /** lead + todayLine as plain text (screen readers, tests). */
  text: string;
}

const plain = (parts: readonly BriefPart[]) => parts.map((p) => (typeof p === "string" ? p : p.hl)).join("");

function primaryFigure(kind: BriefKind, v: number): string {
  if (kind === "sales") return zl(v);
  if (kind === "clicks") return `${groupNumber(v)} ${plural(v, "kliknięcie", "kliknięcia", "kliknięć")}`;
  return `${groupNumber(v)} ${plural(v, "wizyta", "wizyty", "wizyt")}`;
}

/** "z 31 zamówień" - after "z" the genitive: 1 zamówienia, otherwise zamówień. */
function fromOrders(n: number): string {
  return `${groupNumber(n)} ${Math.round(n) === 1 ? "zamówienia" : "zamówień"}`;
}

function comparison(change: number, weekday: number): BriefPart[] {
  const on = ON_WEEKDAYS[weekday];
  if (isFlat(change)) return [" - ", { hl: "tyle, ile zwykle" }, ` ${on}.`];
  if (change >= 1) return [" - ", { hl: `${times(change + 1)} więcej` }, ` niż zwykle ${on}.`];
  const pct = Math.round(Math.abs(change) * 100);
  return [" - ", { hl: `o ${pct}% ${change > 0 ? "więcej" : "mniej"}` }, ` niż zwykle ${on}.`];
}

/** Yesterday's sentence (and the comparison behind it). */
function leadFor(
  kind: BriefKind,
  source: BriefSource,
  yesterday: BriefDay | undefined,
  base: WeekdayBaseline | null,
  weekday: number
): { parts: BriefPart[]; change: number | null } {
  const on = ON_WEEKDAYS[weekday];
  const usual: BriefPart[] =
    base && base.primary > 0 ? [` Zwykle ${on} to ok. `, { hl: primaryFigure(kind, base.primary) }, "."] : [];
  const y = yesterday?.primary ?? null;

  if (y === null) {
    // A shop that sends its own sales simply hasn't sent yesterday yet; for
    // the synced sources the day isn't in yet.
    const head =
      source === "shop" ? "Sklep nie przesłał jeszcze sprzedaży za wczoraj." : "Za wczoraj nie mamy jeszcze danych.";
    return { parts: [head, ...usual], change: null };
  }
  if (y === 0) {
    // Zero can be a late sync as much as a dead day: say what we see, not why.
    const what = kind === "sales" ? "sprzedaży" : kind === "clicks" ? "kliknięć w reklamy" : "wizyt na stronie";
    return { parts: [`Za wczoraj nie widzimy jeszcze ${what}.`, ...usual], change: null };
  }

  const change = base && base.primary > 0 ? y / base.primary - 1 : null;
  const tail: BriefPart[] = change === null ? ["."] : comparison(change, weekday);
  const sec = yesterday?.secondary ?? null;

  if (kind === "sales") {
    const orders: BriefPart[] = sec !== null && sec > 0 ? [" z ", { hl: fromOrders(sec) }] : [];
    return { parts: ["Wczoraj ", { hl: zl(y) }, " sprzedaży", ...orders, ...tail], change };
  }
  if (kind === "clicks") {
    // Visits get their own short sentence: after "kliknięć ... i 2 310 wizyt"
    // the "o 8% więcej" would read as being about the visits.
    const visits: BriefPart[] =
      sec !== null && sec > 0 ? [" Na stronie ", { hl: primaryFigure("visits", sec) }, "."] : [];
    return { parts: ["Wczoraj ", { hl: primaryFigure("clicks", y) }, " w reklamy", ...tail, ...visits], change };
  }
  return { parts: ["Wczoraj ", { hl: primaryFigure("visits", y) }, " na stronie", ...tail], change };
}

/** Today so far - no comparison: a few synced hours against whole days would always read as a slump. */
function todayFor(kind: BriefKind, today: BriefDay | undefined): BriefPart[] | null {
  const v = today?.primary ?? null;
  if (v === null || v <= 0) return null;
  const sec = today?.secondary ?? null;
  if (kind === "sales") {
    return ["Dziś do tej pory ", { hl: zl(v) }, ...(sec !== null && sec > 0 ? [" z ", { hl: fromOrders(sec) }] : []), "."];
  }
  return ["Dziś do tej pory ", { hl: primaryFigure(kind, v) }, "."];
}

/**
 * The morning brief: a greeting, then yesterday against the usual same
 * weekday ("Wczoraj 12 400 zł sprzedaży z 31 zamówień - o 18% więcej niż
 * zwykle w czwartki.") and today so far when today has numbers. `picked`
 * null (nothing synced yet) gives a calm "first numbers soon" line.
 */
export function buildBrief(input: {
  picked: { kind: BriefKind; source: BriefSource; days: BriefDay[] } | null;
  today: string;
  /** Warsaw hour 0-23, for the greeting. */
  hour: number;
}): Brief {
  const { picked, today, hour } = input;
  const head = { greeting: greeting(hour), dateLine: dateLine(today) };
  if (!picked) {
    const lead: BriefPart[] = ["Pierwsze liczby pojawią się tu po pierwszej synchronizacji danych."];
    return { ...head, lead, todayLine: null, change: null, tone: null, text: plain(lead) };
  }
  const yesterdayIso = addDays(today, -1);
  const byDate = new Map(picked.days.map((d) => [d.date, d]));
  const base = weekdayBaseline(picked.days, yesterdayIso);
  const { parts, change } = leadFor(picked.kind, picked.source, byDate.get(yesterdayIso), base, weekdayOf(yesterdayIso));
  const todayLine = todayFor(picked.kind, byDate.get(today));
  const tone = change === null ? null : isFlat(change) ? "flat" : change > 0 ? "up" : "down";
  return {
    ...head,
    lead: parts,
    todayLine,
    change,
    tone,
    text: [plain(parts), todayLine ? plain(todayLine) : ""].filter(Boolean).join(" "),
  };
}

// ------------------------------------------------------ picking the lists

/**
 * "Na co uważać": the alerts that need a look (Pilne, then Ważne - the
 * header bell's rule), at most `max`, in the order given within a level;
 * `rest` says how many more wait on Alerty.
 */
export function pickAttention<T extends { severity: string }>(
  alerts: readonly T[],
  max = 3
): { shown: T[]; rest: number } {
  const worth = alerts.filter((a) => a.severity === "critical" || a.severity === "high");
  const ordered = [
    ...worth.filter((a) => a.severity === "critical"),
    ...worth.filter((a) => a.severity === "high"),
  ];
  return { shown: ordered.slice(0, max), rest: Math.max(0, ordered.length - max) };
}

/** Where a "Co dziś robimy" action comes from. */
export type ActionSource = "goal" | "test" | "budget";

/**
 * Priority when slots are short: a goal at risk has a deadline that won't
 * move, a creative test proposal has sales at stake every day it waits, and
 * the season budget's "today" is guidance for the day.
 */
export const ACTION_PRIORITY: readonly ActionSource[] = ["goal", "test", "budget"];

/**
 * "Co dziś robimy": up to `max` actions, one of each kind first (in
 * ACTION_PRIORITY), then the next of each kind again - so three test
 * proposals never push the one goal at risk off a phone screen. Each list
 * comes already ordered by its own urgency.
 */
export function pickActions<T>(
  lists: Partial<Record<ActionSource, readonly T[]>>,
  max = 3
): Array<{ source: ActionSource; item: T }> {
  const out: Array<{ source: ActionSource; item: T }> = [];
  for (let round = 0; out.length < max; round++) {
    let added = false;
    for (const source of ACTION_PRIORITY) {
      const item = lists[source]?.[round];
      if (item === undefined) continue;
      added = true;
      out.push({ source, item });
      if (out.length >= max) break;
    }
    if (!added) break;
  }
  return out;
}

/** The item with the highest positive value (ties keep the first); null when none is above zero. */
export function topBy<T>(items: readonly T[], value: (t: T) => number): T | null {
  let best: T | null = null;
  let bestValue = 0;
  for (const it of items) {
    const v = value(it);
    if (v > bestValue) {
      best = it;
      bestValue = v;
    }
  }
  return best;
}
