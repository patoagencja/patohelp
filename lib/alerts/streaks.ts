// Streak alerts: "Od 2 dni zakupów z reklam jest o 35% mniej niż zwykle we
// wtorki i środy". Pure and import-free (no "@/", no date library): the unit
// tests run this file directly under Node's type stripping. The reads live in
// lib/alerts/streak-sources.ts; detectAnomalies (lib/alerts/anomalies.ts)
// puts the result next to the older 3-days-vs-14 checks.
//
// The method, plainly:
// - Only FULL days are judged: today is partial and is never looked at.
// - A day's usual value is the same weekday over the previous 4 weeks (d-7,
//   d-14, d-21, d-28), so a quiet Sunday is compared with other Sundays and
//   never reads as a slump. Of those 4 weeks the highest and the lowest are
//   dropped and the middle two averaged (the median): one Black Friday, long
//   weekend or promo in the baseline would otherwise lift the "usual" level
//   for a month and make every normal week after it look like a drop. At
//   least 3 of the 4 weeks must have data.
// - A day is "clearly off" when it misses its usual value by STREAK_TOLERANCE
//   (30%) AND by more than the ordinary day-to-day wobble of its volume:
//   counts behave roughly like Poisson, whose relative spread is 1/sqrt(n),
//   so the miss must also be >= NOISE_Z / sqrt(usual count). At 200 clicks a
//   day the 30% rule decides; at 10 orders a day only a fall to 3 or fewer
//   counts - which is exactly when 10 -> 7 is not news.
// - A streak is the run of clearly-off days ending yesterday, at least
//   MIN_STREAK_DAYS long. One bad day is never an alert.
// - Every metric also needs a minimum usual volume (MIN_DAILY_*), the same
//   idea as MIN_CAMPAIGN_SPEND in anomalies.ts: small numbers swing wildly.
// - Missing data is not zero: a day without rows (sync gap, shop that did not
//   report) ends the streak instead of counting as a drop.
// - One card per client: every metric with a streak is found (for dedup with
//   the older alerts), the card leads with the most important one and names
//   the others. The hint comes from the OTHER metrics on the same days.

export type StreakMetric =
  | "sales"
  | "orders"
  | "purchases"
  | "cr"
  | "cpa"
  | "sessions"
  | "clicks"
  | "ctr"
  | "cpc";

export type StreakSeverity = "critical" | "high" | "medium";

/** Account totals of one day. A missing field = no data for it that day. */
export interface DayTotals {
  /** Ad spend, grosze (ads_daily, every campaign). */
  spend?: number | null;
  clicks?: number | null;
  impressions?: number | null;
  /** Purchases the ad platforms attribute to the ads. */
  purchases?: number | null;
  /** GA4 sessions, whole site. */
  sessions?: number | null;
  /** The shop's orders (shop_sales_daily, else GA4 transactions). */
  orders?: number | null;
  /** The shop's sales, grosze. */
  sales?: number | null;
}

export interface StreakInput {
  /** Today in Warsaw, "yyyy-MM-dd". Excluded: it is a partial day. */
  today: string;
  /**
   * client_type 'ecommerce'. Shops are judged on sales metrics; everyone
   * else on traffic only and never reads a sales word (CLAUDE.md).
   */
  shop: boolean;
  /** Totals per date. */
  days: Readonly<Record<string, DayTotals>>;
}

// ---- thresholds -------------------------------------------------------------

/** Shortest streak: one bad day is noise, two in a row is a pattern. */
export const MIN_STREAK_DAYS = 2;
/**
 * Longest streak looked for. A week covers every weekday once, and it keeps
 * each judged day's baseline (the 4 weeks before it) free of the streak's
 * own days - a longer scan would compare the slump with itself.
 */
export const MAX_STREAK_DAYS = 7;
/** Weeks of the same weekday that make the usual value. */
export const BASELINE_WEEKS = 4;
/** A weekday with fewer weeks of data (new client, sync gap) isn't judged. */
export const MIN_BASELINE_WEEKS = 3;
/** Days of history the detection needs before today: scan + baseline. */
export const STREAK_WINDOW_DAYS = MAX_STREAK_DAYS + 7 * BASELINE_WEEKS;
/**
 * How far off each day must be. 30% is about the most a normal week swings
 * against the same weekday of recent weeks on a healthy account; below that
 * the alert would describe ordinary weather, not something to fix.
 */
