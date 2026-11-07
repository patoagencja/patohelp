/**
 * Per-account history progress for the campaign-level ad crons
 * (refresh-ads-meta, refresh-ads-google).
 *
 * A day used to count as synced once ANY ads_daily row of the client existed
 * for it. History runs account by account under a time budget, so when
 * account A filled day D and the run ended before accounts B..N got to D, D
 * was "present" from then on and B..N never fetched it: the day stayed
 * undercounted for good. Re-pulls (stale clicks, purchase values) could only
 * be closed when every account re-pulled a day within ONE run, which for
 * DRE's 46 accounts never happened, so its first account re-pulled the same
 * days for ever.
 *
 * The record kept in each client's sync state says, per account:
 * - `done`: days of the history window it has fetched, or is known to have
 *   delivered nothing on (nothing left to fetch either way);
 * - `redo`: per re-pull kind, flagged days it re-pulled (or delivered
 *   nothing on) - a flagged day closes once every account has it, over as
 *   many runs as that takes;
 * - `order`: whose history was served least recently, so one account's long
 *   backlog does not take every run's history time.
 *
 * Accounts are keyed like account-selection.ts keys them (progressKey), so a
 * reconnect that lists "act_123" as "123", or a Google id with or without
 * dashes, keeps its progress. An account no longer selected keeps its entry
 * until its days leave the window: a deselect (or a run that saw no selected
 * account at all) must not cost the whole window again.
 *
 * Days are run-length encoded like the delivery-day cache (sync-state.ts):
 * "2026-01-01..2026-03-31" or a single day. An account that is caught up is
 * one entry for its whole window, so 46 accounts stay a few KB.
 *
 * Keep runtime imports out of this file: its unit tests run it directly under
 * Node's type stripping, which can't resolve the "@/" alias.
 */

/** Stored form (jsonb in report_cache, under the provider's sync-state key). */
export interface HistoryProgress {
  /** Day the record was started (bootstrap). Informational. */
  start: string;
  /** account key -> days with nothing left to fetch (run-length encoded). */
  done: Record<string, string[]>;
  /** re-pull kind -> account key -> flagged days it re-pulled (encoded). */
  redo?: Record<string, Record<string, string[]>>;
  /** Account keys, the one whose history was served longest ago first. */
  order?: string[];
}

/** Working form of the record: plain sets, mutated during a run. */
export interface ProgressView {
  start: string;
  done: Map<string, Set<string>>;
  redo: Map<string, Map<string, Set<string>>>;
  order: string[];
}

/** One account's delivery-day answer (ActiveDayCache.byAccount entry). */
export interface DeliveryAnswer {
  from: string;
  to: string;
  active: readonly unknown[];
}

/** The days history works on: [from, to], both inclusive. */
export interface HistoryWindow {
  from: string;
  to: string;
}

/** Days found with rows of an older shape (e.g. clicks_all NULL). */
export interface FlaggedDays {
  kind: string;
  days: ReadonlySet<string>;
  /**
   * Every account re-pulls these days, delivery or not: for when the
   * delivery answer can't see everything that left rows (Google video-only
   * accounts don't count REMOVED campaigns, whose purchase values only a
   * re-pull brings).
   */
  ignoreDelivery?: boolean;
}

/**
 * The record's key for an account id: the same normalisation as
 * account-selection.ts (Meta "act_123" = "123", Google "123-456-7890" =
 * "1234567890"), so a reconnect that changes the id's format keeps progress.
 */
export const progressKey = (id: unknown): string => String(id).replace(/^act_/, "").replace(/-/g, "");

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A stored run longer than this is a corrupt record, not history. */
const MAX_RUN_DAYS = 4000;

// Day <-> day-number conversions, memoised: a run settles and plans ~470
// days for each of up to 46 accounts, and Date parsing dominated that.
// Bounded: a few thousand distinct days at most, the cap is a backstop.
const MEMO_MAX = 20_000;
const numByDay = new Map<string, number>();
const dayByNum = new Map<number, string>();

