import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { decrypt } from "@/lib/integrations/encryption";
import { describeError } from "@/lib/integrations/errors";
import {
  getDailyMetrics,
  getItemsDaily,
  getNewVsReturning,
  getRevenueByNewVsReturning,
  getSessionsByDayHour,
  getSessionsByDevice,
  getSessionsBySourceMedium,
  getTopPages,
  type DateRange,
} from "@/lib/integrations/ga4";
import { createAdminClient } from "@/lib/supabase/admin";

// Vercel Cron: pull GA4 reports for yesterday+today into ga4_daily.
// Storage convention (one dimension per row; NULL dims = a daily total):
//   - daily totals: date + sessions + engagement_rate (+ new/returning on today)
//   - snapshots dated to `today`: source_medium / device_category / page_path rows
// Website widgets read the latest snapshot date for the dimension breakdowns.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WARSAW_TZ = "Europe/Warsaw";

// Don't START a snapshot after this much of maxDuration (60s) is used - each
// is one small GA4 report, so ~20s of headroom keeps the function alive.
const SNAPSHOT_START_BUDGET_MS = 40_000;

interface Ga4AccountIds {
  propertyId?: string | null;
}

export async function GET(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const admin = createAdminClient();
  const now = new Date();
  const until = formatInTimeZone(now, WARSAW_TZ, "yyyy-MM-dd");
  const since = formatInTimeZone(subDays(now, 1), WARSAW_TZ, "yyyy-MM-dd");
  const range: DateRange = { startDate: since, endDate: until };

  // Revenue columns arrive with migration 0016; skip them until then so the
  // insert doesn't fail on an unknown column.
  const revenueProbe = await admin
    .from("ga4_daily")
    .select("revenue_minor_units")
    .limit(1);
  const hasRevenueCols = !revenueProbe.error;

  // Per-SKU sales land in ga4_items_daily (migration 0018); skip until it exists.
  const itemsProbe = await admin.from("ga4_items_daily").select("id").limit(1);
  const hasItemsTable = !itemsProbe.error;

  // Day x hour activity heatmap lands in ga4_activity_heatmap (migration 0024).
  const heatmapProbe = await admin
    .from("ga4_activity_heatmap")
    .select("client_id")
    .limit(1);
  const hasHeatmapTable = !heatmapProbe.error;

  // New vs returning buyers land in ga4_new_vs_returning (migration 0028) and
  // only make sense for shops - engagement clients have no revenue to split.
  const nvrProbe = await admin
    .from("ga4_new_vs_returning")
    .select("client_id")
    .limit(1);
  const ecommerceClientIds = new Set<string>();
  if (!nvrProbe.error) {
    const { data: shops } = await admin
      .from("clients")
      .select("id")
      .eq("client_type", "ecommerce");
    for (const s of shops ?? []) ecommerceClientIds.add(s.id as string);
  }

  const onlyClient = new URL(request.url).searchParams.get("client");
  let gq = admin
    .from("integrations")
    .select("client_id, credentials_encrypted, account_ids")
    .eq("provider", "ga4");
  if (onlyClient) gq = gq.eq("client_id", onlyClient);
  const { data: integrations } = await gq;

  let processed = 0;
  let rowsUpserted = 0;
  const snapshotJobs: Array<{
    clientId: string;
    refreshToken: string;
    propertyId: string;
  }> = [];

  for (const integration of integrations ?? []) {
    const propertyId = (integration.account_ids as Ga4AccountIds)?.propertyId;
    if (!propertyId) {
      // GA4 is connected but no property was picked (the reconnect flow sends
      // you to a picker when the account has several). Silently skipping here
      // meant NO sync_run was written at all, so the health banner kept showing
      // the previous, now-wrong error and the client just never synced again.
      await admin.from("sync_runs").insert({
        client_id: integration.client_id,
        provider: "ga4",
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message:
          "GA4 połączone, ale nie wybrano property - dokończ wybór w Ustawieniach.",
      });
      continue;
    }

    const { data: run } = await admin
      .from("sync_runs")
      .insert({
        client_id: integration.client_id,
        provider: "ga4",
        status: "running",
      })
      .select("id")
      .single();

    try {
      const { refresh_token } = JSON.parse(
        decrypt(integration.credentials_encrypted as string)
      );

      // Backfill a full year of daily totals until we have them, then only
      // yesterday+today. (Based on the earliest daily-total row, not "any row".)
      const backfillStart = formatInTimeZone(
        subDays(now, 364),
        WARSAW_TZ,
        "yyyy-MM-dd"
      );
      // Dimension snapshots stay a 30-day window - the report widgets present
      // them as "last 30 days".
      const snapshotStart = formatInTimeZone(
        subDays(now, 29),
        WARSAW_TZ,
        "yyyy-MM-dd"
      );
      const dailyTotals = () =>
        admin
          .from("ga4_daily")
          .select("date")
          .eq("client_id", integration.client_id)
          .is("source_medium", null)
          .is("device_category", null)
          .is("page_path", null);
      const [{ data: earliest }, { data: latestBefore }] = await Promise.all([
        dailyTotals().order("date", { ascending: true }).limit(1).maybeSingle(),
        // Newest stored day before the window this run always refreshes.
        dailyTotals()
          .lt("date", since)
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      // Resume from the last stored day: with only yesterday+today, the days
      // an expired token was down were never pulled again after reconnecting
      // and the charts showed zero traffic for them. Outages leave a gap at
      // the end, so the tail is where to look (a mid-history scan would
      // re-pull forever from any day the site truly had no visits).
      const resumeFrom = (latestBefore?.date as string | undefined) ?? null;
      const dailyRange: DateRange =
        !earliest?.date || (earliest.date as string) > backfillStart
          ? { startDate: backfillStart, endDate: until }
          : resumeFrom && resumeFrom < since
            ? { startDate: resumeFrom, endDate: until }
            : range;

      // Dimension snapshots (sources/devices/pages/new-vs-returning) must cover
      // the whole 30-day period they represent in the report — not just
      // yesterday+today, which made the totals ~30x too small.
      const snapshotRange: DateRange = { startDate: snapshotStart, endDate: until };

      const [daily, sourceMedium, devices, pages, newReturning] =
        await Promise.all([
          getDailyMetrics(refresh_token, propertyId, dailyRange),
          getSessionsBySourceMedium(refresh_token, propertyId, snapshotRange),
          getSessionsByDevice(refresh_token, propertyId, snapshotRange),
          getTopPages(refresh_token, propertyId, snapshotRange, 10),
          getNewVsReturning(refresh_token, propertyId, snapshotRange),
        ]);

      const newUsers =
        newReturning.find((r) => r.type === "new")?.sessions ?? 0;
      const returningUsers =
        newReturning.find((r) => r.type === "returning")?.sessions ?? 0;

      const rows: Record<string, unknown>[] = [];

      // Daily totals (new/returning attached to the latest day). Revenue +
      // transactions are for e-commerce clients (0 for engagement properties).
      for (const d of daily) {
        rows.push({
          client_id: integration.client_id,
          date: d.date,
          sessions: d.sessions,
          users_new: d.date === until ? newUsers : 0,
          users_returning: d.date === until ? returningUsers : 0,
          engagement_rate: d.engagementRate,
          ...(hasRevenueCols
            ? {
                revenue_minor_units: Math.round((d.revenue ?? 0) * 100),
                transactions: Math.round(d.transactions ?? 0),
              }
            : {}),
          source_medium: null,
          device_category: null,
          page_path: null,
          page_views: 0,
        });
      }

      // Dimension snapshots dated to `until`. NOTE: every row must carry the
      // same NOT NULL columns (users_new/users_returning) - a batched insert of
      // objects with differing keys fills the missing ones with NULL, not the
      // column default, which violates the not-null constraint.
      for (const s of sourceMedium) {
        rows.push({
          client_id: integration.client_id,
          date: until,
          sessions: s.sessions,
          users_new: 0,
          users_returning: 0,
          engagement_rate: s.engagementRate,
          source_medium: s.sourceMedium,
          page_views: 0,
          // Revenue per channel - powers "Sprzedaż wg źródeł" on the ecom tab.
          ...(hasRevenueCols
            ? {
                revenue_minor_units: Math.round((s.revenue ?? 0) * 100),
                transactions: Math.round(s.transactions ?? 0),
              }
            : {}),
        });
      }
      for (const dv of devices) {
        rows.push({
          client_id: integration.client_id,
          date: until,
          sessions: dv.sessions,
          users_new: 0,
          users_returning: 0,
          device_category: dv.deviceCategory,
          page_views: 0,
        });
      }
      for (const p of pages) {
        rows.push({
          client_id: integration.client_id,
          date: until,
          sessions: 0,
          users_new: 0,
          users_returning: 0,
          engagement_rate: p.engagementRate,
          page_path: p.pagePath,
          page_views: p.pageViews,
        });
      }

      // Homogenize the batch: a PostgREST bulk insert unions the keys across
      // all objects and fills any a row is missing with an explicit NULL (not
      // the column default), so the revenue/transactions NOT NULL columns must
      // be present on EVERY row - the snapshot rows above omit them.
      if (hasRevenueCols) {
        for (const r of rows) {
          if (r.revenue_minor_units == null) r.revenue_minor_units = 0;
          if (r.transactions == null) r.transactions = 0;
        }
      }

      // Replace this window's rows: INSERT the fresh rows first, then delete
      // everything in the window written before them. ga4_daily has no
      // unique key, so the old delete-then-insert (a) lost the whole window
      // (up to a year) when a run died or the insert failed in between, and
      // (b) doubled every number when two runs overlapped (cron + Odśwież:
      // A deletes, B deletes, A inserts, B inserts). A single insert stamps
      // all its rows with one created_at (transaction time), so "older than
      // my rows" removes the previous data and any overlapping run's copy -
      // whichever run inserted last wins.
      let cutoff = new Date().toISOString();
      if (rows.length) {
        const { data: inserted, error } = await admin
          .from("ga4_daily")
          .insert(rows)
          .select("created_at");
        if (error) throw new Error(error.message);
        if (inserted?.[0]?.created_at) cutoff = inserted[0].created_at as string;
        rowsUpserted += rows.length;
      }
      const { error: delError } = await admin
        .from("ga4_daily")
        .delete()
        .eq("client_id", integration.client_id)
        .gte("date", dailyRange.startDate)
        .lte("date", until)
        .lt("created_at", cutoff);
      if (delError) throw new Error(delError.message);

      // Per-SKU sales for the same window (e-commerce properties only return
      // rows here; engagement properties yield nothing). Failures are logged
      // but never break the main daily sync.
      if (hasItemsTable) {
        try {
          const items = await getItemsDaily(refresh_token, propertyId, dailyRange);
          await admin
            .from("ga4_items_daily")
            .delete()
            .eq("client_id", integration.client_id)
            .gte("date", dailyRange.startDate)
            .lte("date", until);
          if (items.length) {
            const itemRows = items.map((it) => ({
              client_id: integration.client_id,
              date: it.date,
              item_id: it.itemId,
              item_name: it.itemName,
              quantity: it.quantity,
              revenue_minor_units: Math.round(it.revenue * 100),
            }));
            // Insert in chunks - a year's backfill for a large store can be
            // tens of thousands of rows.
            for (let i = 0; i < itemRows.length; i += 1000) {
              const { error } = await admin
                .from("ga4_items_daily")
                .insert(itemRows.slice(i, i + 1000));
              if (error) throw new Error(error.message);
            }
          }
        } catch (err) {
          console.error("[refresh-ga4] items sync failed", {
            client: integration.client_id,
            error: (err as Error).message,
          });
        }
      }

      await admin
        .from("sync_runs")
        .update({ status: "success", finished_at: new Date().toISOString() })
        .eq("id", run?.id);
      processed += 1;

      // Once-a-day snapshots are deferred until every client's main sync is
      // finalized: run here, a slow GA4 report would delay this run's success
      // update (and the next clients' syncs) and a timeout would leave
      // sync_runs stuck on "running".
      snapshotJobs.push({
        clientId: integration.client_id as string,
        refreshToken: refresh_token,
        propertyId,
      });
    } catch (err) {
      const message = describeError(err);
      console.error("[cron/refresh-ga4] integration failed", message);
      await admin
        .from("sync_runs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error_message: message,
        })
        .eq("id", run?.id);
    }
  }

  // Isolated like the items sync: a snapshot failure must never touch a
  // run's outcome. None starts once the budget is spent - a skipped snapshot
  // is retried on the next tick, while a killed function helps nobody.
  for (const job of snapshotJobs) {
    if (hasHeatmapTable && Date.now() - startedAt <= SNAPSHOT_START_BUDGET_MS) {
      try {
        await syncActivityHeatmap(
          admin,
          job.clientId,
          job.refreshToken,
          job.propertyId,
          until
        );
      } catch (err) {
        console.error("[refresh-ga4] activity heatmap sync failed", {
          client: job.clientId,
          error: (err as Error).message,
        });
      }
    }

    if (
      ecommerceClientIds.has(job.clientId) &&
      Date.now() - startedAt <= SNAPSHOT_START_BUDGET_MS
    ) {
      try {
        await syncNewVsReturning(
          admin,
          job.clientId,
          job.refreshToken,
          job.propertyId,
          until
        );
      } catch (err) {
        console.error("[refresh-ga4] new vs returning sync failed", {
          client: job.clientId,
          error: (err as Error).message,
        });
      }
    }
  }

  return NextResponse.json({ ok: true, integrations_processed: processed, rows_upserted: rowsUpserted });
}

// How long old heatmap snapshots are kept - only the latest is shown, but a
// few weeks of history lets us compare "how the rhythm changed" later.
const HEATMAP_KEEP_DAYS = 90;

/**
 * Writes today's day x hour snapshot (last 28 full days) unless one already
 * exists. The window ends yesterday, so re-running within the same day would
 * return identical numbers - once a day is enough and saves GA4 quota on the
 * hourly cron. All 168 cells are written (zero-filled) so an existing
 * snapshot also marks "checked today" for quiet sites.
 */
async function syncActivityHeatmap(
  admin: ReturnType<typeof createAdminClient>,
  clientId: string,
  refreshToken: string,
  propertyId: string,
  today: string
) {
  const existing = await admin
    .from("ga4_activity_heatmap")
    .select("client_id")
    .eq("client_id", clientId)
    .eq("snapshot_date", today)
    .limit(1);
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.length) return;

  const cells = await getSessionsByDayHour(refreshToken, propertyId);

  const grid = new Map<string, { sessions: number; engaged: number }>();
  for (const c of cells) {
    const key = `${c.dayOfWeek}-${c.hour}`;
    const cur = grid.get(key) ?? { sessions: 0, engaged: 0 };
    cur.sessions += c.sessions;
    cur.engaged += c.engagedSessions;
    grid.set(key, cur);
  }

  const rows: Record<string, unknown>[] = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const v = grid.get(`${day}-${hour}`);
      rows.push({
        client_id: clientId,
        snapshot_date: today,
        day_of_week: day,
        hour,
        sessions: Math.round(v?.sessions ?? 0),
        engaged_sessions: Math.round(v?.engaged ?? 0),
      });
    }
  }

  // Upsert so two overlapping cron runs can't trip the primary key.
  const { error } = await admin
    .from("ga4_activity_heatmap")
    .upsert(rows, { onConflict: "client_id,snapshot_date,day_of_week,hour" });
  if (error) throw new Error(error.message);

  const cutoff = formatInTimeZone(
    subDays(new Date(), HEATMAP_KEEP_DAYS),
    WARSAW_TZ,
    "yyyy-MM-dd"
  );
  await admin
    .from("ga4_activity_heatmap")
    .delete()
    .eq("client_id", clientId)
    .lt("snapshot_date", cutoff);
}

