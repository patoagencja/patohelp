// Intraday data-flow guards ("Strażnik sklepu"): same-day checks that
// something on the client's side broke - the GA4 tag (or the site), the cart
// or payments, the Meta pixel, the shop's sales feed - hours before a daily
// total or a multi-day streak (streaks.ts) could show it. Pure and
// import-free (no "@/", no date library): the unit tests run this file
// directly under Node's type stripping. The reads and the GA4 calls live in
// lib/alerts/data-flow-check.ts, run by the refresh-ga4 cron (no cron of its
// own - Vercel usage is tight); detectAnomalies shows what is open
// (lib/alerts/data-flow-read.ts), and notify-alerts e-mails it once.
//
// The method, plainly:
// - One check per refresh-ga4 run (every 30 min), only 7:00-22:59 Warsaw:
//   nobody is paged at night, and night traffic is too thin to judge.
// - Every guard answers bad / ok / unknown. "unknown" (too little volume, no
//   baseline yet, a failed read, stale data) never raises anything.
// - An incident opens after 2 bad checks in a row and closes on the first ok
//   check (the data flows again). One nobody re-confirms (reads failing,
//   night) fades after OPEN_TTL_MIN. Re-opened within REOPEN_WINDOW_MIN it
//   keeps its id, so the client gets one e-mail, not one per flap.
// - Counts are judged like Poisson counts: "0 when ~5 were expected" is a
//   ~0.7% fluke on one check, and it has to happen on two checks in a row.
// - "Usual" always means this client at this time of day: realtime visitors
//   per hour (learned check by check, weekdays apart from weekends), GA4
//   e-commerce per hour on the same weekday of the last 4 weeks, Meta clicks
//   and purchases on the same weekday of the last 4 weeks.

export type FlowGuard = "ga4" | "checkout" | "meta-pixel" | "shop-feed";
export const FLOW_GUARDS: readonly FlowGuard[] = ["ga4", "checkout", "meta-pixel", "shop-feed"];

export type FlowSeverity = "critical" | "high";

/** report_cache key of the guards' state (sync-state prefixes it with "sync:"). */
export const FLOW_STATE_KEY = "data-flow";

// ---- thresholds -------------------------------------------------------------

/** Checks run 7:00-22:59 Warsaw. */
export const GUARD_FIRST_HOUR = 7;
export const GUARD_LAST_HOUR = 22;
/**
 * A check closer than this to the previous one is skipped: the "Odśwież"
 * button runs refresh-ga4 too, and two checks a minute apart are not two
 * independent looks (nor worth two more GA4 calls).
 */
export const MIN_CHECK_GAP_MIN = 20;
/** Previous check older than this (runs skipped): nothing "in a row" with it. */
export const MAX_CHECK_GAP_MIN = 75;
/** Bad checks in a row before an incident opens. */
export const CONFIRM_CHECKS = 2;
/** An open incident nobody re-confirmed is no longer shown after this. */
export const OPEN_TTL_MIN = 75;
/** Back within this after clearing = the same incident (same id, no new e-mail). */
export const REOPEN_WINDOW_MIN = 180;
/** Today's cumulative readings kept (ad clicks, shop orders): 16 h of checks. */
export const READINGS_KEEP = 34;

// GA4 ("Nie spływają dane z Analytics")
/** Realtime samples kept per (Mon-Fri | Sat-Sun, hour): about a week. */
export const RT_BASE_WEEKDAY_DAYS = 5;
export const RT_BASE_WEEKEND_DAYS = 4;
/** Learned samples needed before they replace the heatmap estimate. */
export const RT_MIN_SAMPLES = 3;
/**
 * Realtime users in a 30-minute window per GA4 session in that hour (the
 * heatmap estimate, before samples are learned). About half; 0.4 errs low,
 * which only makes the guard stricter.
 */
export const RT_PER_HOURLY_SESSION = 0.4;
/** Hours that usually see fewer realtime visitors are not judged. */
export const MIN_USUAL_RT_USERS = 5;
/** "~0": at most this share of the usual (0 below 10 usual visitors). */
export const NEAR_ZERO_SHARE = 0.1;
/** Ad clicks "flowing": compared with a reading at least this old. */
export const FLOW_WINDOW_MIN = 50;
/** Clicks the ads must add over that window, and since the previous check. */
export const MIN_FLOW_CLICKS = 10;
export const MIN_FLOW_STEP = 3;
/** Pilne only when nothing at all arrives against a clear usual and real ad traffic. */
export const CONFIDENT_RT_USERS = 8;
export const CONFIDENT_FLOW_CLICKS = 20;

// Checkout ("Koszyk/płatności mogą nie działać")
/** Complete hours in a row without a purchase before the cart is suspected. */
export const MIN_SILENT_HOURS = 3;
/** Add-to-carts in those hours: shoppers are really there. */
export const MIN_SPAN_CARTS = 5;
/** The same hours of the same weekday usually bring at least this many purchases. */
export const MIN_SPAN_USUAL_PURCHASES = 3;
/** Purchases today's carts would usually turn into. */
export const MIN_EXPECTED_PURCHASES = 5;
export const CONFIDENT_EXPECTED_PURCHASES = 8;
/** begin_checkout events that make "they reach the checkout" a fact. */
export const MIN_SPAN_CHECKOUTS = 3;
/** Same weekdays the hourly baseline reads (d-7 ... d-28), and the minimum with data. */
export const CART_BASE_WEEKS = 4;
export const MIN_CART_BASE_WEEKS = 3;
/** Shop orders that arrived during the silent hours: the shop sells, GA4 misses it. */
export const SHOP_ORDERS_STILL_FLOWING = 2;

// Meta pixel ("Piksel Meta nie liczy")
/** Not judged before noon: too few clicks yet, and Meta reports purchases late. */
export const META_FIRST_HOUR = 12;
/** Meta's numbers must come from a sync at most this old. */
export const META_FRESH_MIN = 90;
/**
 * Share of a day's final Meta purchases already reported on the day itself:
 * Meta books a purchase on the click's day for days afterwards, and the
 * history it is compared with is fully counted.
 */
export const META_SAME_DAY_SHARE = 0.5;
/** Today's Meta clicks at least this share of the usual by this hour. */
export const META_CLICKS_NORMAL = 0.6;
export const MIN_META_CLICKS = 50;
export const MIN_EXPECTED_META_PURCHASES = 6;
export const CONFIDENT_EXPECTED_META = 12;
/** "Far below": at most this share of the expected purchases. */
export const META_FAR_BELOW = 0.15;
/** The shop itself (GA4 or its own orders) sold at least this much today. */
export const MIN_SHOP_PURCHASES_TODAY = 5;

