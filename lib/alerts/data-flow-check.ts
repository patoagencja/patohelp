import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidateTag } from "next/cache";

import {
  addDaysIso,
  cartBaselineFrom,
  cartTodayFrom,
  checkDue,
  dailyDue,
  FLOW_GUARDS,
  FLOW_STATE_KEY,
  inGuardHours,
  localClock,
  metaBaselineFrom,
  profileFrom,
  runFlowCheck,
  type EcomHourRow,
  type FlowInput,
  type FlowState,
} from "@/lib/alerts/data-flow";
import { warsawOffsetMin } from "@/lib/alerts/data-flow-read";
import { clientDataTag } from "@/lib/dashboard/sync-cache";
import { describeError } from "@/lib/integrations/errors";
import { getEcommerceByHour, getRealtimeActivity, type Ga4Auth } from "@/lib/integrations/ga4";
import { readSyncState, writeSyncState } from "@/lib/integrations/sync-state";
import { fetchAll } from "@/lib/supabase/fetch-all";

// The reads and GA4 calls behind the intraday data-flow guards; the rules are
// in lib/alerts/data-flow.ts (pure). Run by refresh-ga4 after its sync, once
// per client per run, 7:00-22:59 only. Per GA4 property and run that is:
//  - 1 Realtime API call (only when the client's ads clicked today), and
//  - shops: 1 Data API report of today's e-commerce per hour (once a day it
//    reaches 4 weeks back, for the same-weekday baseline).
// Everything else is already in Supabase (ads_daily of today, the activity
// heatmap, Meta's last sync, the shop's pushes). The state - baselines,
// readings, open incidents - is one report_cache row per client (sync-state).

/** Clients checked side by side. */
const CONCURRENCY = 4;

export interface FlowJob {
  clientId: string;
  auth: Ga4Auth;
  propertyIds: string[];
}

export interface FlowRunSummary {
  checked: number;
  /** Incidents open after this run (all clients). */
  open: number;
  errors: string[];
}

interface AdsToday {
  /** Every provider's clicks so far today. */
  clicks: number;
  /** Meta's link clicks and purchases (null when a row has no purchase count). */
  meta: { clicks: number; purchases: number | null } | null;
}

async function readAdsToday(admin: SupabaseClient, clientId: string, today: string): Promise<AdsToday | null> {
  try {
    const rows = await fetchAll<{ provider: string; clicks: unknown; purchases: unknown }>((from, to) =>
      admin
        .from("ads_daily")
        .select("provider, clicks, purchases:raw_data->purchases")
        .eq("client_id", clientId)
        .eq("date", today)
        .order("provider", { ascending: true })
        .order("campaign_id", { ascending: true })
        .range(from, to)
    );
    let clicks = 0;
    let metaRows = 0;
    let metaClicks = 0;
    let metaPurchases: number | null = 0;
    for (const r of rows) {
      const c = Number(r.clicks) || 0;
      clicks += c;
      if (r.provider !== "meta_ads") continue;
      metaRows += 1;
      metaClicks += c;
      const p = Number(r.purchases);
      metaPurchases =
        metaPurchases === null || r.purchases === null || r.purchases === undefined || !Number.isFinite(p)
          ? null
          : metaPurchases + p;
    }
    return { clicks, meta: metaRows ? { clicks: metaClicks, purchases: metaPurchases } : null };
  } catch (err) {
    console.warn(`[data-flow] ads of today for ${clientId} failed`, describeError(err));
    return null;
  }
}

/** Sessions per hour of today's weekday from the newest heatmap snapshot (null: none). */
async function readProfileRows(
  admin: SupabaseClient,
  clientId: string,
  weekday: number
): Promise<Array<{ hour: number; sessions: number }> | null> {
  const { data, error } = await admin
    .from("ga4_activity_heatmap")
    .select("snapshot_date, hour, sessions")
    .eq("client_id", clientId)
    .eq("day_of_week", weekday)
    .order("snapshot_date", { ascending: false })
    .limit(24);
  if (error || !data?.length) return null;
  const newest = data[0].snapshot_date;
  return data
    .filter((r) => r.snapshot_date === newest)
    .map((r) => ({ hour: Number(r.hour), sessions: Number(r.sessions) || 0 }));
}

