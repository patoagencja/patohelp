import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Small per-client sync bookkeeping that has no column of its own: which days
 * an ad account delivered on (learned once a day), when the mature-day
 * re-pull last ran per account, when a one-time history re-pull last found
 * nothing to do, when creatives were last refreshed.
 *
 * ads_daily has no updated_at, and asking Meta/Google again on every 30-minute
 * tick was the cost being cut, so these answers are cached in report_cache
 * (migration 0013: per-client jsonb, RLS on with no policy = service role
 * only) under "sync:" keys - no migration needed. Every reader treats a
 * failed read as "unknown" and falls back to the old, more expensive path;
 * a failed write only means the next run asks again.
 */

const TABLE = "report_cache";

/** When ad set rows last changed for a client - keys the goal cache (lib/alerts/pacing.ts). */
export const ADSETS_STAMP_KEY = "adsets-stamp";
const prefix = (key: string) => `sync:${key}`;

export interface SyncStateRead<T> {
  /** False when the store itself could not be read (fall back). */
  ok: boolean;
  value: T | null;
}

export async function readSyncState<T>(
  admin: SupabaseClient,
  clientId: string,
  key: string
): Promise<SyncStateRead<T>> {
  try {
    const { data, error } = await admin
      .from(TABLE)
      .select("payload")
      .eq("client_id", clientId)
      .eq("cache_key", prefix(key))
      .maybeSingle();
    if (error) return { ok: false, value: null };
    return { ok: true, value: ((data?.payload as T | undefined) ?? null) };
  } catch {
    return { ok: false, value: null };
  }
}

/** One key for many clients in a single round trip; null when unreadable. */
export async function readSyncStates<T>(
  admin: SupabaseClient,
  clientIds: string[],
  key: string
): Promise<Map<string, T> | null> {
  const out = new Map<string, T>();
  if (!clientIds.length) return out;
  try {
    const { data, error } = await admin
      .from(TABLE)
      .select("client_id, payload")
      .in("client_id", clientIds)
      .eq("cache_key", prefix(key));
    if (error) return null;
    for (const r of data ?? []) out.set(String(r.client_id), r.payload as T);
    return out;
  } catch {
    return null;
  }
}

