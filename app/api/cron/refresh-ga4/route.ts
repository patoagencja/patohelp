import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { decrypt } from "@/lib/integrations/encryption";
import { describeError } from "@/lib/integrations/errors";
import {
  getDailyMetrics,
  getItemsDaily,
  getNewVsReturning,
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

interface Ga4AccountIds {
  propertyId?: string | null;
}

export async function GET(request: Request) {
  if (
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const onlyClient = new URL(request.url).searchParams.get("client");
  let gq = admin
    .from("integrations")
    .select("client_id, credentials_encrypted, account_ids")
    .eq("provider", "ga4");
  if (onlyClient) gq = gq.eq("client_id", onlyClient);
  const { data: integrations } = await gq;

  let processed = 0;
  let rowsUpserted = 0;

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
      const { data: earliest } = await admin
        .from("ga4_daily")
        .select("date")
        .eq("client_id", integration.client_id)
        .is("source_medium", null)
        .is("device_category", null)
        .is("page_path", null)
        .order("date", { ascending: true })
        .limit(1)
        .maybeSingle();
      const dailyRange: DateRange =
        earliest?.date && (earliest.date as string) <= backfillStart
          ? range
          : { startDate: backfillStart, endDate: until };

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

      // Replace this window's rows so refreshes stay idempotent (covers the
      // 30-day backfill window on first sync).
      await admin
        .from("ga4_daily")
        .delete()
        .eq("client_id", integration.client_id)
        .gte("date", dailyRange.startDate)
        .lte("date", until);

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

      if (rows.length) {
        const { error } = await admin.from("ga4_daily").insert(rows);
        if (error) throw new Error(error.message);
        rowsUpserted += rows.length;
      }

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

  return NextResponse.json({ ok: true, integrations_processed: processed, rows_upserted: rowsUpserted });
}
