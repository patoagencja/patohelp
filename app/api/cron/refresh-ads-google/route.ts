import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { decrypt } from "@/lib/integrations/encryption";
import { describeError } from "@/lib/integrations/errors";
import { hasClicksAllColumn } from "@/lib/integrations/link-clicks";
import { resolveSyncOutcome } from "@/lib/integrations/sync-status";
import {
  getCampaignMetrics,
  syncImpressionShareSnapshot,
  syncSearchTermsSnapshot,
} from "@/lib/integrations/google-ads";
import { historyDaysFor } from "@/lib/season/history";
import { createAdminClient } from "@/lib/supabase/admin";

// Vercel Cron: pull Google Ads campaign metrics for yesterday+today into
// ads_daily. GAQL's segments.date returns per-day rows, so one query per
// account covers both days. Auth via `Authorization: Bearer <CRON_SECRET>`.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WARSAW_TZ = "Europe/Warsaw";

// Don't START a snapshot step after this much of maxDuration (60s) is used -
// leaves ~25s for the step itself so the function isn't killed mid-run.
const SNAPSHOT_START_BUDGET_MS = 35_000;
// Don't start another client's full-year re-fetch after this much time.
const FULL_WINDOW_BUDGET_MS = 20_000;

interface GoogleAccount {
  id: string;
  selected?: boolean;
  /** Only pull YouTube (VIDEO) campaigns for this account. */
  video_only?: boolean;
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
  await admin.rpc("cleanup_expired_oauth_states");

  const now = new Date();
  const until = formatInTimeZone(now, WARSAW_TZ, "yyyy-MM-dd");
  const since = formatInTimeZone(subDays(now, 1), WARSAW_TZ, "yyyy-MM-dd");

  const onlyClient = new URL(request.url).searchParams.get("client");
  let q = admin
    .from("integrations")
    .select("client_id, credentials_encrypted, account_ids")
    .eq("provider", "google_ads");
  if (onlyClient) q = q.eq("client_id", onlyClient);
  const { data: integrations } = await q;

  // Migration 0034 adds clicks_all; Google ad clicks are link-like, so both
  // columns carry the same number. Omitted until the column exists.
  const withClicksAll = await hasClicksAllColumn(admin, "ads_daily");

  let integrationsProcessed = 0;
  let campaignsUpserted = 0;
  let accountsFailed = 0;
  const snapshotJobs: Array<{
    clientId: string;
    refreshToken: string;
    accounts: GoogleAccount[];
  }> = [];

