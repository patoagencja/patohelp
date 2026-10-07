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
 * query and reused for the rest of that Warsaw day. Past days don't gain
 * delivery after the fact, so a day-old answer is safe; a new day (or a new
 * account) asks again.
 */
export interface ActiveDayCache {
  /** Warsaw day the answers were learned on. */
  day: string;
  byAccount: Record<string, { from: string; to: string; active: string[] }>;
}

/** The cached active days of `account` covering [from, to], or null. */
export function cachedActiveDays(
  cache: ActiveDayCache | null | undefined,
  today: string,
  account: string,
  from: string,
  to: string
): Set<string> | null {
  if (!cache || cache.day !== today) return null;
  const hit = cache.byAccount?.[account];
  if (!hit || hit.from > from || hit.to < to || !Array.isArray(hit.active)) return null;
  return new Set(hit.active);
}

/** `cache` with `account`'s fresh answer (other days' entries dropped). */
export function rememberActiveDays(
  cache: ActiveDayCache | null | undefined,
  today: string,
  account: string,
  from: string,
  to: string,
  active: Set<string>
): ActiveDayCache {
  const base: ActiveDayCache =
    cache && cache.day === today ? cache : { day: today, byAccount: {} };
  return {
    day: today,
    byAccount: {
      ...base.byAccount,
      [account]: { from, to, active: [...active].filter((d) => d >= from && d <= to).sort() },
    },
  };
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