// Shop feed ("Zamówienia przestały spływać")
/** Observed pushes kept: the last 4 days. */
export const FEED_KEEP_DAYS = 4;
export const FEED_KEEP_MAX = 200;
export const FEED_MIN_PUSHES = 6;
/** A feed pushing less often than this is not hourly - not judged. */
export const FEED_MAX_USUAL_GAP_MIN = 180;
/** Stale after max(3 h, 3x the usual gap) ... */
export const FEED_STALE_MIN = 180;
export const FEED_STALE_FACTOR = 3;
/**
 * ... when on 2 of the previous 3 days it did push at this time of day. This
 * also retires a feed dead for 2+ days (switched off, or long known): those
 * days have no pushes, so it stops being judged after a second day's e-mail.
 */
export const FEED_REGULAR_DAYS = 2;
export const FEED_CRITICAL_MIN = 360;

// ---- clock -----------------------------------------------------------------

export interface LocalClock {
  /** Warsaw day, "yyyy-MM-dd". */
  day: string;
  hour: number;
  minute: number;
  /** Minute of the Warsaw day, 0..1439. */
  mod: number;
  /** 0 = Sunday ... 6 = Saturday. */
  weekday: number;
}

/** Warsaw wall clock of an instant, given Warsaw's UTC offset (60 / 120). */
export function localClock(iso: string, utcOffsetMin: number): LocalClock {
  const t = new Date(Date.parse(iso) + utcOffsetMin * 60_000);
  const hour = t.getUTCHours();
  const minute = t.getUTCMinutes();
  return {
    day: t.toISOString().slice(0, 10),
    hour,
    minute,
    mod: hour * 60 + minute,
    weekday: t.getUTCDay(),
  };
}

/** Minutes from `from` to `to` (negative when `to` is earlier). */
export function minutesBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 60_000;
}

/** "2026-11-07" + n days, UTC arithmetic. */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const inGuardHours = (hour: number): boolean => hour >= GUARD_FIRST_HOUR && hour <= GUARD_LAST_HOUR;

