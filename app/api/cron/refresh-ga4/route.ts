import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { decrypt } from "@/lib/integrations/encryption";
import { describeError } from "@/lib/integrations/errors";
import {
  getDailyMetrics,
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

  const { data: integrations } = await admin
    .from("integrations")
    .select("client_id, credentials_encrypted, account_ids")
    .eq("provider", "ga4");

  let processed = 0;
  let rowsUpserted = 0;

  for (const integration of integrations ?? []) {
    const propertyId = (integration.account_ids as Ga4AccountIds)?.propertyId;
    if (!propertyId) continue;

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

      // Backfill 30 days of daily totals until we have them, then only
      // yesterday+today. (Based on the earliest daily-total row, not "any row".)
      const backfillStart = formatInTimeZone(
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

      const [daily, sourceMedium, devices, pages, newReturning] =
        await Promise.all([
          getDailyMetrics(refresh_token, propertyId, dailyRange),
          getSessionsBySourceMedium(refresh_token, propertyId, range),
          getSessionsByDevice(refresh_token, propertyId, range),
          getTopPages(refresh_token, propertyId, range, 10),
          getNewVsReturning(refresh_token, propertyId, range),
        ]);

      const newUsers =
        newReturning.find((r) => r.type === "new")?.sessions ?? 0;
      const returningUsers =
        newReturning.find((r) => r.type === "returning")?.sessions ?? 0;

      const rows: Record<string, unknown>[] = [];

      // Daily totals (new/returning attached to the latest day).
      for (const d of daily) {
        rows.push({
          client_id: integration.client_id,
          date: d.date,
          sessions: d.sessions,
          users_new: d.date === until ? newUsers : 0,
          users_returning: d.date === until ? returningUsers : 0,
          engagement_rate: d.engagementRate,
          source_medium: null,
          device_category: null,
          page_path: null,
          page_views: 0,
        });
      }

      // Dimension snapshots dated to `until`.
      for (const s of sourceMedium) {
        rows.push({
          client_id: integration.client_id,
          date: until,
          sessions: s.sessions,
          engagement_rate: s.engagementRate,
          source_medium: s.sourceMedium,
          page_views: 0,
        });
      }
      for (const dv of devices) {
        rows.push({
          client_id: integration.client_id,
          date: until,
          sessions: dv.sessions,
          device_category: dv.deviceCategory,
          page_views: 0,
        });
      }
      for (const p of pages) {
        rows.push({
          client_id: integration.client_id,
          date: until,
          sessions: 0,
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

      if (rows.length) {
        const { error } = await admin.from("ga4_daily").insert(rows);
        if (error) throw new Error(error.message);
        rowsUpserted += rows.length;
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
