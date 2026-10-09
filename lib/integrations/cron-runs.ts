import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Run bookkeeping shared by the time-budgeted crons (refresh-ads-meta,
 * refresh-ads-google, refresh-demographics): which clients and accounts go
 * first, cleaning up after killed runs, and the cheap "which days do we
 * already have" read the history logic starts from.
 *
 * Keep runtime imports out of this file: its unit tests run it directly under
 * Node's type stripping, which can't resolve the "@/" alias.
 */

/**
 * A "running" sync_runs row older than this belongs to a function that was
 * killed: no cron has a maxDuration above 300 s, so nothing still alive can
 * be this old.
 */
export const STALE_RUN_MINUTES = 15;
export const STALE_RUN_MESSAGE = "Synchronizacja przerwana (przekroczony limit czasu).";

/**
 * Close every sync_runs row left on "running" by a killed function (all
 * providers - it is one cheap UPDATE). Without it such a row stayed
 * "running" for ever and the health check had to guess what happened.
 * Never throws: a failed sweep must not stop the sync that called it.
 */
export async function closeStaleRuns(admin: SupabaseClient, now = Date.now()): Promise<void> {
  try {
    const { error } = await admin
      .from("sync_runs")
      .update({
        status: "failed",
        finished_at: new Date(now).toISOString(),
        error_message: STALE_RUN_MESSAGE,
      })
      .eq("status", "running")
      .lt("started_at", new Date(now - STALE_RUN_MINUTES * 60_000).toISOString());
    if (error) console.warn("[cron-runs] closing stale runs failed", error.message);
  } catch (err) {
    console.warn("[cron-runs] closing stale runs failed", err instanceof Error ? err.message : err);
  }
}

/**
 * client id -> epoch ms of its newest `provider` run that was actually
 * started (any outcome), in ONE query. Attempts, not successes: ordered by
 * the last success, a client that keeps failing (two Google accounts at the
 * 25 s cap) led every run and its timeouts used up the deadline of all the
 * others. Rows carrying `skipMessage` (left out unasked, e.g. an app-wide
 * Meta limit) don't count as a turn. A client missing from the map was not
 * started within the rows read, which is exactly what the ordering below
 * needs. null = unreadable (keep the input order).
 */