/**
 * Writes today's new-vs-returning revenue snapshot (last 30 full days) unless
 * one already exists - same once-a-day reasoning as the heatmap. "new" and
 * "returning" are always written (zero-filled) so a quiet shop still gets a
 * "checked today" marker; "(not set)" only when GA4 reports it.
 */
async function syncNewVsReturning(
  admin: ReturnType<typeof createAdminClient>,
  clientId: string,
  refreshToken: string,
  propertyId: string,
  today: string
) {
  const existing = await admin
    .from("ga4_new_vs_returning")
    .select("client_id")
    .eq("client_id", clientId)
    .eq("snapshot_date", today)
    .limit(1);
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.length) return;

  const segments = await getRevenueByNewVsReturning(refreshToken, propertyId);

  const totals = new Map<
    string,
    { revenue: number; transactions: number; users: number; sessions: number }
  >([
    ["new", { revenue: 0, transactions: 0, users: 0, sessions: 0 }],
    ["returning", { revenue: 0, transactions: 0, users: 0, sessions: 0 }],
  ]);
  for (const s of segments) {
    const cur = totals.get(s.segment) ?? {
      revenue: 0,
      transactions: 0,
      users: 0,
      sessions: 0,
    };
    cur.revenue += s.revenue;
    cur.transactions += s.transactions;
    cur.users += s.users;
    cur.sessions += s.sessions;
    totals.set(s.segment, cur);
  }

  const rows = [...totals].map(([segment, v]) => ({
    client_id: clientId,
    snapshot_date: today,
    segment,
    revenue_minor_units: Math.round(v.revenue * 100),
    transactions: Math.round(v.transactions),
    users: Math.round(v.users),
    sessions: Math.round(v.sessions),
  }));

  // Upsert so two overlapping cron runs can't trip the primary key.
  const { error } = await admin
    .from("ga4_new_vs_returning")
    .upsert(rows, { onConflict: "client_id,snapshot_date,segment" });
  if (error) throw new Error(error.message);
}