export const STREAK_TOLERANCE = 0.3;
/** The miss must also exceed NOISE_Z Poisson standard deviations. */
export const NOISE_Z = 2;
/**
 * Meta and Google keep attributing purchases to the last day or two for days
 * afterwards, so yesterday's ad purchases read low (and its cost per
 * purchase high) even when nothing is wrong. That newest day must clear the
 * tolerance by this much more.
 */
export const LATE_ATTRIBUTION_ALLOWANCE = 0.15;
/** "The other metrics moved" for the hint: a smaller bar than the alert's. */
export const HINT_TOLERANCE = 0.2;
/** Sales-side streaks this deep are urgent: money is lost every hour. */
export const CRITICAL_DROP = 0.5;
/** Other streaks become "Ważne" this deep or this long. */
export const HIGH_CHANGE = 0.5;
export const HIGH_DAYS = 3;

// Minimum usual volume per day. Same idea as MIN_CAMPAIGN_SPEND in
// anomalies.ts: tiny numbers swing by half on their own.
/** 50 zł of spend a day (grosze), like MIN_CAMPAIGN_SPEND. */
export const MIN_DAILY_SPEND = 5_000;
export const MIN_DAILY_CLICKS = 30;
export const MIN_DAILY_IMPRESSIONS = 1_000;
export const MIN_DAILY_VISITS = 30;
/** Conversion rate needs enough visits for "orders per visit" to mean much. */
export const MIN_DAILY_VISITS_FOR_CR = 100;
export const MIN_DAILY_ORDERS = 5;
export const MIN_DAILY_PURCHASES = 5;
/** 500 zł of sales a day (grosze). */
export const MIN_DAILY_SALES = 50_000;

/** Prefix of every streak alert id (= notifications_sent alert_key). */
export const STREAK_ID_PREFIX = "streak-";

// ---- dates ----------------------------------------------------------------