/** "9:05" from a minute of the day. */
export function clockLabel(mod: number): string {
  const m = Math.max(0, Math.min(1439, Math.round(mod)));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// ---- state ------------------------------------------------------------------

/** [minute of the Warsaw day, cumulative count so far today], oldest first. */
export type Reading = [number, number];

/** "wd-14" / "we-14" -> [[day, realtime users], ...], oldest first. */
export type RealtimeBaseline = Record<string, Array<[string, number]>>;

export interface HourEcom {
  /** All events (only "did GA4 process this hour"). */
  events: number;
  /** add_to_cart */
  carts: number;
  /** begin_checkout */
  checkouts: number;
  /** purchase */
  purchases: number;
}

/** One GA4 dateHour row (several properties are summed by the caller or here). */
export interface EcomHourRow extends HourEcom {
  date: string;
  hour: number;
}

/** [events, carts, checkouts, purchases] per hour 0..23 of one past day. */
export type EcomDay = Array<[number, number, number, number]>;

export interface CartBaseline {
  /** Warsaw day it was built for (rebuilt daily: the weekday changes). */
  day: string;
  /** The same weekday 1..4 weeks back - only days GA4 had rows for. */
  days: EcomDay[];
}

export interface MetaDay {
  clicks: number;
  /** null: some row of the day had no purchase count. */
  purchases: number | null;
}

export interface MetaBaseline {
  day: string;
  /** The same weekday 1..4 weeks back that had Meta rows. */
  days: MetaDay[];
}

export interface Ga4Facts {
  guard: "ga4";
  /** Realtime visitors / events in the last 30 minutes. */
  users: number;
  events: number;
  /** Usual realtime visitors at this hour. */
  usual: number;
  /** Ad clicks added over `minutes`. */
  clicks: number;
  minutes: number;
}

export type CheckoutHint = "payment" | "cart" | "both" | "tracking";

export interface CheckoutFacts {
  guard: "checkout";
  hint: CheckoutHint;
  /** First hour (Warsaw) of the purchase-free run; 0 = none at all today. */
  fromHour: number;
  hours: number;
  carts: number;
  checkouts: number;
  /** Purchases today's carts usually turn into, in those hours. */
  expected: number;
  /** Shop orders that arrived meanwhile (null = no shop feed). */
  orders: number | null;
}

export interface MetaFacts {
  guard: "meta-pixel";
  clicks: number;
  /** Usual Meta clicks by this hour. */
  usualClicks: number;
  purchases: number;
  expected: number;
  /** What the shop itself sold today (GA4 purchases or its own orders). */
  shopPurchases: number;
  source: "ga4" | "shop";
}

export interface FeedFacts {
  guard: "shop-feed";
  lastPushAt: string;
  ageMin: number;
  usualGapMin: number;
}

export type FlowFacts = Ga4Facts | CheckoutFacts | MetaFacts | FeedFacts;

export type Verdict =
  | { kind: "bad"; severity: FlowSeverity; facts: FlowFacts }
  | { kind: "ok" }
  | { kind: "unknown"; reason: string };

export interface FlowIncident {
  /** Alert id = notifications_sent key: one e-mail per incident. */
  id: string;
  guard: FlowGuard;
  /** First bad check of the incident (kept when it re-opens). */
  since: string;
  /** First bad check of the current run of bad checks (for the wording). */
  startedAt: string;
  /** Latest check that confirmed it. */
  lastSeen: string;
  severity: FlowSeverity;
  /** The latest confirming check's numbers. */
  facts: FlowFacts;
}

export interface GuardTrack {
  /** Bad checks in a row. */
  bad: number;
  firstBadAt?: string;
  open?: FlowIncident;
  /** The last incident that closed, for the re-open window. */
  closed?: { id: string; since: string; at: string };
}

export interface FlowState {
  v: 1;
  checkedAt?: string;
  /** Warsaw day of checkedAt: the readings below are that day's. */
  day?: string;
  /** Today's ad clicks so far, all providers. */
  clicks?: Reading[];
  /** Today's shop orders so far (shop feed). */
  orders?: Reading[];
  /** The last GA4 realtime reading (last 30 minutes, all properties). */
  realtime?: { at: string; users: number; events: number };
  rtBase?: RealtimeBaseline;
  /** GA4 sessions per hour on today's weekday (heatmap / 4 weeks). */
  profile?: { day: string; hours: number[] };
  cartBase?: CartBaseline;
  metaBase?: MetaBaseline;
  /** Distinct shop pushes seen (shop_ingest_keys.last_used_at), oldest first. */
  pushes?: string[];
  guards?: Partial<Record<FlowGuard, GuardTrack>>;
}

/** Whether this run should check at all (see MIN_CHECK_GAP_MIN). */
export function checkDue(prev: FlowState | null | undefined, now: string): boolean {
  if (!prev?.checkedAt) return true;
  const gap = minutesBetween(prev.checkedAt, now);
  return !Number.isFinite(gap) || gap < 0 || gap >= MIN_CHECK_GAP_MIN;
}

/** Which once-a-day inputs the caller must (re)load for this check. */
export function dailyDue(
  prev: FlowState | null | undefined,
  day: string
): { profile: boolean; cartBase: boolean; metaBase: boolean } {
  return {
    profile: prev?.profile?.day !== day,
    cartBase: prev?.cartBase?.day !== day,
    metaBase: prev?.metaBase?.day !== day,
  };
}

// ---- inputs from rows -----------------------------------------------------------

const emptyDay = (): EcomDay => Array.from({ length: 24 }, () => [0, 0, 0, 0] as [number, number, number, number]);

function addInto(cell: [number, number, number, number], r: HourEcom): void {
  cell[0] += r.events || 0;
  cell[1] += r.carts || 0;
  cell[2] += r.checkouts || 0;
  cell[3] += r.purchases || 0;
}

/** Today's hours from GA4 dateHour rows; an hour without a row is null. */
export function cartTodayFrom(rows: readonly EcomHourRow[], today: string): Array<HourEcom | null> {
  const out: Array<HourEcom | null> = Array.from({ length: 24 }, () => null);
  for (const r of rows) {
    if (r.date !== today || !Number.isInteger(r.hour) || r.hour < 0 || r.hour > 23) continue;
    const cur = out[r.hour] ?? { events: 0, carts: 0, checkouts: 0, purchases: 0 };
    cur.events += r.events || 0;
    cur.carts += r.carts || 0;
    cur.checkouts += r.checkouts || 0;
    cur.purchases += r.purchases || 0;
    out[r.hour] = cur;
  }
  return out;
}

/** The same weekday 1..4 weeks before `today`, hour by hour. */
export function cartBaselineFrom(rows: readonly EcomHourRow[], today: string): CartBaseline {
  const wanted = Array.from({ length: CART_BASE_WEEKS }, (_, i) => addDaysIso(today, -7 * (i + 1)));
  const byDate = new Map<string, EcomDay>();
  for (const r of rows) {
    if (!wanted.includes(r.date) || !Number.isInteger(r.hour) || r.hour < 0 || r.hour > 23) continue;
    const day = byDate.get(r.date) ?? emptyDay();
    addInto(day[r.hour], r);
    byDate.set(r.date, day);
  }
  return { day: today, days: wanted.filter((d) => byDate.has(d)).map((d) => byDate.get(d) as EcomDay) };
}

/** Meta per day from ads_daily rows of the same weekdays (purchases unknown if any row lacks them). */
export function metaBaselineFrom(
  rows: ReadonlyArray<{ date: string; clicks: number; purchases: number | null }>,
  today: string
): MetaBaseline {
  const wanted = new Set(Array.from({ length: CART_BASE_WEEKS }, (_, i) => addDaysIso(today, -7 * (i + 1))));
  const byDate = new Map<string, MetaDay>();
  for (const r of rows) {
    if (!wanted.has(r.date)) continue;
    const d = byDate.get(r.date) ?? { clicks: 0, purchases: 0 };
    d.clicks += isNum(r.clicks) ? r.clicks : 0;
    d.purchases = d.purchases === null || !isNum(r.purchases) ? null : d.purchases + r.purchases;
    byDate.set(r.date, d);
  }
  return { day: today, days: [...byDate.values()] };
}

/** GA4 sessions per hour of one weekday, from the 28-day heatmap (4 of each weekday). */
export function profileFrom(rows: ReadonlyArray<{ hour: number; sessions: number }>, weeks = 4): number[] {
  const out = Array.from({ length: 24 }, () => 0);
  for (const r of rows) {
    if (Number.isInteger(r.hour) && r.hour >= 0 && r.hour <= 23 && isNum(r.sessions)) out[r.hour] += r.sessions / weeks;
  }
  return out;
}

/** Share of a usual day's traffic that has passed by this time (flat without a profile). */
export function dayShare(profile: readonly number[] | null | undefined, clock: LocalClock): number {
  const total = profile ? profile.reduce((a, v) => a + (isNum(v) ? v : 0), 0) : 0;
  let share: number;
  if (profile && profile.length === 24 && total >= 24) {
    let before = 0;
    for (let h = 0; h < clock.hour; h++) before += isNum(profile[h]) ? profile[h] : 0;
    before += (isNum(profile[clock.hour]) ? profile[clock.hour] : 0) * (clock.minute / 60);
    share = before / total;
  } else {
    share = clock.mod / 1440;
  }
  return Math.max(0.02, Math.min(1, share));
}

// ---- readings -----------------------------------------------------------------

export interface Flow {
  /** Added since the reading at least FLOW_WINDOW_MIN old. */
  flow: number;
  /** Added since the previous reading. */
  step: number;
  /** Minutes back to that older reading. */
  minutes: number;
}

/** How much a cumulative count grew lately, or null without an old enough reading. */
export function flowSince(readings: readonly Reading[], nowMod: number, current: number): Flow | null {
  let base: Reading | null = null;
  let last: Reading | null = null;
  for (const r of readings) {
    if (r[0] >= nowMod) continue;
    if (r[0] <= nowMod - FLOW_WINDOW_MIN) base = r;
    last = r;
  }
  if (!base || !last) return null;
  return { flow: current - base[1], step: current - last[1], minutes: nowMod - base[0] };
}

/** The newest reading at or before `mod`, or null. */
function readingAtOrBefore(readings: readonly Reading[], mod: number): Reading | null {
  let hit: Reading | null = null;
  for (const r of readings) if (r[0] <= mod) hit = r;
  return hit;
}

// ---- realtime baseline ------------------------------------------------------------

const isWeekend = (weekday: number) => weekday === 0 || weekday === 6;

export const realtimeCell = (weekday: number, hour: number): string => `${isWeekend(weekday) ? "we" : "wd"}-${hour}`;

/** A baseline cell's samples, ignoring anything malformed. */
function cellOf(base: RealtimeBaseline | undefined, key: string): Array<[string, number]> {
  const cell = base?.[key];
  return Array.isArray(cell) ? cell.filter((e) => Array.isArray(e) && typeof e[0] === "string" && isNum(e[1])) : [];
}

/** The baseline with today's sample for this hour (one per day and hour, the latest wins). */
export function recordRealtime(base: RealtimeBaseline | undefined, clock: LocalClock, users: number): RealtimeBaseline {
  const key = realtimeCell(clock.weekday, clock.hour);
  const keep = isWeekend(clock.weekday) ? RT_BASE_WEEKEND_DAYS : RT_BASE_WEEKDAY_DAYS;
  const cell = cellOf(base, key).filter(([d]) => d !== clock.day);
  cell.push([clock.day, users]);
  cell.sort((a, b) => a[0].localeCompare(b[0]));
  return { ...(base ?? {}), [key]: cell.slice(-keep) };
}

/**
 * Usual realtime visitors at this hour: the median of earlier days' samples
 * (weekdays and weekends apart), or - until there are enough - the GA4
 * heatmap's sessions in this hour scaled to a 30-minute window.
 */
export function usualRealtime(
  base: RealtimeBaseline | undefined,
  clock: LocalClock,
  profile: readonly number[] | null | undefined
): { usual: number; learned: boolean } | null {
  const cell = cellOf(base, realtimeCell(clock.weekday, clock.hour)).filter(([d]) => d !== clock.day);
  if (cell.length >= RT_MIN_SAMPLES) return { usual: median(cell.map(([, v]) => v)), learned: true };
  const hourly = profile?.[clock.hour];
  return isNum(hourly) && hourly > 0 ? { usual: hourly * RT_PER_HOURLY_SESSION, learned: false } : null;
}

// ---- the guards -------------------------------------------------------------------

const unknown = (reason: string): Verdict => ({ kind: "unknown", reason });

/** The GA4 verdict for an hour without a clear usual level: still worth learning. */
const QUIET_HOUR = "quiet hour";

/**
 * "Nie spływają dane z Analytics": the ads keep delivering clicks, but GA4's
 * realtime report sees ~nobody, at an hour that usually has visitors.
 */
export function judgeGa4(args: {
  clock: LocalClock;
  realtime: { users: number; events: number } | null;
  usual: { usual: number; learned: boolean } | null;
  flow: Flow | null;
}): Verdict {
  const { clock, realtime, flow } = args;
  if (!inGuardHours(clock.hour)) return unknown("night");
  if (!realtime) return unknown("no realtime data");
  const usual = args.usual?.usual ?? null;
  if (usual === null || usual < MIN_USUAL_RT_USERS) return unknown(QUIET_HOUR);
  const nearZero = Math.floor(usual * NEAR_ZERO_SHARE);
  if (realtime.users > nearZero) return { kind: "ok" };
  // ~nobody on the site: a broken tag only if the ads are sending people.
  if (!flow || flow.flow < MIN_FLOW_CLICKS || flow.step < MIN_FLOW_STEP) return unknown("ads not delivering");
  // Pilne only against this client's own measured level, not the heatmap
  // estimate it starts from.
  const confident =
    args.usual?.learned === true &&
    realtime.users === 0 &&
    realtime.events === 0 &&
    usual >= CONFIDENT_RT_USERS &&
    flow.flow >= CONFIDENT_FLOW_CLICKS;
  return {
    kind: "bad",
    severity: confident ? "critical" : "high",
    facts: {
      guard: "ga4",
      users: realtime.users,
      events: realtime.events,
      usual: Math.round(usual),
      clicks: flow.flow,
      minutes: flow.minutes,
    },
  };
}

/**
 * "Koszyk/płatności mogą nie działać": complete hours in a row with no
 * purchase in GA4 while people keep adding to the cart, when the carts of
 * those hours would usually have turned into a clear number of purchases.
 */
export function judgeCheckout(args: {
  clock: LocalClock;
  today: ReadonlyArray<HourEcom | null> | null | undefined;
  base: CartBaseline | null | undefined;
  orders: readonly Reading[];
  ordersNow: number | null | undefined;
}): Verdict {
  const { clock, today, base } = args;
  if (!inGuardHours(clock.hour)) return unknown("night");
  if (!today) return unknown("no GA4 hours today");
  if (!base || base.days.length < MIN_CART_BASE_WEEKS) return unknown("no baseline");

  // Judge only complete hours GA4 has processed: its hourly tables lag, and
  // an hour it has not processed yet reads as no purchases (and no carts).
  let horizon = -1;
  for (let h = Math.min(clock.hour - 1, 23); h >= 0; h--) {
    const cell = today[h];
    if (cell && cell.events > 0) {
      horizon = h;
      break;
    }
  }
  if (horizon < 0) return unknown("no processed hour");

  if ((today[horizon]?.purchases ?? 0) > 0) return { kind: "ok" };
  // Back from the newest processed hour to the last one with a purchase.
  let fromHour = horizon;
  while (fromHour > 0 && (today[fromHour - 1]?.purchases ?? 0) === 0) fromHour -= 1;
  const hours = horizon - fromHour + 1;
  if (hours < MIN_SILENT_HOURS) return { kind: "ok" };

  let carts = 0;
  let checkouts = 0;
  for (let h = fromHour; h <= horizon; h++) {
    carts += today[h]?.carts ?? 0;
    checkouts += today[h]?.checkouts ?? 0;
  }
  if (carts < MIN_SPAN_CARTS) return unknown("few carts");

  // The same hours on the same weekdays: per day, then the median day.
  const usualCarts: number[] = [];
  const usualCheckouts: number[] = [];
  const usualPurchases: number[] = [];
  let pooledCarts = 0;
  let pooledPurchases = 0;
  for (const day of base.days) {
    let c = 0;
    let k = 0;
    let p = 0;
    for (let h = fromHour; h <= horizon; h++) {
      const cell = day[h];
      if (!cell) continue;
      c += cell[1];
      k += cell[2];
      p += cell[3];
    }
    usualCarts.push(c);
    usualCheckouts.push(k);
    usualPurchases.push(p);
    pooledCarts += c;
    pooledPurchases += p;
  }
  if (median(usualPurchases) < MIN_SPAN_USUAL_PURCHASES || pooledCarts <= 0) return unknown("usually few purchases");
  // Purchases per add-to-cart of those hours, applied to today's carts: a
  // promo day with twice the carts expects twice the purchases.
  const expected = carts * (pooledPurchases / pooledCarts);
  if (expected < MIN_EXPECTED_PURCHASES) return unknown("too few expected");

  // The shop's own orders meanwhile tell "nobody buys" from "GA4 misses it".
  let orders: number | null = null;
  if (isNum(args.ordersNow)) {
    const before = readingAtOrBefore(args.orders, fromHour * 60);
    if (before) orders = Math.max(0, args.ordersNow - before[1]);
  }
  const hint: CheckoutHint =
    orders !== null && orders >= SHOP_ORDERS_STILL_FLOWING
      ? "tracking"
      : checkouts >= MIN_SPAN_CHECKOUTS
        ? "payment"
        : median(usualCheckouts) >= MIN_SPAN_CHECKOUTS
          ? "cart"
          : "both";
  return {
    kind: "bad",
    severity: hint !== "tracking" && expected >= CONFIDENT_EXPECTED_PURCHASES ? "critical" : "high",
    facts: {
      guard: "checkout",
      hint,
      fromHour,
      hours,
      carts,
      checkouts,
      expected: Math.round(expected * 10) / 10,
      orders,
    },
  };
}

/**
 * "Piksel Meta nie liczy": Meta's link clicks run as usual for this hour and
 * the shop sells, but Meta reports (almost) no purchases from today's clicks.
 */
export function judgeMetaPixel(args: {
  clock: LocalClock;
  now: string;
  meta: { clicksToday: number; purchasesToday: number | null; syncedAt: string | null } | null | undefined;
  base: MetaBaseline | null | undefined;
  profile: readonly number[] | null | undefined;
  ga4PurchasesToday: number | null | undefined;
  shopOrdersToday: number | null | undefined;
}): Verdict {
  const { clock, meta, base } = args;
  if (!inGuardHours(clock.hour) || clock.hour < META_FIRST_HOUR) return unknown("too early");
  if (!meta || !isNum(meta.purchasesToday)) return unknown("no Meta purchases");
  if (!meta.syncedAt || minutesBetween(meta.syncedAt, args.now) > META_FRESH_MIN) return unknown("Meta data stale");
  const days = (base?.days ?? []).filter((d) => isNum(d.purchases) && d.clicks > 0);
  if (days.length < MIN_CART_BASE_WEEKS) return unknown("no baseline");
  const sumClicks = days.reduce((a, d) => a + d.clicks, 0);
  const sumPurchases = days.reduce((a, d) => a + (d.purchases ?? 0), 0);
  if (sumPurchases <= 0) return unknown("Meta usually counts no purchases");

  const usualClicks = median(days.map((d) => d.clicks)) * dayShare(args.profile, clock);
  if (meta.clicksToday < MIN_META_CLICKS || meta.clicksToday < META_CLICKS_NORMAL * usualClicks) {
    return unknown("Meta delivers less than usual");
  }
  const expected = meta.clicksToday * (sumPurchases / sumClicks) * META_SAME_DAY_SHARE;
  if (expected < MIN_EXPECTED_META_PURCHASES) return unknown("too few expected");

  const ga4 = isNum(args.ga4PurchasesToday) ? args.ga4PurchasesToday : -1;
  const shop = isNum(args.shopOrdersToday) ? args.shopOrdersToday : -1;
  const shopPurchases = Math.max(ga4, shop);
  // A shop that is not selling is the checkout guard's case, not the pixel's.
  if (shopPurchases < MIN_SHOP_PURCHASES_TODAY) return unknown("the shop is not selling");

  if (meta.purchasesToday > Math.floor(expected * META_FAR_BELOW)) return { kind: "ok" };
  return {
    kind: "bad",
    severity: meta.purchasesToday === 0 && expected >= CONFIDENT_EXPECTED_META ? "critical" : "high",
    facts: {
      guard: "meta-pixel",
      clicks: meta.clicksToday,
      usualClicks: Math.round(usualClicks),
      purchases: meta.purchasesToday,
      expected: Math.round(expected * 10) / 10,
      shopPurchases,
      source: shop >= ga4 ? "shop" : "ga4",
    },
  };
}

/** `pushes` with a newly seen push, pruned to the last FEED_KEEP_DAYS. */
export function rememberPush(pushes: readonly string[] | undefined, lastPushAt: string, now: string): string[] {
  const list = [...(pushes ?? [])];
  const last = list[list.length - 1];
  if (!last || Date.parse(lastPushAt) > Date.parse(last)) list.push(lastPushAt);
  return list.filter((p) => minutesBetween(p, now) <= FEED_KEEP_DAYS * 1440).slice(-FEED_KEEP_MAX);
}

/**
 * "Zamówienia przestały spływać": the shop pushes its sales every hour or
 * so (POST /api/ingest/sales), and the last push is unusually old for this
 * time of day.
 */
export function judgeFeed(args: {
  clock: LocalClock;
  now: string;
  utcOffsetMin: number;
  lastPushAt: string | null | undefined;
  pushes: readonly string[];
}): Verdict {
  const { clock, now, lastPushAt } = args;
  if (!lastPushAt || !Number.isFinite(Date.parse(lastPushAt))) return unknown("no shop feed");
  if (!inGuardHours(clock.hour)) return unknown("night");
  const pushes = [...args.pushes].sort();
  if (pushes.length < FEED_MIN_PUSHES) return unknown("feed history too short");
  const gaps: number[] = [];
  for (let i = 1; i < pushes.length; i++) gaps.push(minutesBetween(pushes[i - 1], pushes[i]));
  const usualGap = median(gaps);
  if (usualGap > FEED_MAX_USUAL_GAP_MIN) return unknown("not an hourly feed");
  const staleAfter = Math.max(FEED_STALE_MIN, FEED_STALE_FACTOR * usualGap);
  const age = minutesBetween(lastPushAt, now);
  if (age < staleAfter) return { kind: "ok" };
  // A shop that only pushes in working hours is quiet at 7:30 every day.
  let regular = 0;
  for (let d = 1; d <= 3; d++) {
    const day = addDaysIso(clock.day, -d);
    const hit = pushes.some((p) => {
      const c = localClock(p, args.utcOffsetMin);
      return c.day === day && c.mod > clock.mod - staleAfter && c.mod <= clock.mod;
    });
    if (hit) regular += 1;
  }
  if (regular < FEED_REGULAR_DAYS) return unknown("usually quiet at this hour");
  return {
    kind: "bad",
    severity: age >= FEED_CRITICAL_MIN ? "critical" : "high",
    facts: { guard: "shop-feed", lastPushAt, ageMin: Math.round(age), usualGapMin: Math.round(usualGap) },
  };
}

// ---- incidents ----------------------------------------------------------------------

const RANK: Record<FlowSeverity, number> = { critical: 0, high: 1 };
const worse = (a: FlowSeverity, b: FlowSeverity): FlowSeverity => (RANK[a] <= RANK[b] ? a : b);

/** "flow-ga4-202611071425": stable for the incident, unique per incident. */
export function incidentId(guard: FlowGuard, at: string): string {
  return `flow-${guard}-${at.slice(0, 16).replace(/[-:T]/g, "")}`;
}

/** One guard's track after this check's verdict. */
export function advanceGuard(
  guard: FlowGuard,
  track: GuardTrack | undefined,
  verdict: Verdict,
  now: string
): GuardTrack {
  let bad = track?.bad ?? 0;
  let firstBadAt = track?.firstBadAt;
  let open = track?.open;
  let closed = track?.closed;
  if (open && minutesBetween(open.lastSeen, now) > OPEN_TTL_MIN) {
    closed = { id: open.id, since: open.since, at: open.lastSeen };
    open = undefined;
  }
  if (verdict.kind === "ok") {
    // The data flows again: the incident is over.
    if (open) closed = { id: open.id, since: open.since, at: now };
    return closed ? { bad: 0, closed } : { bad: 0 };
  }
  if (verdict.kind === "unknown") {
    // Not a look at the problem: no longer "in a row", but an open incident
    // stays until a clear check (or OPEN_TTL_MIN without one).
    const out: GuardTrack = { bad: 0 };
    if (open) out.open = open;
    if (closed) out.closed = closed;
    return out;
  }
  bad += 1;
  firstBadAt = firstBadAt ?? now;
  if (open) {
    open = {
      ...open,
      lastSeen: now,
      severity: worse(open.severity, verdict.severity),
      facts: verdict.facts,
    };
  } else if (bad >= CONFIRM_CHECKS) {
    const reopen = closed && minutesBetween(closed.at, now) <= REOPEN_WINDOW_MIN ? closed : null;
    open = {
      id: reopen ? reopen.id : incidentId(guard, firstBadAt),
      guard,
      since: reopen ? reopen.since : firstBadAt,
      startedAt: firstBadAt,
      lastSeen: now,
      severity: verdict.severity,
      facts: verdict.facts,
    };
  }
  const out: GuardTrack = { bad, firstBadAt };
  if (open) out.open = open;
  if (closed) out.closed = closed;
  return out;
}

// ---- one check ------------------------------------------------------------------------

export interface FlowInput {
  /** Now, ISO (UTC). */
  now: string;
  /** Warsaw's UTC offset now, minutes (60 in winter, 120 in summer). */
  utcOffsetMin: number;
  /** client_type 'ecommerce': the cart, pixel and feed guards run. */
  shop: boolean;
  /** GA4 realtime, last 30 minutes, all properties; null = not asked / failed. */
  realtime: { users: number; events: number } | null;
  /** Today's ad clicks so far (ads_daily, every provider); null = unknown. */
  adClicksToday: number | null;
  /** Fresh once-a-day inputs; undefined = keep today's cached one. */
  profile?: number[] | null;
  cartBase?: CartBaseline | null;
  metaBase?: MetaBaseline | null;
  /** GA4 e-commerce per hour today (shops). */
  cartToday?: Array<HourEcom | null> | null;
  /** Today's Meta rows: link clicks, purchases (null if a row lacks them), last sync. */
  meta?: { clicksToday: number; purchasesToday: number | null; syncedAt: string | null } | null;
  /** The shop's own paid orders today (shop_sales_daily); null = no feed. */
  shopOrdersToday?: number | null;
  /** shop_ingest_keys.last_used_at; null/undefined = no feed. */
  lastPushAt?: string | null;
}

export interface FlowCheckResult {
  state: FlowState;
  verdicts: Record<FlowGuard, Verdict>;
}

const readingsOf = (v: unknown): Reading[] =>
  Array.isArray(v) ? (v.filter((r) => Array.isArray(r) && isNum(r[0]) && isNum(r[1])) as Reading[]) : [];

/**
 * Runs every guard once and returns the state to store. A state of another
 * version (or none) starts from scratch: baselines are re-learned.
 */
export function runFlowCheck(stored: FlowState | null | undefined, input: FlowInput): FlowCheckResult {
  const prev = stored?.v === 1 ? stored : null;
  const { now, utcOffsetMin, shop } = input;
  const clock = localClock(now, utcOffsetMin);
  const sameDay = prev?.day === clock.day;
  const clicks = sameDay ? readingsOf(prev?.clicks) : [];
  const orders = sameDay ? readingsOf(prev?.orders) : [];

  // Once-a-day inputs: a fresh one replaces the cache, a failed load (null)
  // leaves none (the next run loads again), none given keeps today's cache.
  const keep = <T extends { day: string }>(fresh: T | null | undefined, cached: T | undefined): T | undefined => {
    if (fresh !== undefined) return fresh ?? undefined;
    return cached?.day === clock.day ? cached : undefined;
  };
  const freshProfile =
    input.profile === undefined ? undefined : input.profile ? { day: clock.day, hours: input.profile } : null;
  const profile = keep(freshProfile, prev?.profile);
  const cartBase = keep(input.cartBase, prev?.cartBase);
  const metaBase = keep(input.metaBase, prev?.metaBase);

  const flow = isNum(input.adClicksToday) ? flowSince(clicks, clock.mod, input.adClicksToday) : null;
  const usual = usualRealtime(prev?.rtBase, clock, profile?.hours);
  const seenPushes = Array.isArray(prev?.pushes) ? prev.pushes.filter((p) => typeof p === "string") : [];
  const pushes =
    input.lastPushAt && Number.isFinite(Date.parse(input.lastPushAt))
      ? rememberPush(seenPushes, input.lastPushAt, now)
      : seenPushes;

  const cartToday = input.cartToday ?? null;
  const ga4Purchases = cartToday ? cartToday.reduce((a, c) => a + (c?.purchases ?? 0), 0) : null;
  const notShop = unknown("not a shop");
  const verdicts: Record<FlowGuard, Verdict> = {
    ga4: judgeGa4({ clock, realtime: input.realtime, usual, flow }),
    checkout: shop
      ? judgeCheckout({ clock, today: cartToday, base: cartBase, orders, ordersNow: input.shopOrdersToday })
      : notShop,
    "meta-pixel": shop
      ? judgeMetaPixel({
          clock,
          now,
          meta: input.meta,
          base: metaBase,
          profile: profile?.hours,
          ga4PurchasesToday: ga4Purchases,
          shopOrdersToday: input.shopOrdersToday,
        })
      : notShop,
    "shop-feed": shop ? judgeFeed({ clock, now, utcOffsetMin, lastPushAt: input.lastPushAt, pushes }) : notShop,
  };

  // Checks skipped for a while: an old bad check is not "in a row" with this one.
  const gap = prev?.checkedAt ? minutesBetween(prev.checkedAt, now) : Infinity;
  const guards: Partial<Record<FlowGuard, GuardTrack>> = {};
  for (const g of FLOW_GUARDS) {
    let track = prev?.guards?.[g];
    if (track && !(gap <= MAX_CHECK_GAP_MIN)) track = { ...track, bad: 0, firstBadAt: undefined };
    const next = advanceGuard(g, track, verdicts[g], now);
    if (next.bad || next.open || next.closed) guards[g] = next;
  }

  // Learn the realtime level only from checks nobody suspects: a clear
  // "data flows", or an hour too quiet to judge. ~Zero at an hour that is
  // usually busy is never learned, ads or not - a broken tag's zeros must
  // not become the new "usual".
  const ga4Verdict = verdicts.ga4;
  const learnable =
    ga4Verdict.kind === "ok" || (ga4Verdict.kind === "unknown" && ga4Verdict.reason === QUIET_HOUR);
  let rtBase = prev?.rtBase;
  if (input.realtime && learnable && !guards.ga4?.open) {
    rtBase = recordRealtime(rtBase, clock, input.realtime.users);
  }

  const withReading = (list: Reading[], value: number | null | undefined): Reading[] =>
    (isNum(value) ? [...list.filter((r) => r[0] < clock.mod), [clock.mod, value] as Reading] : list).slice(-READINGS_KEEP);

  const state: FlowState = {
    v: 1,
    checkedAt: now,
    day: clock.day,
    clicks: withReading(clicks, input.adClicksToday),
    orders: withReading(orders, input.shopOrdersToday),
    guards,
  };
  if (input.realtime) state.realtime = { at: now, ...input.realtime };
  else if (prev?.realtime) state.realtime = prev.realtime;
  if (rtBase) state.rtBase = rtBase;
  if (profile) state.profile = profile;
  if (cartBase) state.cartBase = cartBase;
  if (metaBase) state.metaBase = metaBase;
  if (pushes.length) state.pushes = pushes;
  return { state, verdicts };
}

// ---- Polish wording -------------------------------------------------------------------

/** 1 zamówienie, 2-4 zamówienia (but 12-14 zamówień), 5+ zamówień. */
export function plPlural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.round(n));
  if (abs === 1) return one;
  const last = abs % 10;
  const lastTwo = abs % 100;
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return few;
  return many;
}

