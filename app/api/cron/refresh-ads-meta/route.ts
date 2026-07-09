import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { decrypt } from "@/lib/integrations/encryption";
import { describeError } from "@/lib/integrations/errors";
import {
  extractConversions,
  getCampaignInsights,
} from "@/lib/integrations/meta-ads";
import { createAdminClient } from "@/lib/supabase/admin";

// Vercel Cron: pull Meta Ads campaign insights for yesterday+today into
// ads_daily. Auth via `Authorization: Bearer <CRON_SECRET>`.
export const dynamic = "force-dynamic";
// Per-day insight fetching for a large account (DRE ~1900 campaigns) is many
// sequential paginated requests, so give the backfill plenty of headroom.
export const maxDuration = 300;

const WARSAW_TZ = "Europe/Warsaw";

interface MetaAccount {
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

  const { data: integrations } = await admin
    .from("integrations")
    .select("client_id, credentials_encrypted, account_ids")
    .eq("provider", "meta_ads");

  let integrationsProcessed = 0;
  let campaignsUpserted = 0;
  let accountsFailed = 0;

  for (const integration of integrations ?? []) {
    const { data: run } = await admin
      .from("sync_runs")
      .insert({
        client_id: integration.client_id,
        provider: "meta_ads",
        status: "running",
      })
      .select("id")
      .single();

    try {
      const { access_token } = JSON.parse(
        decrypt(integration.credentials_encrypted as string)
      );

      // Backfill 30 days until we actually have 30 days of history, then fall
      // back to yesterday+today. (Checking "any older row exists" was wrong -
      // a couple of recent days made it skip the backfill forever.)
      const backfillStart = formatInTimeZone(
        subDays(now, 29),
        WARSAW_TZ,
        "yyyy-MM-dd"
      );
      const { data: earliest } = await admin
        .from("ads_daily")
        .select("date")
        .eq("client_id", integration.client_id)
        .eq("provider", "meta_ads")
        .order("date", { ascending: true })
        .limit(1)
        .maybeSingle();
      const effectiveSince =
        earliest?.date && (earliest.date as string) <= backfillStart
          ? since
          : backfillStart;

      // Only accounts explicitly selected for this client (avoids pulling
      // every account the agency user can access into one client's data).
      const accounts = (
        (integration.account_ids ?? []) as MetaAccount[]
      ).filter((a) => a.selected === true);

      const rows: Record<string, unknown>[] = [];
      const accountErrors: string[] = [];

      // Isolate each ad account so one disabled/error account doesn't sink all.
      for (const account of accounts) {
        try {
          const insights = await getCampaignInsights(
            access_token,
            account.id,
            effectiveSince,
            until
          );
          for (const insight of insights) {
            rows.push({
              client_id: integration.client_id,
              provider: "meta_ads",
              campaign_id: insight.campaign_id,
              campaign_name: insight.campaign_name,
              date: insight.date,
              spend_minor_units: Math.round(parseFloat(insight.spend) * 100),
              impressions: parseInt(insight.impressions, 10) || 0,
              clicks: parseInt(insight.clicks, 10) || 0,
              ctr: insight.ctr != null ? parseFloat(insight.ctr) : null,
              cpc_minor_units:
                insight.cpc != null
                  ? Math.round(parseFloat(insight.cpc) * 100)
                  : null,
              reach: insight.reach != null ? parseInt(insight.reach, 10) : null,
              frequency:
                insight.frequency != null
                  ? parseFloat(insight.frequency)
                  : null,
              conversions: extractConversions(insight.actions),
              raw_data: insight as unknown as Record<string, unknown>,
            });
          }
        } catch (accErr) {
          accountsFailed += 1;
          accountErrors.push(`${account.id}: ${describeError(accErr)}`);
          console.error(
            `[cron/refresh-ads-meta] account ${account.id} failed`,
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
      console.error("[cron/refresh-ads-meta] integration failed", message);
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
