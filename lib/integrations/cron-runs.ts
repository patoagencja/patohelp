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
 * client id -> epoch ms of its newest successful `provider` run, in ONE
 * query over the newest successes. A client missing from the map has its
 * last success older than every row read (or none at all), which is exactly
 * what the ordering below needs. null = unreadable (keep the input order).
 */
export async function newestSuccessByClient(
  admin: SupabaseClient,
  provider: string,
  clientIds: readonly string[]
): Promise<Map<string, number> | null> {
  const out = new Map<string, number>();
  if (clientIds.length < 2) return out;
  try {
    const { data, error } = await admin
      .from("sync_runs")
      .select("client_id, finished_at")
      .eq("provider", provider)
      .eq("status", "success")
      .in("client_id", [...clientIds])
      .not("finished_at", "is", null)
      .order("finished_at", { ascending: false })
      .limit(1000);
    if (error) return null;
    for (const r of data ?? []) {
      const id = String(r.client_id);
      if (out.has(id)) continue;
      const t = Date.parse(String(r.finished_at));
      if (Number.isFinite(t)) out.set(id, t);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * `items` with the least recently served client first: unknown (never, or
 * beyond what was read) first, then oldest; ties keep the input order. A run
 * cut short by its deadline leaves the clients it never started at the head
 * of the next run instead of starving the same ones every time.
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