/** "1 240" - thousands apart (the card keeps the number on one line). */
function n(v: number): string {
  const r = Math.round(v);
  return `${r < 0 ? "-" : ""}${String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")}`;
}

/** "12 kliknięć" with the right form. */
const count = (v: number, one: string, few: string, many: string) => `${n(v)} ${plPlural(v, one, few, many)}`;

/** Expected counts read as "ok. 7", never "ok. 0". */
const about = (v: number) => Math.max(1, Math.round(v));

export interface FlowAlert {
  id: string;
  guard: FlowGuard;
  severity: FlowSeverity;
  /** Anomaly.metric */
  label: string;
  scopeLabel: string;
  changePct: number;
  title: string;
  /** The numbers. */
  description: string;
  /** "Dlaczego to ważne" */
  why: string;
  /** "Co z tym robimy": what to check, in plain words. */
  action: string;
  since: string;
  /** "od ok. 13:55", shown next to the scope on the card. */
  sinceLabel: string;
}

function ga4Alert(inc: FlowIncident, f: Ga4Facts, shop: boolean, offset: number): FlowAlert {
  // The realtime window is the 30 minutes before the first bad check.
  const from = clockLabel(Math.floor(Math.max(0, localClock(inc.startedAt, offset).mod - 30) / 5) * 5);
  const clicks = count(f.clicks, "kliknięcie", "kliknięcia", "kliknięć");
  const description =
    f.users === 0
      ? `Od ok. ${from} Google Analytics nie widzi na stronie nikogo, a zwykle o tej porze w ciągu pół godziny jest tam ok. ${count(about(f.usual), "osoba", "osoby", "osób")}. W ostatniej godzinie reklamy dały ${clicks} — ludzie wchodzą, ale Analytics ich nie liczy.`
      : `Od ok. ${from} Google Analytics widzi na stronie tylko ${count(f.users, "osobę", "osoby", "osób")} w ciągu pół godziny, a zwykle o tej porze ok. ${n(about(f.usual))}. W ostatniej godzinie reklamy dały ${clicks}.`;
  return {
    id: inc.id,
    guard: "ga4",
    severity: inc.severity,
    label: "Analytics",
    scopeLabel: "Ruch na stronie · GA4",
    changePct: f.usual > 0 ? (Math.min(f.users, f.usual) / f.usual - 1) * 100 : -100,
    title: "Nie spływają dane z Analytics",
    description,
    why: shop
      ? "Bez danych z Analytics nie widać, co dzieje się w sklepie, a kampanie tracą sygnał, kto kupuje. Jeśli to strona przestała działać, każda godzina to utracone zamówienia."
      : "Bez danych z Analytics nie widać, ile osób ogląda stronę. Jeśli to strona przestała działać, ruch z reklam, za który płacimy, trafia w próżnię.",
    action:
      "Sprawdź, czy tag Google (gtag/GTM) jest na stronie — ruch z reklam jest, a Analytics nic nie widzi. Sprawdź też, czy strona w ogóle się otwiera.",
    since: inc.since,
    sinceLabel: `od ok. ${from}`,
  };
}