/** "2026-11-07" + n days, UTC arithmetic (month and year ends included). */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday. */
function weekday(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/** First day the detection reads (today minus STREAK_WINDOW_DAYS). */
export function streakWindowStart(today: string): string {
  return addDaysIso(today, -STREAK_WINDOW_DAYS);
}

// ---- metrics ----------------------------------------------------------------

type Field = keyof DayTotals;

const num = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const ratio = (a: number | null | undefined, b: number | null | undefined): number | null => {
  const x = num(a);
  const y = num(b);
  return x !== null && y !== null && y > 0 ? x / y : null;
};

interface MetricDef {
  /** Which way is bad news. */
  bad: "down" | "up";
  /** How the numbers read: summed counts / money, or averaged rates. */
  kind: "count" | "money" | "rate" | "cost";
  value: (d: DayTotals) => number | null;
  /** The count behind the day-to-day noise. */
  noise: Field;
  /** Minimum usual value per field before a day is judged. */
  min: Partial<Record<Field, number>>;
  /** Ad-attributed: the newest day is still filling in. */
  late?: boolean;
}

const METRICS: Record<StreakMetric, MetricDef> = {
  sales: {
    bad: "down",
    kind: "money",
    value: (d) => num(d.sales),
    noise: "orders",
    min: { sales: MIN_DAILY_SALES, orders: MIN_DAILY_ORDERS },
  },
  orders: {
    bad: "down",
    kind: "count",
    value: (d) => num(d.orders),
    noise: "orders",
    min: { orders: MIN_DAILY_ORDERS },
  },
  purchases: {
    bad: "down",
    kind: "count",
    value: (d) => num(d.purchases),
    noise: "purchases",
    min: { purchases: MIN_DAILY_PURCHASES },
    late: true,
  },
  cr: {
    bad: "down",
    kind: "rate",
    value: (d) => ratio(d.orders, d.sessions),
    noise: "orders",
    min: { orders: MIN_DAILY_ORDERS, sessions: MIN_DAILY_VISITS_FOR_CR },
  },
  cpa: {
    bad: "up",
    kind: "cost",
    value: (d) => ratio(d.spend, d.purchases),
    noise: "purchases",
    min: { purchases: MIN_DAILY_PURCHASES, spend: MIN_DAILY_SPEND },
    late: true,
  },
  sessions: {
    bad: "down",
    kind: "count",
    value: (d) => num(d.sessions),
    noise: "sessions",
    min: { sessions: MIN_DAILY_VISITS },
  },
  clicks: {
    bad: "down",
    kind: "count",
    value: (d) => num(d.clicks),
    noise: "clicks",
    min: { clicks: MIN_DAILY_CLICKS },
  },
  ctr: {
    bad: "down",
    kind: "rate",
    value: (d) => ratio(d.clicks, d.impressions),
    noise: "clicks",
    min: { clicks: MIN_DAILY_CLICKS, impressions: MIN_DAILY_IMPRESSIONS },
  },
  cpc: {
    bad: "up",
    kind: "cost",
    value: (d) => ratio(d.spend, d.clicks),
    noise: "clicks",
    min: { clicks: MIN_DAILY_CLICKS, spend: MIN_DAILY_SPEND },
  },
};

/**
 * The metrics judged per client type, most important first: the card leads
 * with the first one that has a streak. Shops: the shop's own sales, then
 * what the ads sell, then efficiency. Engagement: visits on the site (the
 * outcome), then what the ads deliver, then their cost.
 */
export const SHOP_METRICS: readonly StreakMetric[] = ["sales", "orders", "purchases", "cr", "cpa"];
export const ENGAGEMENT_METRICS: readonly StreakMetric[] = ["sessions", "clicks", "ctr", "cpc"];

/** Old 3-days-vs-14 alert ids (anomalies.ts / ecom.ts) a streak stands in for. */
export const SUPERSEDES: Readonly<Record<StreakMetric, readonly string[]>> = {
  sales: ["ecom-revenue-drop"],
  orders: ["ecom-zero-orders"],
  purchases: [],
  cr: ["ecom-conversion-drop"],
  cpa: [],
  sessions: ["client-sessions-down"],
  clicks: ["client-clicks-down"],
  ctr: ["client-ctr-down"],
  cpc: ["client-cpc-up"],
};

// ---- baseline and judgement -------------------------------------------------

const EMPTY: DayTotals = {};

/** Median of the weeks: the middle two of 4 averaged, the middle of 3. */
function typical(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Usual value of `date`: the same weekday over the previous 4 weeks. */
export function usualValue(
  days: Readonly<Record<string, DayTotals>>,
  date: string,
  value: (d: DayTotals) => number | null
): number | null {
  const weeks: number[] = [];
  for (let w = 1; w <= BASELINE_WEEKS; w++) {
    const v = value(days[addDaysIso(date, -7 * w)] ?? EMPTY);
    if (v !== null) weeks.push(v);
  }
  return weeks.length >= MIN_BASELINE_WEEKS ? typical(weeks) : null;
}

export interface JudgedDay {
  date: string;
  actual: number;
  usual: number;
  /** Signed, e.g. -0.35. */
  change: number;
  /** Clearly off in the bad direction. */
  bad: boolean;
}

/** One metric on one day, or null when it can't be judged (no data, too small). */
export function judgeDay(
  input: StreakInput,
  metric: StreakMetric,
  date: string
): JudgedDay | null {
  const def = METRICS[metric];
  const actual = def.value(input.days[date] ?? EMPTY);
  if (actual === null) return null;
  const usual = usualValue(input.days, date, def.value);
  if (usual === null || usual <= 0) return null;
  for (const [field, min] of Object.entries(def.min) as Array<[Field, number]>) {
    const u = usualValue(input.days, date, (d) => num(d[field]));
    if (u === null || u < min) return null;
  }
  const events = usualValue(input.days, date, (d) => num(d[def.noise]));
  if (events === null || events <= 0) return null;

  const change = actual / usual - 1;
  const off = def.bad === "down" ? -change : change;
  const newest = date === addDaysIso(input.today, -1);
  const tolerance = STREAK_TOLERANCE + (def.late && newest ? LATE_ATTRIBUTION_ALLOWANCE : 0);
  const bad = off >= tolerance && off >= NOISE_Z / Math.sqrt(events);
  return { date, actual, usual, change, bad };
}

export interface Streak {
  metric: StreakMetric;
  direction: "up" | "down";
  /** The streak's days, oldest first; the last one is yesterday. */
  dates: string[];
  start: string;
  end: string;
  days: number;
  /** Ran through the whole scan: it may be longer than MAX_STREAK_DAYS. */
  capped: boolean;
  /** Signed change over the streak: sum(actual) / sum(usual) - 1. */
  change: number;
  /** Summed over the days (counts, money) or averaged (rates, costs). */
  actual: number;
  usual: number;
  daily: JudgedDay[];
}

/** Every metric of the client's type with a streak, most important first. */
export function findStreaks(input: StreakInput): Streak[] {
  const yesterday = addDaysIso(input.today, -1);
  const out: Streak[] = [];
  for (const metric of input.shop ? SHOP_METRICS : ENGAGEMENT_METRICS) {
    const def = METRICS[metric];
    const run: JudgedDay[] = [];
    for (let i = 0; i < MAX_STREAK_DAYS; i++) {
      const day = judgeDay(input, metric, addDaysIso(yesterday, -i));
      if (!day || !day.bad) break;
      run.push(day);
    }
    if (run.length < MIN_STREAK_DAYS) continue;
    run.reverse();
    const sumActual = run.reduce((a, d) => a + d.actual, 0);
    const sumUsual = run.reduce((a, d) => a + d.usual, 0);
    const summed = def.kind === "count" || def.kind === "money";
    out.push({
      metric,
      direction: def.bad,
      dates: run.map((d) => d.date),
      start: run[0].date,
      end: run[run.length - 1].date,
      days: run.length,
      capped: run.length === MAX_STREAK_DAYS,
      change: sumActual / sumUsual - 1,
      actual: summed ? sumActual : sumActual / run.length,
      usual: summed ? sumUsual : sumUsual / run.length,
      daily: run,
    });
  }
  return out;
}

// ---- hint -------------------------------------------------------------------

export type StreakHint =
  | "spend-down"
  | "traffic-down"
  | "site"
  | "traffic-up"
  | "ads-weaker"
  | "spend-up"
  | "costlier"
  | "unclear";

/** How the other metrics moved over the streak's days (signed; null = unknown). */
export interface HintContext {
  spend: number | null;
  clicks: number | null;
  sessions: number | null;
  purchases: number | null;
  ctr: number | null;
}

/** sum(actual) / sum(usual) - 1 over `dates`, null without data or volume. */
function moved(
  input: StreakInput,
  dates: readonly string[],
  value: (d: DayTotals) => number | null,
  minPerDay = 0
): number | null {
  let actual = 0;
  let usual = 0;
  for (const date of dates) {
    const a = value(input.days[date] ?? EMPTY);
    const u = usualValue(input.days, date, value);
    if (a === null || u === null) return null;
    actual += a;
    usual += u;
  }
  if (usual <= 0 || usual / dates.length < minPerDay) return null;
  return actual / usual - 1;
}

export function hintContext(input: StreakInput, dates: readonly string[]): HintContext {
  return {
    spend: moved(input, dates, (d) => num(d.spend), MIN_DAILY_SPEND),
    clicks: moved(input, dates, (d) => num(d.clicks), MIN_DAILY_CLICKS),
    sessions: moved(input, dates, (d) => num(d.sessions), MIN_DAILY_VISITS),
    purchases: moved(input, dates, (d) => num(d.purchases), MIN_DAILY_PURCHASES),
    ctr: moved(input, dates, (d) => ratio(d.clicks, d.impressions)),
  };
}

/**
 * Where to look, from the other metrics on the same days. Order matters: a
 * smaller budget explains fewer clicks, visits and sales, so it is checked
 * first; less traffic explains fewer sales; only when traffic held up is the
 * website (or the cart) the suspect.
 */
export function chooseHint(metric: StreakMetric, c: HintContext): StreakHint {
  const down = (v: number | null) => v !== null && v <= -HINT_TOLERANCE;
  const up = (v: number | null) => v !== null && v >= HINT_TOLERANCE;
  const trafficKnown = c.clicks !== null || c.sessions !== null;
  const trafficDown = down(c.clicks) || down(c.sessions);
  switch (metric) {
    case "sales":
    case "orders":
    case "purchases":
      if (down(c.spend)) return "spend-down";
      if (trafficDown) return "traffic-down";
      if (up(c.sessions)) return "traffic-up";
      return trafficKnown ? "site" : "unclear";
    case "cr":
      // Orders per visit: the visits are known (they're half the rate).
      return up(c.sessions) || (c.sessions === null && up(c.clicks)) ? "traffic-up" : "site";
    case "cpa":
      if (up(c.spend)) return "spend-up";
      if (down(c.purchases)) return trafficDown ? "traffic-down" : trafficKnown ? "site" : "unclear";
      return "costlier";
    case "sessions":
      if (down(c.spend)) return "spend-down";
      if (down(c.clicks)) return "traffic-down";
      return c.clicks !== null ? "site" : "unclear";
    case "clicks":
      return down(c.spend) ? "spend-down" : "ads-weaker";
    case "ctr":
      return "ads-weaker";
    case "cpc":
      if (up(c.spend)) return "spend-up";
      if (down(c.ctr)) return "ads-weaker";
      return "costlier";
  }
}

const HINTS: Record<StreakHint, { shop: string; engagement: string }> = {
  "spend-down": {
    shop: "Wydajemy mniej — sprawdzamy budżet albo zatrzymaną kampanię.",
    engagement: "Wydajemy mniej — sprawdzamy budżet albo zatrzymaną kampanię.",
  },
  "traffic-down": {
    shop: "Mniej ruchu z reklam — sprawdzamy kampanie.",
    engagement: "Mniej ruchu z reklam — sprawdzamy kampanie.",
  },
  site: {
    shop: "Ruch bez zmian, a zakupów mniej — sprawdźmy stronę i koszyk.",
    engagement:
      "Kliknięć w reklamy tyle co zwykle, a wizyt na stronie mniej — sprawdzamy stronę i pomiar ruchu.",
  },
  "traffic-up": {
    shop: "Ruchu jest więcej, ale rzadziej kończy się zakupem — sprawdzamy stronę, koszyk i to, skąd przychodzą nowe wizyty.",
    engagement: "Ruchu jest więcej niż zwykle — sprawdzamy, skąd przychodzą nowe wizyty.",
  },
  "ads-weaker": {
    shop: "Reklamy przyciągają mniej kliknięć niż zwykle — sprawdzamy kreacje, odbiorców i stawki.",
    engagement: "Reklamy przyciągają mniej kliknięć niż zwykle — sprawdzamy kreacje, odbiorców i stawki.",
  },
  "spend-up": {
    shop: "Wydajemy więcej, a zakupów nie przybywa — sprawdzamy, które kampanie dostały większy budżet.",
    engagement: "Wydajemy więcej, a kliknięć nie przybywa — sprawdzamy, które kampanie dostały większy budżet.",
  },
  costlier: {
    shop: "Zakupy z reklam drożeją przy podobnym budżecie — sprawdzamy kampanie i stawki.",
    engagement: "Kliknięcia drożeją przy podobnym budżecie — sprawdzamy konkurencję w aukcjach i kreacje.",
  },
  unclear: {
    shop: "Sprawdzamy reklamy, stronę i koszyk, żeby znaleźć przyczynę.",
    engagement: "Sprawdzamy reklamy, stronę i pomiar ruchu, żeby znaleźć przyczynę.",
  },
};

export function hintText(hint: StreakHint, shop: boolean): string {
  return HINTS[hint][shop ? "shop" : "engagement"];
}

// ---- Polish wording ---------------------------------------------------------

/** 1 zamówienie, 2-4 zamówienia (but 12-14 zamówień), 5+ zamówień. */
export function plPlural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.round(n));
  if (abs === 1) return one;
  const last = abs % 10;
  const lastTwo = abs % 100;
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return few;
  return many;
}

