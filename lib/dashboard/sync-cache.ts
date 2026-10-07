import { unstable_cache } from "next/cache";
import { formatInTimeZone } from "date-fns-tz";

import { getLastSyncAt } from "@/lib/dashboard/context";
import { perfNote } from "@/lib/supabase/perf";

// Shared cache for expensive per-client aggregates that only change when a
// sync lands (crons every ~10-30 min per provider). Every navigation and
// every AutoRefresh used to recompute them from tens of thousands of
// ads_daily rows; now one computation per (client, arguments, sync stamp,
// Warsaw day) is shared by every page, viewer and tab until the next sync.
//
// Rules - keep them when adding a loader:
// - The key ALWAYS holds the client id and the newest successful sync
//   (getLastSyncAt): a new sync means a new key, so fresh data never waits
//   for a TTL. The Warsaw day is in the key because ranges and "today" maths
//   resolve against it.
// - `load` reads with the service-role client (unstable_cache can't touch
//   cookies). Call these wrappers ONLY with a client id the viewer was
//   verified to see through RLS (getClientBySlug), never with an id taken
//   from the request.
// - Only data derived from synced tables (ads_daily, ga4_daily, ...) goes
//   in. Anything the user edits (budgets, goals, caps, flights) is read live
//   or made part of the key.
// - Results must be JSON-safe (no Map/Date/undefined-that-matters): the
//   cache stores JSON. Entries over 2 MB are silently not cached.
// - The TTL is only a safety net for writes that don't produce a sync stamp
//   (a failed sync that wrote some rows); settings actions that delete
//   synced rows call revalidateTag(clientDataTag(id)).

const VERSION = "sync-v1";
const TTL_SECONDS = 15 * 60;

export const clientDataTag = (clientId: string) => `client-data:${clientId}`;

const warsawToday = () => formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");

/**
 * `load()` once per (name, client, args, sync stamp, day); cached across
 * requests. `args` must be JSON-serializable and fully describe what `load`
 * computes besides the client.
 */
export async function syncCached<T>(
  name: string,
  clientId: string,
  args: ReadonlyArray<string | number | boolean | null>,
  load: () => Promise<T>
): Promise<T> {
  const stamp = await getLastSyncAt(clientId).catch(() => null);
  // No successful sync yet (or the stamp read failed): nothing to key a
  // fresh result on, and there is little data anyway - read live.
  if (!stamp) return load();

  let computed = false;
  const cached = unstable_cache(
    async () => {
      computed = true;
      return load();
    },
    [VERSION, name, clientId, stamp, warsawToday(), JSON.stringify(args)],
    { revalidate: TTL_SECONDS, tags: [clientDataTag(clientId)] }
  );
  try {
    const out = await cached();
    perfNote(`${name} ${computed ? "MISS" : "hit"}`);
    return out;
  } catch (err) {
    // Outside a Next request (scripts) there is no incremental cache; a
    // failure inside load() itself is rethrown as before.
    if (!computed && /incrementalCache missing/i.test(String((err as Error)?.message))) {
      return load();
    }
    throw err;
  }
}