function checkoutAlert(inc: FlowIncident, f: CheckoutFacts): FlowAlert {
  const allDay = f.fromHour === 0;
  const lead = allDay ? "Dziś" : `Od ${f.fromHour}:00`;
  const forHours = allDay ? "od rana" : `od ${f.hours === 1 ? "godziny" : `${f.hours} godzin`}`;
  const expected = count(about(f.expected), "zakup", "zakupy", "zakupów");
  const carts = count(f.carts, "dodanie do koszyka", "dodania do koszyka", "dodań do koszyka");
  const checkouts = f.checkouts > 0 ? ` i ${count(f.checkouts, "przejście do kasy", "przejścia do kasy", "przejść do kasy")}` : "";
  const sinceLabel = allDay ? "dziś" : `od ${f.fromHour}:00`;
  if (f.hint === "tracking") {
    return {
      id: inc.id,
      guard: "checkout",
      severity: inc.severity,
      label: "Pomiar zakupów",
      scopeLabel: "Pomiar sprzedaży · GA4",
      changePct: -100,
      title: "Analytics nie widzi zakupów",
      description: `${lead} Analytics nie widzi żadnego zakupu, choć sklep przyjął w tym czasie ${count(f.orders ?? 0, "zamówienie", "zamówienia", "zamówień")}. Przy takim ruchu Analytics liczy zwykle ok. ${expected}.`,
      why: "Sprzedaż idzie, ale bez zakupów w Analytics raporty i kampanie Google nie widzą, co sprzedają, i zaczynają działać na ślepo.",
      action: `Sprawdź zdarzenie zakupu (purchase) w tagu Google — sklep sprzedaje, a Analytics nie widzi zakupów ${forHours}.`,
      since: inc.since,
      sinceLabel,
    };
  }
  const nobody = allDay ? "Dziś jeszcze nikt nie kupił" : `${lead} nikt nie kupił`;
  // The verb agrees with the count it precedes: "były 34 dodania", "było 12 dodań".
  const were = plPlural(f.carts, "było", "były", "było");
  const action: Record<Exclude<CheckoutHint, "tracking">, string> = {
    payment: `Sprawdź płatności — klienci przechodzą do kasy, ale nikt nie płaci ${forHours}.`,
    cart: `Sprawdź koszyk — ludzie dodają produkty do koszyka, ale nikt nie przechodzi do kasy ${forHours}.`,
    both: `Sprawdź płatności i koszyk — ludzie dodają do koszyka, ale nikt nie kupuje ${forHours}.`,
  };
  return {
    id: inc.id,
    guard: "checkout",
    severity: inc.severity,
    label: "Koszyk i płatności",
    scopeLabel: "Sklep",
    changePct: -100,
    title: "Koszyk lub płatności mogą nie działać",
    description: `${nobody}, choć ${were} ${carts}${checkouts}. Przy takim ruchu zwykle byłoby już ok. ${expected}.`,
    why: "Ludzie chcą kupić, ale coś ich zatrzymuje — każda godzina bez zakupów to utracona sprzedaż.",
    action: action[f.hint],
    since: inc.since,
    sinceLabel,
  };
}

