import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { decrypt } from "@/lib/integrations/encryption";
import { describeError } from "@/lib/integrations/errors";
import { getCampaignMetrics } from "@/lib/integrations/tiktok";
import { createAdminClient } from "@/lib/supabase/admin";

// Vercel Cron: pull TikTok Ads campaign reports into ads_daily.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const WARSAW_TZ = "Europe/Warsaw";

interface TikTokAccount {
  id: string;
  selected?: boolean;
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

  const onlyClient = new URL(request.url).searchParams.get("client");
  let q = admin
    .from("integrations")
    .select("client_id, credentials_encrypted, account_ids")
    .eq("provider", "tiktok_ads");
  if (onlyClient) q = q.eq("client_id", onlyClient);
  const { data: integrations } = await q;

  let processed = 0;
  let upserted = 0;
  let accountsFailed = 0;

  for (const integration of integrations ?? []) {
    const { data: run } = await admin
      .from("sync_runs")
      .insert({ client_id: integration.client_id, provider: "tiktok_ads", status: "running" })
      .select("id")
      .single();

    try {
      const { access_token } = JSON.parse(
        decrypt(integration.credentials_encrypted as string)
      );

      // Backfill 92 days (3 full months for monthly reports), then yesterday+today.
      const backfillStart = formatInTimeZone(subDays(now, 91), WARSAW_TZ, "yyyy-MM-dd");
      const { data: earliest } = await admin
        .from("ads_daily")
        .select("date")
        .eq("client_id", integration.client_id)
        .eq("provider", "tiktok_ads")
        .order("date", { ascending: true })
        .limit(1)
        .maybeSingle();
      const effectiveSince =
        earliest?.date && (earliest.date as string) <= backfillStart ? since : backfillStart;

      const accounts = ((integration.account_ids ?? []) as TikTokAccount[]).filter(
        (a) => a.selected === true
      );

      const rows: Record<string, unknown>[] = [];
      const accountErrors: string[] = [];

      for (const account of accounts) {
        try {
          const metrics = await getCampaignMetrics(
            access_token,
            account.id,
            effectiveSince,
            until
          );
          for (const m of metrics) {
            rows.push({
              client_id: integration.client_id,
              provider: "tiktok_ads",
              campaign_id: m.campaign_id,
              campaign_name: m.campaign_name,
              date: m.date,
              spend_minor_units: Math.round(parseFloat(m.spend) * 100),
              impressions: parseInt(m.impressions, 10) || 0,
              clicks: parseInt(m.clicks, 10) || 0,
              ctr: m.ctr != null ? parseFloat(m.ctr) : null,
              cpc_minor_units:
                m.cpc != null ? Math.round(parseFloat(m.cpc) * 100) : null,
              reach: m.reach != null ? parseInt(m.reach, 10) : null,
              conversions: 0,
              raw_data: m as unknown as Record<string, unknown>,
            });
          }
        } catch (accErr) {
          accountsFailed += 1;
          accountErrors.push(`${account.id}: ${describeError(accErr)}`);
          console.error(`[cron/refresh-ads-tiktok] account ${account.id} failed`, describeError(accErr));
        }
      }

      if (rows.length) {
        const { error } = await admin
          .from("ads_daily")
          .upsert(rows, { onConflict: "client_id,provider,campaign_id,date" });
        if (error) throw new Error(error.message);
        upserted += rows.length;
      }

      await admin
        .from("sync_runs")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          error_message: accountErrors.length ? accountErrors.slice(0, 5).join(" | ") : null,
        })
        .eq("id", run?.id);
      processed += 1;
    } catch (err) {
      const message = describeError(err);
      console.error("[cron/refresh-ads-tiktok] integration failed", message);
      await admin
        .from("sync_runs")
        .update({ status: "failed", finished_at: new Date().toISOString(), error_message: message })
        .eq("id", run?.id);
    }
  }

  return NextResponse.json({
    ok: true,
    integrations_processed: processed,
    campaigns_upserted: upserted,
    accounts_failed: accountsFailed,
  });
}