export async function newestAttemptByClient(
  admin: SupabaseClient,
  provider: string,
  clientIds: readonly string[],
  skipMessage?: string
): Promise<Map<string, number> | null> {
  const out = new Map<string, number>();
  if (clientIds.length < 2) return out;
  try {
    const { data, error } = await admin
      .from("sync_runs")
      .select("client_id, started_at, error_message")
      .eq("provider", provider)
      .in("client_id", [...clientIds])
      .order("started_at", { ascending: false })
      .limit(1000);
    if (error) return null;
    for (const r of data ?? []) {
      const id = String(r.client_id);
      if (out.has(id)) continue;
      if (skipMessage && r.error_message === skipMessage) continue;
      const t = Date.parse(String(r.started_at));
      if (Number.isFinite(t)) out.set(id, t);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * client id -> epoch ms of an ISO stamp kept in each client's sync state
 * (e.g. when its history last had the run's first turn). Missing or invalid
 * stamps are left out, so leastRecentFirst puts those clients first.
 */
export function stampsByClient<S>(
  states: ReadonlyMap<string, S> | null,
  stampOf: (state: S) => string | undefined
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, state] of states ?? []) {
    const raw = state ? stampOf(state) : undefined;
    const t = raw ? Date.parse(raw) : NaN;
    if (Number.isFinite(t)) out.set(id, t);
  }
  return out;
}

/**
 * `items` with the least recently served client first: unknown (never, or
 * beyond what was read) first, then oldest; ties keep the input order. A run
 * cut short by its deadline leaves the clients it never started at the head
 * of the next run instead of starving the same ones every time. The same
 * ordering hands out history turns (stampsByClient).
 */
export function leastRecentFirst<T>(
  items: readonly T[],
  clientIdOf: (item: T) => string,
  newest: ReadonlyMap<string, number> | null | undefined
): T[] {
  return items
    .map((item, index) => ({ item, index, t: newest?.get(clientIdOf(item)) ?? 0 }))
    .sort((a, b) => a.t - b.t || a.index - b.index)
    .map((x) => x.item);
}

/**
 * A client's accounts with the ones the previous run had to leave out
 * (deadline) first, in their stored order, then the rest in input order.
 * Each run then continues where the last one stopped, so the tail of a
 * 46-account client is never left without today's numbers.
 */
export function deferredFirst<T extends { id: string }>(
  accounts: readonly T[],
  deferred: readonly string[] | null | undefined
): T[] {
  if (!deferred?.length) return [...accounts];
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const head = deferred.map((id) => byId.get(id)).filter((a): a is T => a !== undefined);
  const inHead = new Set(head.map((a) => a.id));
  return [...head, ...accounts.filter((a) => !inHead.has(a.id))];
}

const shiftDay = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Date ranges cut into pieces of at most `maxDays`, newest first. A history
 * query has a timeout now; a 15-month range that never finishes inside it
 * would be retried (and time out) on every run, so long ranges go out as
 * pieces that each complete and stop counting as missing.
 */
export function splitRanges(
  ranges: ReadonlyArray<{ since: string; until: string }>,
  maxDays: number
): Array<{ since: string; until: string }> {
  const out: Array<{ since: string; until: string }> = [];
  const step = Math.max(1, Math.floor(maxDays));
  for (const r of ranges) {
    let until = r.until;
    while (until >= r.since) {
      const from = shiftDay(until, -(step - 1));
      const since = from < r.since ? r.since : from;
      out.push({ since, until });
      until = shiftDay(since, -1);
    }
  }
  return out;
}

/**
 * Rows in write chunks of at most `max`, cut only between days (one day is
 * split only when it alone holds more than `max` rows). A day counts as
 * present once any row of it exists, so a function killed between two
 * chunks that cut through a day left that day half-written for good.
 */
export function chunkByDay<T>(rows: readonly T[], dateOf: (row: T) => string, max: number): T[][] {
  const byDay = new Map<string, T[]>();
  for (const row of rows) {
    const day = dateOf(row);
    const list = byDay.get(day);
    if (list) list.push(row);
    else byDay.set(day, [row]);
  }
  const size = Math.max(1, Math.floor(max));
  const chunks: T[][] = [];
  let current: T[] = [];
  for (const day of [...byDay.keys()].sort().reverse()) {
    const dayRows = byDay.get(day) ?? [];
    if (current.length && current.length + dayRows.length > size) {
      chunks.push(current);
      current = [];
    }
    for (let i = 0; i < dayRows.length; i += size) {
      const part = dayRows.slice(i, i + size);
      if (current.length + part.length > size) {
        chunks.push(current);
        current = [];
      }
      current.push(...part);
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

const PAGE = 1000;

/**
 * Every date since `fromDate` with at least one ads_daily row for the
 * client and provider. Read from the ads_daily_totals view (migration 0036:
 * one row per client, provider and day - a year is one request) instead of
 * paging through every campaign row: for OLX that was ~170 sequential round
 * trips, 20-40 s, before any syncing started. A database without the view
 * (or any error reading it) falls back to the raw rows.
 */
export async function presentAdDates(
  admin: SupabaseClient,
  clientId: string,
  provider: string,
  fromDate: string
): Promise<Set<string>> {
  try {
    const present = new Set<string>();
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await admin
        .from("ads_daily_totals")
        .select("date")
        .eq("client_id", clientId)
        .eq("provider", provider)
        .gte("date", fromDate)
        .order("date", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) present.add(String(r.date).slice(0, 10));
      if (!data || data.length < PAGE) return present;
    }
  } catch (err) {
    console.warn(
      "[cron-runs] ads_daily_totals unreadable, reading raw rows",
      err instanceof Error ? err.message : err
    );
  }

  const present = new Set<string>();
  for (let offset = 0; ; offset += PAGE) {
    const { data } = await admin
      .from("ads_daily")
      .select("date")
      .eq("client_id", clientId)
      .eq("provider", provider)
      .gte("date", fromDate)
      .order("date", { ascending: true })
      .range(offset, offset + PAGE - 1);
    for (const r of data ?? []) present.add(r.date as string);
    if (!data || data.length < PAGE) break;
  }
  return present;
}