/** Meta clicks and purchases on the same weekday 1..4 weeks back (null: read failed). */
async function readMetaBaseRows(
  admin: SupabaseClient,
  clientId: string,
  today: string
): Promise<Array<{ date: string; clicks: number; purchases: number | null }> | null> {
  try {
    const dates = [1, 2, 3, 4].map((w) => addDaysIso(today, -7 * w));
    const rows = await fetchAll<{ date: string; clicks: unknown; purchases: unknown }>((from, to) =>
      admin
        .from("ads_daily")
        .select("date, clicks, purchases:raw_data->purchases")
        .eq("client_id", clientId)
        .eq("provider", "meta_ads")
        .in("date", dates)
        .order("date", { ascending: true })
        .order("campaign_id", { ascending: true })
        .range(from, to)
    );
    return rows.map((r) => {
      const p = Number(r.purchases);
      return {
        date: r.date,
        clicks: Number(r.clicks) || 0,
        purchases: r.purchases === null || r.purchases === undefined || !Number.isFinite(p) ? null : p,
      };
    });
  } catch {
    return null;
  }
}

/** When Meta's numbers were last synced successfully (null: never / unreadable). */
async function readMetaSyncedAt(admin: SupabaseClient, clientId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("sync_runs")
    .select("finished_at")
    .eq("client_id", clientId)
    .eq("provider", "meta_ads")
    .eq("status", "success")
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return error ? null : ((data?.finished_at as string | undefined) ?? null);
}

/** The shop's last sales push (shop_ingest_keys, migration 0038); null: no feed. */
async function readLastPush(admin: SupabaseClient, clientId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("shop_ingest_keys")
    .select("last_used_at")
    .eq("client_id", clientId)
    .maybeSingle();
  return error ? null : ((data?.last_used_at as string | null | undefined) ?? null);
}

/** Paid orders the shop pushed for today: sum and row count (null: unreadable). */
async function readShopOrdersToday(
  admin: SupabaseClient,
  clientId: string,
  today: string
): Promise<{ orders: number; rows: number } | null> {
  const { data, error } = await admin
    .from("shop_sales_daily")
    .select("orders")
    .eq("client_id", clientId)
    .eq("date", today)
    .limit(5000);
  if (error) return null;
  return { orders: (data ?? []).reduce((a, r) => a + (Number(r.orders) || 0), 0), rows: data?.length ?? 0 };
}

/** GA4 realtime summed over the client's properties; null when any call fails. */
async function readRealtime(job: FlowJob): Promise<{ users: number; events: number } | null> {
  try {
    const parts = await Promise.all(job.propertyIds.map((id) => getRealtimeActivity(job.auth, id)));
    return parts.reduce((a, p) => ({ users: a.users + p.users, events: a.events + p.events }), { users: 0, events: 0 });
  } catch (err) {
    console.warn(`[data-flow] realtime for ${job.clientId} failed`, describeError(err));
    return null;
  }
}

async function readEcommerce(job: FlowJob, startDate: string, endDate: string): Promise<EcomHourRow[] | null> {
  try {
    const parts = await Promise.all(
      job.propertyIds.map((id) => getEcommerceByHour(job.auth, id, { startDate, endDate }))
    );
    return parts.flat();
  } catch (err) {
    console.warn(`[data-flow] e-commerce by hour for ${job.clientId} failed`, describeError(err));
    return null;
  }
}