function metaAlert(inc: FlowIncident, f: MetaFacts): FlowAlert {
  const clicks = count(f.clicks, "kliknięcie", "kliknięcia", "kliknięć");
  const evidence =
    f.source === "shop"
      ? `sklep ma dziś ${count(f.shopPurchases, "zamówienie", "zamówienia", "zamówień")}`
      : `Analytics widzi dziś ${count(f.shopPurchases, "zakup", "zakupy", "zakupów")}`;
  const seen =
    f.purchases === 0
      ? "Meta nie pokazuje dziś ani jednego zakupu z reklam"
      : `Meta pokazuje dziś tylko ${count(f.purchases, "zakup", "zakupy", "zakupów")} z reklam`;
  return {
    id: inc.id,
    guard: "meta-pixel",
    severity: inc.severity,
    label: "Piksel Meta",
    scopeLabel: "Pomiar sprzedaży · Meta",
    changePct: f.expected > 0 ? (Math.min(f.purchases, f.expected) / f.expected - 1) * 100 : -100,
    title: "Piksel Meta nie liczy zakupów",
    description: `${seen}, choć reklamy dały ${clicks} — tyle co zwykle o tej porze. Przy takim ruchu Meta liczy zwykle już ok. ${count(about(f.expected), "zakup", "zakupy", "zakupów")}, a ${evidence}.`,
    why: "Meta uczy się na zakupach — bez nich kampanie sprzedażowe nie wiedzą, kogo szukać, i z każdą godziną działają słabiej i drożej.",
    action: "Sprawdź piksel Meta / Conversions API — sklep sprzedaje, a Meta nie widzi zakupów.",
    since: inc.since,
    sinceLabel: "dziś",
  };
}