// Index = getUTCDay() (0 = Sunday).
/** "w niedziele" - every such day (title). */
const WEEKDAYS_PLURAL = ["niedziele", "poniedziałki", "wtorki", "środy", "czwartki", "piątki", "soboty"];
/** "w niedzielę" - that one day (description). */
const WEEKDAYS_ONE = ["niedzielę", "poniedziałek", "wtorek", "środę", "czwartek", "piątek", "sobotę"];

/** "we wtorki", "w środy": "we" before a w-cluster. */
const prep = (word: string) => (/^w[^aeiouyąęó]/i.test(word) ? "we" : "w");

/** "a", "a i b", "a, b i c". */
function joinPl(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} i ${items[items.length - 1]}`;
}

/** " we wtorki i środy" / " w te dni tygodnia" / "" (a whole week). */
export function weekdaysPhrase(dates: readonly string[]): string {
  if (dates.length >= 7) return "";
  if (dates.length >= 4) return " w te dni tygodnia";
  const names = dates.map((d) => WEEKDAYS_PLURAL[weekday(d)]);
  return ` ${prep(names[0])} ${joinPl(names)}`;
}

/** "We wtorek i środę" / "W ostatnich 5 dniach" / "W ostatnim tygodniu". */
export function whenPhrase(dates: readonly string[]): string {
  if (dates.length >= 7) return "W ostatnim tygodniu";
  if (dates.length >= 4) return `W ostatnich ${dates.length} dniach`;
  const names = dates.map((d) => WEEKDAYS_ONE[weekday(d)]);
  const p = prep(names[0]);
  return `${p[0].toUpperCase()}${p.slice(1)} ${joinPl(names)}`;
}

/** Thousands grouped with a non-breaking space ("12 400"), like lib/utils. */
function groupThousands(n: number): string {
  const r = Math.round(n);
  return `${r < 0 ? "-" : ""}${String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")}`;
}