/** One client's check. Returns the incidents open after it, or null when skipped. */
async function checkClient(admin: SupabaseClient, job: FlowJob, shop: boolean, now: Date): Promise<number | null> {
  const nowIso = now.toISOString();
  const offset = warsawOffsetMin(now);
  const clock = localClock(nowIso, offset);
  // Night: no calls, nothing written. Open incidents fade on their own.
  if (!inGuardHours(clock.hour)) return null;

  const read = await readSyncState<FlowState>(admin, job.clientId, FLOW_STATE_KEY);
  // An unreadable store would cost the baselines and every "in a row".
  if (!read.ok) return null;
  const prev = read.value;
  if (!checkDue(prev, nowIso)) return null;
  const today = clock.day;
  const due = dailyDue(prev, today);

  const [ads, profileRows, metaBaseRows, metaSyncedAt, lastPushAt, shopOrders] = await Promise.all([
    readAdsToday(admin, job.clientId, today),
    due.profile ? readProfileRows(admin, job.clientId, clock.weekday) : Promise.resolve(undefined),
    shop && due.metaBase ? readMetaBaseRows(admin, job.clientId, today) : Promise.resolve(undefined),
    shop ? readMetaSyncedAt(admin, job.clientId) : Promise.resolve(null),
    shop ? readLastPush(admin, job.clientId) : Promise.resolve(null),
    shop ? readShopOrdersToday(admin, job.clientId, today) : Promise.resolve(null),
  ]);

  // Realtime only matters while the ads send people: a client without ads
  // today can't trip the guard, so it costs no call.
  const adClicksToday = ads ? ads.clicks : null;
  const [realtime, ecom] = await Promise.all([
    adClicksToday !== null && adClicksToday > 0 ? readRealtime(job) : Promise.resolve(null),
    shop ? readEcommerce(job, due.cartBase ? addDaysIso(today, -28) : today, today) : Promise.resolve(null),
  ]);

  // No rows for today is "no orders yet" only when the shop has pushed today.
  const pushedToday = lastPushAt ? localClock(lastPushAt, offset).day === today : false;
  const ordersToday = shopOrders && (shopOrders.rows > 0 || pushedToday) ? shopOrders.orders : null;

  const input: FlowInput = {
    now: nowIso,
    utcOffsetMin: offset,
    shop,
    realtime,
    adClicksToday,
  };
  if (profileRows !== undefined) input.profile = profileRows ? profileFrom(profileRows) : null;
  if (shop) {
    input.cartToday = ecom ? cartTodayFrom(ecom, today) : null;
    if (due.cartBase) input.cartBase = ecom ? cartBaselineFrom(ecom, today) : null;
    if (metaBaseRows !== undefined) input.metaBase = metaBaseRows ? metaBaselineFrom(metaBaseRows, today) : null;
    input.meta = ads?.meta
      ? { clicksToday: ads.meta.clicks, purchasesToday: ads.meta.purchases, syncedAt: metaSyncedAt }
      : null;
    input.shopOrdersToday = ordersToday;
    input.lastPushAt = lastPushAt;
  }

  let result: ReturnType<typeof runFlowCheck>;
  try {
    result = runFlowCheck(prev, input);
  } catch (err) {
    // A stored state this code can't read must not stop the guard for good:
    // start over (the baselines are re-learned).
    console.warn(`[data-flow] state of ${job.clientId} unreadable, starting over`, describeError(err));
    result = runFlowCheck(null, input);
  }
  const { state, verdicts } = result;
  const saved = await writeSyncState(admin, job.clientId, FLOW_STATE_KEY, state);
  const open = FLOW_GUARDS.filter((g) => state.guards?.[g]?.open);
  // The dashboard's alert scan is cached per sync stamp, and this run's
  // stamp was written before the check: an incident that opened or closed
  // would wait for the next sync to show. Only on a change - rare.
  const openIds = (s: FlowState | null) =>
    FLOW_GUARDS.map((g) => s?.guards?.[g]?.open?.id ?? "").join("|");
  if (saved && openIds(prev) !== openIds(state)) {
    try {
      revalidateTag(clientDataTag(job.clientId));
    } catch {
      // outside a Next request (scripts): nothing cached to refresh
    }
  }
  if (open.length) {
    console.info(
      `[data-flow] ${job.clientId}: open ${open.join(", ")}`,
      JSON.stringify(Object.fromEntries(open.map((g) => [g, verdicts[g]])))
    );
  }
  return open.length;
}

/**
 * Checks every client refresh-ga4 just synced. Never throws: a guard must
 * not cost the sync anything. `startBy` (epoch ms): no client is started
 * after it, so the function ends inside its time limit.
 */
export async function runDataFlowChecks(
  admin: SupabaseClient,
  jobs: readonly FlowJob[],
  opts: { startBy: number; now?: Date }
): Promise<FlowRunSummary> {
  const summary: FlowRunSummary = { checked: 0, open: 0, errors: [] };
  if (!jobs.length) return summary;
  const now = opts.now ?? new Date();
  if (!inGuardHours(localClock(now.toISOString(), warsawOffsetMin(now)).hour)) return summary;

  // Shops run the cart, pixel and feed guards; everyone else only GA4 (and
  // never reads a sales word). Unreadable types: GA4 only, for everyone.
  const shops = new Set<string>();
  const { data: types, error } = await admin
    .from("clients")
    .select("id, client_type")
    .in(
      "id",
      jobs.map((j) => j.clientId)
    );
  if (error) summary.errors.push(`client types: ${error.message}`);
  for (const t of types ?? []) if (t.client_type === "ecommerce") shops.add(t.id as string);

  let cursor = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      if (Date.now() > opts.startBy) return;
      try {
        const open = await checkClient(admin, job, shops.has(job.clientId), now);
        if (open !== null) {
          summary.checked += 1;
          summary.open += open;
        }
      } catch (err) {
        const message = describeError(err);
        console.error(`[data-flow] check for ${job.clientId} failed`, message);
        summary.errors.push(`${job.clientId}: ${message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  return summary;
}