export async function writeSyncState(
  admin: SupabaseClient,
  clientId: string,
  key: string,
  value: unknown
): Promise<boolean> {
  try {
    const { error } = await admin.from(TABLE).upsert(
      {
        client_id: clientId,
        cache_key: prefix(key),
        payload: value as Record<string, unknown>,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "client_id,cache_key" }
    );
    if (error) console.warn("[sync-state] write failed", key, error.message);
    return !error;
  } catch (err) {
    console.warn("[sync-state] write failed", key, err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Days each ad account delivered on, learned from one cheap account-level
 * query. Every caller asks about days up to D-2 at the latest, and a past
 * day doesn't gain delivery after the fact, so answers are kept for good and
 * only the part of a range never asked about is asked. (They used to be
 * dropped every Warsaw day: re-asking a year for each of DRE's 46 accounts
 * never finished inside a run's history time, so after a Meta outage the
 * missing weeks were never filled.)
 */
export interface ActiveDayCache {
  /** Warsaw day of the last answer (informational). */
  day: string;
  /**
   * `active` lists days, or "from..to" runs of consecutive days (written
   * compactly: a year of daily delivery is one entry, not 365).
   */
  byAccount: Record<string, { from: string; to: string; active: string[] }>;
}

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const nextDay = (iso: string) => isoDay(dayMs(iso) + DAY_MS);
const prevDay = (iso: string) => isoDay(dayMs(iso) - DAY_MS);

function expandActive(list: readonly unknown[]): Set<string> {
  const out = new Set<string>();
  for (const item of list) {
    if (typeof item !== "string") continue;
    const [a, b] = item.split("..");
    if (!b) {
      out.add(a);
      continue;
    }
    for (let d = a; d <= b; d = nextDay(d)) out.add(d);
  }
  return out;
}

function compactActive(days: Iterable<string>): string[] {
  const sorted = [...new Set(days)].sort();
  const out: string[] = [];
  let start: string | null = null;
  let prev: string | null = null;
  const flush = () => {
    if (start === null || prev === null) return;
    out.push(start === prev ? start : `${start}..${prev}`);
  };
  for (const d of sorted) {
    if (prev !== null && d === nextDay(prev)) {
      prev = d;
      continue;
    }
    flush();
    start = d;
    prev = d;
  }
  flush();
  return out;
}

/** The cached active days of `account` covering [from, to], or null. */
export function cachedActiveDays(
  cache: ActiveDayCache | null | undefined,
  _today: string,
  account: string,
  from: string,
  to: string
): Set<string> | null {
  const hit = cache?.byAccount?.[account];
  if (!hit || hit.from > from || hit.to < to || !Array.isArray(hit.active)) return null;
  const all = expandActive(hit.active);
  return new Set([...all].filter((d) => d >= from && d <= to));
}

/**
 * The parts of [from, to] the cache has no answer for: none, the whole
 * range, or the edge(s) on either side of what it knows. Asking only these
 * keeps a probe that already covered a year to a few new days.
 */
export function unknownActiveRanges(
  cache: ActiveDayCache | null | undefined,
  account: string,
  from: string,
  to: string
): Array<{ since: string; until: string }> {
  if (from > to) return [];
  const hit = cache?.byAccount?.[account];
  const usable = hit && Array.isArray(hit.active) && hit.from <= hit.to;
  // No answer, or one that doesn't touch the range: ask for all of it.
  if (!usable || hit.to < prevDay(from) || hit.from > nextDay(to)) return [{ since: from, until: to }];
  const out: Array<{ since: string; until: string }> = [];
  if (from < hit.from) out.push({ since: from, until: prevDay(hit.from) });
  if (to > hit.to) out.push({ since: nextDay(hit.to), until: to });
  return out;
}

/**
 * `cache` with `account`'s answer for [from, to] merged in. An answer next
 * to or overlapping the one already kept extends it; one that doesn't
 * touch it replaces it (the cache keeps one contiguous range per account).
 */
export function rememberActiveDays(
  cache: ActiveDayCache | null | undefined,
  today: string,
  account: string,
  from: string,
  to: string,
  active: Set<string>
): ActiveDayCache {
  const byAccount = { ...(cache?.byAccount ?? {}) };
  const fresh = [...active].filter((d) => d >= from && d <= to);
  const hit = byAccount[account];
  const touches =
    hit && Array.isArray(hit.active) && hit.from <= hit.to && hit.to >= prevDay(from) && hit.from <= nextDay(to);
  if (touches) {
    // The new answer wins for its own days; the rest of the old one stays.
    const kept = [...expandActive(hit.active)].filter((d) => d < from || d > to);
    byAccount[account] = {
      from: hit.from < from ? hit.from : from,
      to: hit.to > to ? hit.to : to,
      active: compactActive([...kept, ...fresh]),
    };
  } else {
    byAccount[account] = { from, to, active: compactActive(fresh) };
  }
  return { day: today, byAccount };
}

/** True when `iso` is missing or older than `maxAgeMs`. */
export function isDue(iso: string | null | undefined, maxAgeMs: number, now = Date.now()): boolean {
  if (!iso) return true;
  const t = Date.parse(iso);
  return !Number.isFinite(t) || now - t > maxAgeMs;
}

/**
 * When each of a client's ad accounts was last processed by a cron that
 * works through accounts under a time budget (refresh-creatives-meta).
 * `at` is the old client-level stamp; it is no longer used for ordering.
 */
export interface AccountRotationState {
  at?: string;
  accounts?: Record<string, string>;
}

/**
 * Work items, one per (client, account), in the order a budgeted run should
 * take them: accounts never processed first, then the least recently
 * processed; ties keep their input order. A run cut short by its budget
 * leaves the accounts it did not reach at the head of the next run - with a
 * per-client stamp every run restarted DRE at its first account, and its
 * later accounts were never refreshed.
 */
export function oldestAccountsFirst<T extends { clientId: string; accountId: string }>(
  items: readonly T[],
  states: ReadonlyMap<string, AccountRotationState> | null | undefined
): T[] {
  const lastAt = (item: T): number => {
    const iso = states?.get(item.clientId)?.accounts?.[item.accountId];
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(t) ? t : 0;
  };
  return items
    .map((item, index) => ({ item, index, t: lastAt(item) }))
    .sort((a, b) => a.t - b.t || a.index - b.index)
    .map((x) => x.item);
}

/** `state` with the given accounts' processing times (account id -> ISO). */
export function markAccountsProcessed(
  state: AccountRotationState | null | undefined,
  stamps: Iterable<[string, string]>
): AccountRotationState {
  const accounts = { ...(state?.accounts ?? {}) };
  for (const [id, iso] of stamps) accounts[id] = iso;
  return { accounts };
}
