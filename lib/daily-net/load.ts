import { getAdsDayTotals } from "@/lib/dashboard/ads-totals";
import { syncCached } from "@/lib/dashboard/sync-cache";
import { blackFriday } from "@/lib/ecom/insights";
import { shopPushStamp } from "@/lib/season/load";
import { isMissingTableError } from "@/lib/shop/parse";
import { getShopSales, getShopSalesCoverage } from "@/lib/shop/sales";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";

import {
  type ApiChannel,
  buildDailyNetView,
  type CompareMode,
  type DailyNetView,
  MANUAL_CHANNELS,
  mergeDayInputs,
  type NetRange,
  PROVIDER_CHANNEL,
  readWindows,
  yearsOf,
} from "./calc";
import { cellKey } from "./paste";

// Read side of "Wynik dzień po dniu". Service-role reads: call ONLY with a
// client id the viewer was verified to see (getClientBySlug), never with one
// taken from the request. Nothing here calls Meta, Google or the shop - it
// reads what the crons and the shop feed already wrote to Supabase.

/** The migration that creates manual_ad_costs (named on the page until it runs). */
export const MANUAL_COSTS_MIGRATION = "0046_manual_ad_costs.sql";

type Window = { start: string; end: string };

interface SyncedDays {
  /** False until the shop sales migration (0038) has run. */
  shopAvailable: boolean;
  /** First / last day the shop ever reported (null = never). */
  shopFirst: string | null;
  shopLast: string | null;
  /** Shop revenue per day, grosze (only days the shop reported). */
  revenue: Record<string, number>;
  /** Integration spend per day and channel, grosze (only days with rows). */
  api: Record<string, Partial<Record<ApiChannel, number>>>;
}

/**
 * Shop revenue and integration spend for the windows. The revenue is the
 * shop's own daily total (lib/shop/sales getShopSales().days): the ingest
 * stores each day at ONE level of detail (per market/product or one "all"
 * row - mixedGranularityDate rejects a mix, and every push or CSV upload
 * replaces its days first), so summing a day's rows never counts an order
 * twice. Cached per sync stamp and shop push like the season view.
 */
async function readSyncedDays(clientId: string, windows: Window[]): Promise<SyncedDays> {
  const shopStamp = await shopPushStamp(clientId);
  return syncCached(
    "daily-net",
    clientId,
    [...windows.flatMap((w) => [w.start, w.end]), shopStamp],
    async () => {
      const admin = createAdminClient();
      const [coverage, shop, ads] = await Promise.all([
        getShopSalesCoverage(clientId).catch(() => null),
        Promise.all(windows.map((w) => getShopSales(clientId, w.start, w.end))),
        Promise.all(windows.map((w) => getAdsDayTotals(admin, clientId, w.start, w.end))),
      ]);
      const revenue: SyncedDays["revenue"] = {};
      for (const s of shop) for (const d of s.days) revenue[d.date] = d.revenue;
      const api: SyncedDays["api"] = {};
      for (const rows of ads) {
        for (const r of rows) {
          const channel = PROVIDER_CHANNEL[r.provider];
          if (!channel) continue;
          const day = (api[r.date] ??= {});
          // Windows can touch at their edges; a day is read once per window
          // but the value is the same, so assign rather than add.
          day[channel] = r.spend;
        }
      }
      return {
        shopAvailable: shop.every((s) => s.available) && coverage?.available !== false,
        shopFirst: coverage?.minDate ?? null,
        shopLast: coverage?.maxDate ?? null,
        revenue,
        api,
      };
    }
  );
}

export interface ManualCosts {
  /** False until migration 0046 has run: the page hides the grid and says so. */
  available: boolean;
  /** The read failed for another reason (the grid is hidden, the page says so). */
  failed?: boolean;
  /** cellKey(date, channel) -> grosze. */
  values: Record<string, number>;
}

/** Hand-entered costs over the windows. Read live: people edit them. */
export async function getManualCosts(clientId: string, windows: Window[]): Promise<ManualCosts> {
  const admin = createAdminClient();
  // Probe first: fetchAll turns errors into plain Errors and drops the code
  // that tells "migration not run" apart from a real failure.
  const probe = await admin.from("manual_ad_costs").select("date").eq("client_id", clientId).limit(1);
  if (probe.error) {
    if (isMissingTableError(probe.error)) return { available: false, values: {} };
    throw new Error(`manual_ad_costs read failed: ${probe.error.message}`);
  }
  if (!probe.data?.length) return { available: true, values: {} };
  const parts = await Promise.all(
    windows.map((w) =>
      fetchAll<{ date: string; channel: string; amount_minor_units: number | string }>((from, to) =>
        admin
          .from("manual_ad_costs")
          .select("date, channel, amount_minor_units")
          .eq("client_id", clientId)
          .gte("date", w.start)
          .lte("date", w.end)
          // (date, channel) is unique per client: a total order for paging.
          .order("date", { ascending: true })
          .order("channel", { ascending: true })
          .range(from, to)
      )
    )
  );
  const values: Record<string, number> = {};
  for (const rows of parts) {
    for (const r of rows) {
      if (!(MANUAL_CHANNELS as readonly string[]).includes(r.channel)) continue;
      const v = Number(r.amount_minor_units) || 0;
      if (v > 0) values[cellKey(String(r.date).slice(0, 10), r.channel)] = v;
    }
  }
  return { available: true, values };
}

export interface DailyNetData extends DailyNetView {
  shop: { available: boolean; first: string | null; last: string | null };
  manual: ManualCosts;
  /** Days in the range where the TikTok integration has data (a hand entry there is ignored). */
  tiktokApiDates: string[];
}

export async function loadDailyNet(
  clientId: string,
  range: NetRange,
  mode: CompareMode,
  today: string
): Promise<DailyNetData> {
  const windows = readWindows(range);
  const [synced, manual] = await Promise.all([
    readSyncedDays(clientId, windows),
    getManualCosts(clientId, windows).catch((err) => {
      // A failed hand-cost read must not take the page down: the table
      // then shows integrations only, and the grid stays hidden.
      console.error("[wynik] manual costs read failed", err);
      return { available: true, failed: true, values: {} } satisfies ManualCosts;
    }),
  ]);
  const days = mergeDayInputs(synced.revenue, synced.api, manual.values);
  const view = buildDailyNetView(range, mode, today, days, yearsOf(range).map(blackFriday));
  return {
    ...view,
    shop: { available: synced.shopAvailable, first: synced.shopFirst, last: synced.shopLast },
    manual,
    tiktokApiDates: view.rows.filter((r) => r.spend.source.tiktok === "api").map((r) => r.date),
  };
}