  for (const integration of integrations ?? []) {
    const { data: run } = await admin
      .from("sync_runs")
      .insert({
        client_id: integration.client_id,
        provider: "google_ads",
        status: "running",
      })
      .select("id")
      .single();

    try {
      const { refresh_token } = JSON.parse(
        decrypt(integration.credentials_encrypted as string)
      );

      // Backfill a full year (one GAQL query covers the whole span) until we
      // have that much history, then yesterday+today.
      // Seasonal clients keep ~15 months, so a whole previous season is
      // there to compare against right to the end of this one.
      const historyDays = await historyDaysFor(admin, integration.client_id as string);
      const backfillStart = formatInTimeZone(
        subDays(now, historyDays - 1),
        WARSAW_TZ,
        "yyyy-MM-dd"
      );
      // If ANY day in the window is missing (no history yet, or a hole left by
      // a failed run), refetch the whole window - one GAQL query covers it.
      const present = new Set<string>();
      for (let offset = 0; ; offset += 1000) {
        const { data: dateRows } = await admin
          .from("ads_daily")
          .select("date")
          .eq("client_id", integration.client_id)
          .eq("provider", "google_ads")
          .gte("date", backfillStart)
          .order("date", { ascending: true })
          .range(offset, offset + 999);
        for (const r of dateRows ?? []) present.add(r.date as string);
        if (!dateRows || dateRows.length < 1000) break;
      }
      let hasGap = false;
      for (
        let d = new Date(`${backfillStart}T00:00:00Z`);
        !hasGap && d.toISOString().slice(0, 10) < since;
        d = new Date(d.getTime() + 86_400_000)
      ) {
        if (!present.has(d.toISOString().slice(0, 10))) hasGap = true;
      }
      // A day with no Google delivery at all (paused over Christmas, an
      // account younger than a year) is a permanent "gap", so the whole year
      // is re-fetched on every run. Fine for one client, but done for every
      // client in one 60s function it got the function killed (sync_runs
      // stuck "running", later clients skipped). Past the budget, later
      // clients get yesterday+today and the year on a quieter tick.
      const effectiveSince =
        hasGap && Date.now() - startedAt < FULL_WINDOW_BUDGET_MS ? backfillStart : since;

      // Only accounts explicitly selected for this client.
      const accounts = (
        (integration.account_ids ?? []) as GoogleAccount[]
      ).filter((a) => a.selected === true);

      const rows: Record<string, unknown>[] = [];
      const accountErrors: string[] = [];

      // One bad account (manager account, no access, etc.) must not sink the
      // whole sync - isolate each account.
      for (const account of accounts) {
        try {
          const metrics = await getCampaignMetrics(
            refresh_token,
            account.id,
            effectiveSince,
            until,
            account.video_only === true
          );
          for (const metric of metrics) {
            rows.push({
              client_id: integration.client_id,
              provider: "google_ads",
              campaign_id: metric.campaign_id,
              campaign_name: metric.campaign_name,
              date: metric.date,
              spend_minor_units: Math.round(metric.cost_micros / 10_000),
              impressions: metric.impressions,
              clicks: metric.clicks,
              ...(withClicksAll ? { clicks_all: metric.clicks } : {}),
              ctr: metric.ctr,
              cpc_minor_units:
                metric.average_cpc != null
                  ? Math.round(metric.average_cpc / 10_000)
                  : null,
              reach: null,
              frequency: null,
              conversions:
                metric.conversions != null
                  ? Math.round(metric.conversions)
                  : null,
              // Sales-from-ads for shop clients (lib/season): kept in raw_data
              // so it needs no migration; same keys as the Meta rows.
              raw_data: {
                status: metric.status,
                purchases: metric.conversions ?? 0,
                purchase_value: metric.conversions_value ?? 0,
              } as Record<string, unknown>,
            });
          }
        } catch (accErr) {
          accountsFailed += 1;
          accountErrors.push(`${account.id}: ${describeError(accErr)}`);
          console.error(
            `[cron/refresh-ads-google] account ${account.id} failed`,
            describeError(accErr)
          );
        }
      }

      // Chunked: a full-year re-fetch is tens of thousands of rows, too big
      // for one PostgREST request.
      for (let i = 0; i < rows.length; i += 1000) {
        const chunk = rows.slice(i, i + 1000);
        const { error } = await admin
          .from("ads_daily")
          .upsert(chunk, { onConflict: "client_id,provider,campaign_id,date" });
        if (error) throw new Error(error.message);
        campaignsUpserted += chunk.length;
      }

      await admin
        .from("sync_runs")
        .update({
          ...resolveSyncOutcome({
            accountsSelected: accounts.length,
            rowsWritten: rows.length,
            accountErrors,
          }),
          finished_at: new Date().toISOString(),
        })
        .eq("id", run?.id);
      integrationsProcessed += 1;

      // Once-a-day snapshots are deferred until EVERY client's main sync is
      // done: run inline, a slow first-of-day snapshot for one client could
      // push the next client's main sync past maxDuration and leave its
      // sync_runs row stuck on "running".
      snapshotJobs.push({
        clientId: integration.client_id as string,
        refreshToken: refresh_token,
        accounts,
      });
    } catch (err) {
      const message = describeError(err);
      console.error("[cron/refresh-ads-google] integration failed", message);
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

  // Extra once-a-day snapshots, after all sync_runs rows are closed: they
  // must never change a sync's outcome or its health status. Each step is
  // isolated, and none starts once the budget is spent - a skipped snapshot
  // is simply retried on the next tick, a killed function is not harmless.
  for (const job of snapshotJobs) {
    if (Date.now() - startedAt > SNAPSHOT_START_BUDGET_MS) break;
    try {
      await syncSearchTermsSnapshot(
        admin,
        job.clientId,
        job.refreshToken,
        job.accounts,
        until
      );
    } catch (stErr) {
      console.error(
        "[cron/refresh-ads-google] search terms failed",
        describeError(stErr)
      );
    }

    if (Date.now() - startedAt > SNAPSHOT_START_BUDGET_MS) break;
    try {
      await syncImpressionShareSnapshot(
        admin,
        job.clientId,
        job.refreshToken,
        job.accounts,
        until
      );
    } catch (isErr) {
      console.error(
        "[cron/refresh-ads-google] impression share failed",
        describeError(isErr)
      );
    }
  }

  return NextResponse.json({
    ok: true,
    integrations_processed: integrationsProcessed,
    campaigns_upserted: campaignsUpserted,
    accounts_failed: accountsFailed,
  });
}
