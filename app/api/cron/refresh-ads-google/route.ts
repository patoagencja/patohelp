import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { decrypt } from "@/lib/integrations/encryption";
import { describeError } from "@/lib/integrations/errors";
import { getCampaignMetrics } from "@/lib/integrations/google-ads";
import { createAdminClient } from "@/lib/supabase/admin";

// Vercel Cron: pull Google Ads campaign metrics for yesterday+today into
// ads_daily. GAQL's segments.date returns per-day rows, so one query per
// account covers both days. Auth via `Authorization: Bearer <CRON_SECRET>`.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WARSAW_TZ = "Europe/Warsaw";

interface GoogleAccount {
  id: string;
  selected?: boolean;
  /** Only pull YouTube (VIDEO) campaigns for this account. */
  video_only?: boolean;
}

export async function GET(request: Request) {
  if (
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  let integrationsProcessed = 0;
  let campaignsUpserted = 0;
  let accountsFailed = 0;

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
      const backfillStart = formatInTimeZone(
        subDays(now, 364),
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
      const effectiveSince = hasGap ? backfillStart : since;

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
              raw_data: { status: metric.status } as Record<string, unknown>,
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

      if (rows.length) {
        const { error } = await admin
          .from("ads_daily")
          .upsert(rows, { onConflict: "client_id,provider,campaign_id,date" });
        if (error) throw new Error(error.message);
        campaignsUpserted += rows.length;
      }

      await admin
        .from("sync_runs")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          error_message: accountErrors.length
            ? accountErrors.slice(0, 5).join(" | ")
            : null,
        })
        .eq("id", run?.id);
      integrationsProcessed += 1;
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

  return NextResponse.json({
    ok: true,
    integrations_processed: integrationsProcessed,
    campaigns_upserted: campaignsUpserted,
    accounts_failed: accountsFailed,
  });
}
