import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { decrypt } from "@/lib/integrations/encryption";
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
}

export async function GET(request: Request) {
  if (
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Opportunistic cleanup of expired OAuth state rows.
  await admin.rpc("cleanup_expired_oauth_states");

  const now = new Date();
  const until = formatInTimeZone(now, WARSAW_TZ, "yyyy-MM-dd");
  const since = formatInTimeZone(subDays(now, 1), WARSAW_TZ, "yyyy-MM-dd");

  const { data: integrations } = await admin
    .from("integrations")
    .select("client_id, credentials_encrypted, account_ids")
    .eq("provider", "google_ads");

  let integrationsProcessed = 0;
  let campaignsUpserted = 0;

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
      const accounts = (integration.account_ids ?? []) as GoogleAccount[];

      const rows: Record<string, unknown>[] = [];
      for (const account of accounts) {
        const metrics = await getCampaignMetrics(
          refresh_token,
          account.id,
          since,
          until
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
        .update({ status: "success", finished_at: new Date().toISOString() })
        .eq("id", run?.id);
      integrationsProcessed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
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
  });
}