/** Whole złote from grosze: "12 400 zł". */
function zl(grosze: number): string {
  return `${groupThousands(grosze / 100)} zł`;
}

/** Złote with grosze, for small unit costs: "1,85 zł". */
function zl2(grosze: number): string {
  const r = Math.round(grosze);
  const whole = groupThousands(Math.floor(Math.abs(r) / 100));
  return `${r < 0 ? "-" : ""}${whole},${String(Math.abs(r) % 100).padStart(2, "0")} zł`;
}

/** A rate as a percent with a Polish comma: 0.0192 -> "1,92%". */
function pct(rate: number): string {
  return `${(rate * 100).toFixed(2).replace(".", ",")}%`;
}

const signedPct = (change: number) =>
  `${change < 0 ? "-" : "+"}${Math.round(Math.abs(change) * 100)}%`;

interface Copy {
  /** Anomaly.metric (matches the older alerts' labels). */
  label: string;
  /** How another streak is named inside this card ("także: ..."). */
  inline: string;
  scope: string;
  /** "zamówień jest o 35% mniej" */
  subject: (p: number) => string;
  /** "24 zamówienia, a zwykle w te dni ok. 37" */
  numbers: (actual: number, usual: number) => string;
  why: string;
}

const COPY: Record<StreakMetric, Copy> = {
  sales: {
    label: "Sprzedaż",
    inline: "sprzedaż",
    scope: "Sklep",
    subject: (p) => `sprzedaż jest o ${p}% niższa`,
    numbers: (a, u) => `${zl(a)} sprzedaży, a zwykle w te dni ok. ${zl(u)}`,
    why: "Każdy taki dzień to mniej pieniędzy ze sklepu.",
  },
  orders: {
    label: "Zamówienia",
    inline: "zamówienia",
    scope: "Sklep",
    subject: (p) => `zamówień jest o ${p}% mniej`,
    numbers: (a, u) =>
      `${groupThousands(a)} ${plPlural(a, "zamówienie", "zamówienia", "zamówień")}, a zwykle w te dni ok. ${groupThousands(u)}`,
    why: "Mniej zamówień przy podobnych wydatkach na reklamy to droższa sprzedaż.",
  },
  purchases: {
    label: "Zakupy z reklam",
    inline: "zakupy z reklam",
    scope: "Całe konto",
    subject: (p) => `zakupów z reklam jest o ${p}% mniej`,
    numbers: (a, u) =>
      `${groupThousands(a)} ${plPlural(a, "zakup", "zakupy", "zakupów")} z reklam, a zwykle w te dni ok. ${groupThousands(u)}`,
    why: "Reklamy przyprowadzają mniej kupujących - każdy zakup z reklam robi się droższy.",
  },
  cr: {
    label: "Konwersja",
    inline: "konwersja sklepu",
    scope: "Sklep",
    subject: (p) => `konwersja sklepu jest o ${p}% niższa`,
    numbers: (a, u) => `zamówieniem kończyło się średnio ${pct(a)} wizyt, a zwykle w te dni ${pct(u)}`,
    why: "Z tego samego ruchu jest mniej zamówień - pieniądze na reklamy pracują słabiej.",
  },
  cpa: {
    label: "Koszt zakupu",
    inline: "koszt zakupu z reklam",
    scope: "Całe konto",
    subject: (p) => `zakup z reklam kosztuje o ${p}% więcej`,
    numbers: (a, u) => `zakup z reklam kosztował średnio ${zl(a)}, a zwykle w te dni ok. ${zl(u)}`,
    why: "Za każdy zakup z reklam płacimy więcej - z tego samego budżetu jest mniej sprzedaży.",
  },
  sessions: {
    label: "Sesje",
    inline: "wizyty na stronie",
    scope: "Ruch na stronie",
    subject: (p) => `wizyt na stronie jest o ${p}% mniej`,
    numbers: (a, u) =>
      `${groupThousands(a)} ${plPlural(a, "wizyta", "wizyty", "wizyt")} na stronie, a zwykle w te dni ok. ${groupThousands(u)}`,
    why: "Mniej osób ogląda ofertę - to może przełożyć się na mniej zapytań.",
  },
  clicks: {
    label: "Kliknięcia",
    inline: "kliknięcia w reklamy",
    scope: "Całe konto",
    subject: (p) => `kliknięć w reklamy jest o ${p}% mniej`,
    numbers: (a, u) =>
      `${groupThousands(a)} ${plPlural(a, "kliknięcie", "kliknięcia", "kliknięć")} w reklamy, a zwykle w te dni ok. ${groupThousands(u)}`,
    why: "Mniej kliknięć to mniej osób, które trafiają z reklam na stronę.",
  },
  ctr: {
    label: "CTR",
    inline: "klikalność reklam",
    scope: "Całe konto",
    subject: (p) => `klikalność reklam jest o ${p}% niższa`,
    numbers: (a, u) => `kliknięciem kończyło się średnio ${pct(a)} wyświetleń reklam, a zwykle w te dni ${pct(u)}`,
    why: "Reklamy słabiej przyciągają uwagę - z tych samych wyświetleń jest mniej kliknięć.",
  },
  cpc: {
    label: "CPC",
    inline: "koszt kliknięcia",
    scope: "Całe konto",
    subject: (p) => `kliknięcie w reklamę kosztuje o ${p}% więcej`,
    numbers: (a, u) => `kliknięcie kosztowało średnio ${zl2(a)}, a zwykle w te dni ${zl2(u)}`,
    why: "Za ten sam budżet dostajemy mniej kliknięć - czyli mniej osób trafia na stronę.",
  },
};