/** Day number of a yyyy-MM-dd day, NaN when it is not one. */
function dayNoOrNaN(iso: string): number {
  const hit = numByDay.get(iso);
  if (hit !== undefined) return hit;
  const n = ISO_DAY.test(iso) ? Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS) : NaN;
  if (numByDay.size < MEMO_MAX) numByDay.set(iso, n);
  return n;
}
const dayNo = (iso: string): number => dayNoOrNaN(iso);
function isoOf(n: number): string {
  const hit = dayByNum.get(n);
  if (hit !== undefined) return hit;
  const iso = new Date(n * DAY_MS).toISOString().slice(0, 10);
  if (dayByNum.size < MEMO_MAX) dayByNum.set(n, iso);
  return iso;
}
const shift = (iso: string, days: number): string => isoOf(dayNo(iso) + days);
const isDay = (v: unknown): v is string => typeof v === "string" && Number.isFinite(dayNoOrNaN(v));
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Every day in [from, to], oldest first (empty when either is not a day). */
export function daysIn(from: string, to: string): string[] {
  const out: string[] = [];
  if (!isDay(from) || !isDay(to)) return out;
  for (let n = dayNo(from), end = dayNo(to); n <= end; n += 1) out.push(isoOf(n));
  return out;
}

/** Encoded runs -> days. Anything that is not a day or a sane run is skipped. */
export function expandDays(list: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    if (typeof item !== "string") continue;
    const [a, b, extra] = item.split("..");
    if (extra !== undefined || !isDay(a)) continue;
    if (b === undefined) {
      out.add(a);
      continue;
    }
    if (!isDay(b)) continue;
    const from = dayNo(a);
    const to = dayNo(b);
    if (to < from || to - from > MAX_RUN_DAYS) continue;
    for (let n = from; n <= to; n += 1) out.add(isoOf(n));
  }
  return out;
}

/** Days -> sorted runs of consecutive days ("from..to", or the day alone). */
export function compactDays(days: Iterable<string>): string[] {
  const nums = [...new Set([...days].filter(isDay).map(dayNo))].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < nums.length; ) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j += 1;
    out.push(i === j ? isoOf(nums[i]) : `${isoOf(nums[i])}..${isoOf(nums[j])}`);
    i = j + 1;
  }
  return out;
}

/** account key -> days, keys normalised (two spellings of one account merge). */
function decodeByAccount(raw: Record<string, unknown>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [account, list] of Object.entries(raw)) {
    const key = progressKey(account);
    const days = expandDays(list);
    const had = out.get(key);
    if (had) days.forEach((d) => had.add(d));
    else out.set(key, days);
  }
  return out;
}

/** The stored record as a working view; null when absent or unreadable. */
export function decodeProgress(raw: unknown): ProgressView | null {
  if (!isRecord(raw) || !isRecord(raw.done)) return null;
  const redo = new Map<string, Map<string, Set<string>>>();
  if (isRecord(raw.redo)) {
    for (const [kind, byAccount] of Object.entries(raw.redo)) {
      if (isRecord(byAccount)) redo.set(kind, decodeByAccount(byAccount));
    }
  }
  const order = Array.isArray(raw.order)
    ? [...new Set(raw.order.filter((x): x is string => typeof x === "string").map(progressKey))]
    : [];
  return {
    start: typeof raw.start === "string" ? raw.start : "",
    done: decodeByAccount(raw.done),
    redo,
    order,
  };
}

/**
 * The view as stored: days before `keep.from` (out of the window now) are
 * dropped, and with them, in time, an account no longer selected - once its
 * last day leaves the window its entry is empty and left out. Selected
 * accounts (`keep.accounts`) keep their place in `order`.
 */
export function encodeProgress(
  view: ProgressView,
  keep: { from?: string; accounts?: readonly string[] } = {}
): HistoryProgress {
  const encode = (byAccount: Map<string, Set<string>>): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    for (const [account, days] of byAccount) {
      const list = compactDays(keep.from ? [...days].filter((d) => d >= keep.from!) : days);
      if (list.length) out[account] = list;
    }
    return out;
  };
  const done = encode(view.done);
  const redo: Record<string, Record<string, string[]>> = {};
  for (const [kind, byAccount] of view.redo) {
    const enc = encode(byAccount);
    if (Object.keys(enc).length) redo[kind] = enc;
  }
  const listed = new Set((keep.accounts ?? []).map(progressKey));
  const order = view.order.filter((a) => listed.has(a) || a in done);
  return {
    start: view.start,
    done,
    ...(Object.keys(redo).length ? { redo } : {}),
    ...(order.length ? { order } : {}),
  };
}