function feedAlert(inc: FlowIncident, f: FeedFacts, offset: number): FlowAlert {
  const push = localClock(f.lastPushAt, offset);
  const seen = localClock(inc.lastSeen, offset);
  const daysAgo = Math.round(
    (Date.parse(`${seen.day}T00:00:00Z`) - Date.parse(`${push.day}T00:00:00Z`)) / 86_400_000
  );
  const at = clockLabel(push.mod);
  const when = daysAgo <= 0 ? `o ${at}` : daysAgo === 1 ? `wczoraj o ${at}` : `${daysAgo} dni temu`;
  const hours = Math.floor(f.ageMin / 60);
  const ago = f.ageMin >= 48 * 60 ? `${Math.floor(f.ageMin / 1440)} dni` : `ponad ${hours} godz.`;
  const cadence =
    f.usualGapMin < 45 ? `co ok. ${Math.max(5, Math.round(f.usualGapMin / 5) * 5)} min` : f.usualGapMin < 90 ? "co godzinę" : `co ok. ${Math.round(f.usualGapMin / 60)} godz.`;
  return {
    id: inc.id,
    guard: "shop-feed",
    severity: inc.severity,
    label: "Dane ze sklepu",
    scopeLabel: "Sklep",
    changePct: -100,
    title: "Zamówienia ze sklepu przestały spływać",
    description: `Sklep ostatni raz przesłał sprzedaż ${when} (${ago} temu), a zwykle robi to ${cadence}. Panel nie widzi nowych zamówień.`,
    why: "Bez danych ze sklepu panel pokazuje zaniżoną sprzedaż i nie zauważy, jeśli zamówienia naprawdę przestaną spływać. Jeśli przestał działać sam sklep, każda godzina to utracone zamówienia.",
    action:
      "Sprawdź, czy sklep działa i czy jego zadanie wysyłające sprzedaż do panelu (co godzinę, z kluczem API) nie przestało działać.",
    since: inc.since,
    sinceLabel: daysAgo <= 0 ? `od ${at}` : "od wczoraj",
  };
}