const METHOD =
  "To nie jeden słabszy dzień: każdy z nich wypadł wyraźnie gorzej niż ten sam dzień tygodnia w poprzednich 4 tygodniach.";

/** "Od 2 dni zamówień jest o 35% mniej niż zwykle we wtorki i środy". */
export function streakTitle(s: Pick<Streak, "metric" | "dates" | "change" | "capped">): string {
  const lead = s.capped || s.dates.length >= 7 ? "Od tygodnia" : `Od ${s.dates.length} dni`;
  const p = Math.round(Math.abs(s.change) * 100);
  return `${lead} ${COPY[s.metric].subject(p)} niż zwykle${weekdaysPhrase(s.dates)}`;
}

// ---- the alert --------------------------------------------------------------

export interface StreakAlert {
  /** "streak-<metric>-<first day>": the same for every day the streak lasts. */
  id: string;
  metric: StreakMetric;
  label: string;
  scopeLabel: string;
  severity: StreakSeverity;
  direction: "up" | "down";
  /** Signed percent, e.g. -35.2. */
  changePct: number;
  title: string;
  /** The numbers: what happened on those days against the usual. */
  description: string;
  /** "Dlaczego to ważne". */
  why: string;
  /** "Co z tym robimy": the hint. */
  action: string;
  hint: StreakHint;
  start: string;
  end: string;
  days: number;
  /** Every metric with a streak on these days (the card leads with one). */
  covered: StreakMetric[];
}