/** Recursively key-sorted JSON: jsonb does not keep the key order we wrote. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Same stored content, whatever the key order (so unchanged state isn't rewritten). */
export function sameProgress(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

/**
 * The first record for a client that already has history.
 *
 * Which account wrote which row is not stored (rows carry no account id), so
 * the old rows can't tell which accounts a day is missing. Marking nothing
 * done would re-fetch every delivered day of every account at once - for DRE
 * a year x 46 accounts, weeks of history time. So days that already have rows
 * count as done for every account selected now, EXCEPT:
 * - days on or after `recheckFrom` (the recent window), which every account
 *   fetches again: that is where runs cut short and deferred accounts left
 *   holes most recently, and where the numbers are looked at most;
 * - `suspect` days: older days whose rows were written recently, i.e. filled
 *   by the history backfill under the old "any row = present" rule - the
 *   very days an account may have filled alone (findSuspectDays).
 * Trade-off: an older day an account missed long ago stays as it is (as it
 * did before); new accounts start with nothing done and fetch everything.
 * `known` adds per-account days already known to be fetched (e.g. Google's
 * "fetched, no rows" memory).
 */
export function bootstrapProgress(opts: {
  start: string;
  accounts: readonly string[];
  present: Iterable<string>;
  recheckFrom: string;
  suspect?: Iterable<string>;
  known?: Readonly<Record<string, readonly string[] | undefined>>;
}): ProgressView {
  const suspect = new Set(opts.suspect ?? []);
  const assumed = [...opts.present].filter((d) => isDay(d) && d < opts.recheckFrom && !suspect.has(d));
  const known = new Map<string, string[]>();
  for (const [account, list] of Object.entries(opts.known ?? {})) {
    // Read from stored state: anything but a list of days is ignored.
    const days: unknown = list;
    if (Array.isArray(days)) known.set(progressKey(account), days.filter(isDay));
  }
  const done = new Map<string, Set<string>>();
  for (const account of opts.accounts) {
    const key = progressKey(account);
    done.set(key, new Set([...assumed, ...(known.get(key) ?? [])]));
  }
  return { start: opts.start, done, redo: new Map(), order: [] };
}

/**
 * Old days (`days`, ascending - the present days before the recent window)
 * holding rows first written lately: filled by the history backfill rather
 * than synced as they happened. Found by halving the days with counts, so a
 * block of such days costs a few requests whatever its length, not a page of
 * rows per day or two:
 * - `countWrittenSince(from, to)`: rows first written lately in [from, to]
 *   (null = could not be read);
 * - `rowsOnDay`: all rows per day (ads_daily_totals), when known - a range
 *   whose rows are ALL recent is settled in one request.
 * Past `maxRequests`, the ranges not settled yet are taken as suspect - they
 * are re-checked per account rather than assumed done (`capped` says so).
 * null when a count can't be read: nothing should be assumed then.
 */
export async function findSuspectDays(opts: {
  days: readonly string[];
  rowsOnDay?: ReadonlyMap<string, number> | null;
  countWrittenSince: (from: string, to: string) => Promise<number | null>;
  maxRequests: number;
}): Promise<{ suspect: Set<string>; capped: boolean; requests: number } | null> {
  const days = [...new Set(opts.days.filter(isDay))].sort();
  const suspect = new Set<string>();
  let requests = 0;
  let capped = false;
  // Prefix sums of rows per day, for "every row of [a, b] is recent".
  const totals = opts.rowsOnDay ?? null;
  const prefix = [0];
  for (const d of days) prefix.push(prefix[prefix.length - 1] + (totals?.get(d) ?? 0));
  const rowsIn = (a: number, b: number) => prefix[b + 1] - prefix[a];
  const markAll = (a: number, b: number) => {
    for (let i = a; i <= b; i += 1) suspect.add(days[i]);
  };
  /** One count, or undefined past the cap (the range is then taken whole). */
  const count = async (a: number, b: number): Promise<number | null | undefined> => {
    if (requests >= opts.maxRequests) return undefined;
    requests += 1;
    return opts.countWrittenSince(days[a], days[b]);
  };
  // Ranges with their count when already known; newest first, iteratively.
  const stack: Array<[number, number, number | null]> = days.length ? [[0, days.length - 1, null]] : [];
  while (stack.length) {
    const [a, b, known] = stack.pop()!;
    const n = known ?? (await count(a, b));
    if (n === null) return null;
    if (n === undefined) {
      capped = true;
      markAll(a, b);
      continue;
    }
    if (n <= 0) continue;
    if (a === b || (totals && n >= rowsIn(a, b))) {
      markAll(a, b);
      continue;
    }
    // Only the newer half is counted: the older one is what is left.
    const mid = Math.floor((a + b) / 2);
    const newer = await count(mid + 1, b);
    if (newer === null) return null;
    if (newer === undefined) {
      capped = true;
      markAll(a, b);
      continue;
    }
    stack.push([a, mid, Math.max(0, n - newer)], [mid + 1, b, newer]);
  }
  return { suspect, capped, requests };
}

const redoOf = (view: ProgressView, kind: string, key: string): Set<string> | undefined =>
  view.redo.get(kind)?.get(key);

function redoSet(view: ProgressView, kind: string, key: string): Set<string> {
  let byAccount = view.redo.get(kind);
  if (!byAccount) {
    byAccount = new Map();
    view.redo.set(kind, byAccount);
  }
  let days = byAccount.get(key);
  if (!days) {
    days = new Set();
    byAccount.set(key, days);
  }
  return days;
}

function doneSet(view: ProgressView, key: string): Set<string> {
  let days = view.done.get(key);
  if (!days) {
    days = new Set();
    view.done.set(key, days);
  }
  return days;
}

/**
 * Days of the window `account` may still have to fetch, oldest first: not
 * done, or flagged and not re-pulled by it yet. Delivery is not considered
 * here - that is what the probe answers (plannedDays). Other accounts' rows
 * play no part.
 */
export function pendingDays(
  view: ProgressView,
  account: string,
  window: HistoryWindow,
  flagged: readonly FlaggedDays[] = []
): string[] {
  const key = progressKey(account);
  const done = view.done.get(key);
  return daysIn(window.from, window.to).filter(
    (d) => !done?.has(d) || flagged.some((f) => f.days.has(d) && !redoOf(view, f.kind, key)?.has(d))
  );
}

interface Coverage {
  from: string;
  to: string;
  active: Set<string>;
}

function coverageOf(answer: DeliveryAnswer | null | undefined): Coverage | null {
  if (!answer || !isDay(answer.from) || !isDay(answer.to) || answer.from > answer.to) return null;
  if (!Array.isArray(answer.active)) return null;
  return { from: answer.from, to: answer.to, active: expandDays(answer.active) };
}

/**
 * What to ask Meta about `pending` (an account's pending days, ascending)
 * that `answer` doesn't cover yet, grown from the edges of what is known so
 * the cache stays one contiguous range: the newer edge whole (days since the
 * last answer), the older edge at most `span` days a run. Without an answer,
 * the `span` days ending at the newest pending day. So a run asks an account
 * at most two ranges (usually one request), however sparse its pending
 * days; older ones come into reach a span per run.
 */
export function probeRanges(
  pending: readonly string[],
  answer: DeliveryAnswer | null | undefined,
  span: number
): Array<{ since: string; until: string }> {
  const days = pending.filter(isDay);
  if (!days.length) return [];
  const step = Math.max(1, Math.floor(span));
  const newest = days[days.length - 1];
  const cov = coverageOf(answer);
  if (!cov) {
    const from = shift(newest, -(step - 1));
    return [{ since: from > days[0] ? from : days[0], until: newest }];
  }
  const out: Array<{ since: string; until: string }> = [];
  if (newest > cov.to) out.push({ since: shift(cov.to, 1), until: newest });
  if (days[0] < cov.from) {
    const from = shift(cov.from, -step);
    out.push({ since: from > days[0] ? from : days[0], until: shift(cov.from, -1) });
  }
  return out;
}

/**
 * Settles what the delivery answer already decides: window days it covers on
 * which the account delivered nothing are done, and flagged ones re-pulled -
 * a paused account has nothing to fetch and must never hold a day open.
 * Folding them into `done` also keeps the record one entry per account
 * instead of one per delivery burst.
 */
export function settleUndelivered(
  view: ProgressView,
  account: string,
  answer: DeliveryAnswer | null | undefined,
  window: HistoryWindow,
  flagged: readonly FlaggedDays[] = []
): void {
  const cov = coverageOf(answer);
  if (!cov) return;
  const from = cov.from > window.from ? cov.from : window.from;
  const to = cov.to < window.to ? cov.to : window.to;
  if (from > to) return;
  const key = progressKey(account);
  const done = doneSet(view, key);
  for (const d of daysIn(from, to)) {
    if (cov.active.has(d)) continue;
    done.add(d);
    for (const f of flagged) {
      if (!f.ignoreDelivery && f.days.has(d)) redoSet(view, f.kind, key).add(d);
    }
  }
}

/**
 * The days `account` fetches this run, newest first, at most `cap`: its
 * pending days it delivered on. A day the answer doesn't cover waits for a
 * later probe - unless the probe failed (`includeUnknown`), then it is
 * fetched anyway (the old, costlier way). Flagged days marked
 * `ignoreDelivery` are fetched whatever the answer says.
 */
export function plannedDays(
  view: ProgressView,
  account: string,
  answer: DeliveryAnswer | null | undefined,
  window: HistoryWindow,
  flagged: readonly FlaggedDays[],
  opts: { includeUnknown: boolean; cap: number }
): string[] {
  const key = progressKey(account);
  const cov = coverageOf(answer);
  const always = flagged.filter((f) => f.ignoreDelivery);
  return pendingDays(view, account, window, flagged)
    .filter(
      (d) =>
        always.some((f) => f.days.has(d) && !redoOf(view, f.kind, key)?.has(d)) ||
        (cov && d >= cov.from && d <= cov.to ? cov.active.has(d) : opts.includeUnknown)
    )
    .reverse()
    .slice(0, Math.max(0, opts.cap));
}

/**
 * Days `account` fetched (and, when they had rows, wrote) this run are done.
 * Days on or after `before` (today: still changing) are left out.
 */
export function markFetched(
  view: ProgressView,
  account: string,
  days: Iterable<string>,
  before: string
): void {
  const done = doneSet(view, progressKey(account));
  for (const d of days) if (isDay(d) && d < before) done.add(d);
}

/** The flagged ones among the days `account` re-pulled count for `kind`. */
export function markRedone(
  view: ProgressView,
  kind: string,
  account: string,
  days: Iterable<string>,
  flagged: ReadonlySet<string>
): void {
  const key = progressKey(account);
  for (const d of days) if (flagged.has(d)) redoSet(view, kind, key).add(d);
}

/**
 * Flagged days every account has re-pulled (or delivered nothing on), in any
 * run: rows still of the old shape there belong to campaigns the platform no
 * longer reports and can be closed. An account that never re-pulled a day
 * (broken access) keeps it open, as before.
 */
export function closableDays(
  view: ProgressView,
  kind: string,
  flagged: ReadonlySet<string>,
  accounts: readonly string[]
): string[] {
  if (!accounts.length) return [];
  const keys = accounts.map(progressKey);
  return [...flagged].filter((d) => keys.every((k) => redoOf(view, kind, k)?.has(d))).sort();
}

/** Nothing of `kind` is flagged any more: its record is no longer needed. */
export function clearRedo(view: ProgressView, kind: string): void {
  view.redo.delete(kind);
}

/**
 * Accounts in history order: never served first (input order), then the one
 * served longest ago. With a fixed order the first account's backlog took
 * every run's history time while the others waited.
 */
export function leastServedFirst<T extends { id: string }>(
  accounts: readonly T[],
  order: readonly string[] | null | undefined
): T[] {
  const rank = new Map((order ?? []).map((key, i) => [progressKey(key), i]));
  return accounts
    .map((a, index) => ({ a, index, r: rank.get(progressKey(a.id)) ?? -1 }))
    .sort((x, y) => x.r - y.r || x.index - y.index)
    .map((x) => x.a);
}

/** Accounts whose history ran this run go to the back, in the order served. */
export function markServed(view: ProgressView, served: Iterable<string>): void {
  const list = [...new Set([...served].map(progressKey))];
  if (!list.length) return;
  const set = new Set(list);
  view.order = [...view.order.filter((key) => !set.has(key)), ...list];
}