/** The card / e-mail of one incident. Engagement clients only ever get the GA4 one. */
export function buildFlowAlert(inc: FlowIncident, shop: boolean, utcOffsetMin: number): FlowAlert | null {
  const f = inc.facts;
  if (!f || f.guard !== inc.guard) return null;
  if (!shop && f.guard !== "ga4") return null;
  switch (f.guard) {
    case "ga4":
      return ga4Alert(inc, f, shop, utcOffsetMin);
    case "checkout":
      return checkoutAlert(inc, f);
    case "meta-pixel":
      return metaAlert(inc, f);
    case "shop-feed":
      return feedAlert(inc, f, utcOffsetMin);
  }
}

/**
 * The incidents open right now: confirmed within OPEN_TTL_MIN and today
 * (so an evening incident is not claimed and e-mailed again after midnight).
 */
export function openFlowAlerts(
  state: FlowState | null | undefined,
  now: string,
  utcOffsetMin: number,
  shop: boolean
): FlowAlert[] {
  if (!state?.guards) return [];
  const today = localClock(now, utcOffsetMin).day;
  const out: FlowAlert[] = [];
  for (const g of FLOW_GUARDS) {
    const inc = state.guards[g]?.open;
    if (!inc?.lastSeen || inc.guard !== g) continue;
    const age = minutesBetween(inc.lastSeen, now);
    if (!(age <= OPEN_TTL_MIN && age >= -5)) continue;
    if (localClock(inc.lastSeen, utcOffsetMin).day !== today) continue;
    const alert = buildFlowAlert(inc, shop, utcOffsetMin);
    if (alert) out.push(alert);
  }
  return out;
}