const SALES_SIDE: ReadonlySet<StreakMetric> = new Set<StreakMetric>(["sales", "orders", "purchases", "cr"]);

/**
 * Pilne only for a shop's sales falling by half or more - money lost every
 * hour, like the zero-orders alert. Engagement metrics top out at Ważne:
 * the older anomalies never page anyone at night over clicks either.
 */
export function streakSeverity(s: Pick<Streak, "metric" | "change" | "days">): StreakSeverity {
  if (SALES_SIDE.has(s.metric)) return s.change <= -CRITICAL_DROP ? "critical" : "high";
  return Math.abs(s.change) >= HIGH_CHANGE || s.days >= HIGH_DAYS ? "high" : "medium";
}

/** The client's streak card, or null when no metric has a streak. */
export function buildStreakAlert(input: StreakInput): StreakAlert | null {
  const streaks = findStreaks(input);
  if (streaks.length === 0) return null;
  const lead = streaks[0];
  const copy = COPY[lead.metric];
  const hint = chooseHint(lead.metric, hintContext(input, lead.dates));
  const others = streaks.slice(1);
  const also = others.length
    ? ` W tych samych dniach także: ${others.map((s) => `${COPY[s.metric].inline} ${signedPct(s.change)}`).join(", ")}.`
    : "";
  return {
    id: `${STREAK_ID_PREFIX}${lead.metric}-${lead.start}`,
    metric: lead.metric,
    label: copy.label,
    scopeLabel: copy.scope,
    severity: streakSeverity(lead),
    direction: lead.direction,
    changePct: lead.change * 100,
    title: streakTitle(lead),
    description: `${whenPhrase(lead.dates)}: ${copy.numbers(lead.actual, lead.usual)}.${also}`,
    why: `${copy.why} ${METHOD}`,
    action: hintText(hint, input.shop),
    hint,
    start: lead.start,
    end: lead.end,
    days: lead.days,
    covered: streaks.map((s) => s.metric),
  };
}

// ---- next to the older alerts -------------------------------------------------

const RANK: Record<StreakSeverity, number> = { critical: 0, high: 1, medium: 2 };

/**
 * Drop the older 3-days-vs-14 alerts the streak covers (same metric - the
 * streak says it better: which days, against which weekdays) and hand back
 * the streak's severity, raised to the most urgent alert it replaced so a
 * Pilne zero-orders alert never turns into a quieter card.
 */
export function mergeStreak<T extends { id: string; severity: StreakSeverity }>(
  alerts: readonly T[],
  streak: Pick<StreakAlert, "covered" | "severity"> | null
): { alerts: T[]; severity: StreakSeverity | null } {
  if (!streak) return { alerts: [...alerts], severity: null };
  const replaced = new Set(streak.covered.flatMap((m) => SUPERSEDES[m]));
  let severity = streak.severity;
  const kept: T[] = [];
  for (const a of alerts) {
    if (!replaced.has(a.id)) {
      kept.push(a);
      continue;
    }
    if (RANK[a.severity] < RANK[severity]) severity = a.severity;
  }
  return { alerts: kept, severity };
}
