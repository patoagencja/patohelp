import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { decrypt } from "@/lib/integrations/encryption";
import { describeError } from "@/lib/integrations/errors";
import { getAdInsights, getAdThumbnails } from "@/lib/integrations/meta-ads";
import { createAdminClient } from "@/lib/supabase/admin";

// Vercel Cron (every 6h): pull Meta ad-level creative performance for the
// last 30 days into `creatives`. Google Ads creatives are a TODO (no
// thumbnails in their API; we skip them in this version).
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const WARSAW_TZ = "Europe/Warsaw";

interface MetaAccount {
  id: string;
  selected?: boolean;
}

// bigint columns reject "12.0"-style floats; keep null as "not reported".
function roundOrNull(v: number | null): number | null {
  return v != null ? Math.round(v) : null;
}

export async function GET(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();
  const until = formatInTimeZone(now, WARSAW_TZ, "yyyy-MM-dd");
  const since = formatInTimeZone(subDays(now, 29), WARSAW_TZ, "yyyy-MM-dd");

  const onlyClient = new URL(request.url).searchParams.get("client");
  let q = admin
    .from("integrations")
    .select("client_id, credentials_encrypted, account_ids")
    .eq("provider", "meta_ads");
  if (onlyClient) q = q.eq("client_id", onlyClient);
  const { data: integrations } = await q;

  // Migration 0025 adds the diagnostic columns. Until it runs, PostgREST
  // rejects any upsert naming them, so probe once and omit them from every
  // row - bulk upserts union keys, so rows must all carry the same shape.
  const { error: probeError } = await admin
    .from("creatives")
    .select("video_3s_views")
    .limit(1);
  const hasMetricColumns = !probeError;
  if (probeError) {
    console.warn(
      "[cron/refresh-creatives-meta] creative metric columns missing - run migration 0025",
      probeError.message
    );
  }

  let creativesUpserted = 0;
  let accountsFailed = 0;

  for (const integration of integrations ?? []) {
    try {
      const { access_token } = JSON.parse(
        decrypt(integration.credentials_encrypted as string)
      );
      const accounts = (
        (integration.account_ids ?? []) as MetaAccount[]
      ).filter((a) => a.selected === true);

      for (const account of accounts) {
        try {
          const [insights, thumbnails] = await Promise.all([
            getAdInsights(access_token, account.id, since, until),
            getAdThumbnails(access_token, account.id),
          ]);

          // getAdInsights falls back to the base fields on ANY error (rate
          // limits included) and then reports every diagnostic as null.
          // Writing those nulls would wipe the last good values for 6h, so
          // only send the diagnostic columns when the extended call worked
          // (reach comes back for every ad that had impressions). Decided per
          // account, so each upsert batch still has one shape.
          const withMetrics =
            hasMetricColumns && insights.some((ad) => ad.reach != null);

          const rows = insights.map((ad) => ({
            client_id: integration.client_id,
            provider: "meta_ads",
            ad_id: ad.ad_id,
            ad_name: ad.ad_name,
            campaign_id: ad.campaign_id,
            thumbnail_url: thumbnails.get(ad.ad_id) ?? null,
            spend_minor_units: Math.round(parseFloat(ad.spend) * 100),
            impressions: parseInt(ad.impressions, 10) || 0,
            clicks: parseInt(ad.clicks, 10) || 0,
            ctr: ad.ctr != null ? parseFloat(ad.ctr) : null,
            cpc_minor_units:
              ad.cpc != null ? Math.round(parseFloat(ad.cpc) * 100) : null,
            period_start: since,
            period_end: until,
            updated_at: new Date().toISOString(),
            ...(withMetrics
              ? {
                  reach: roundOrNull(ad.reach),
                  frequency: ad.frequency,
                  quality_ranking: ad.quality_ranking,
                  engagement_rate_ranking: ad.engagement_rate_ranking,
                  conversion_rate_ranking: ad.conversion_rate_ranking,
                  video_plays: roundOrNull(ad.video_plays),
                  video_3s_views: roundOrNull(ad.video_3s_views),
                  video_thruplays: roundOrNull(ad.video_thruplays),
                  video_p25: roundOrNull(ad.video_p25),
                  video_p50: roundOrNull(ad.video_p50),
                  video_p75: roundOrNull(ad.video_p75),
                  video_p100: roundOrNull(ad.video_p100),
                  video_avg_watch_seconds: ad.video_avg_watch_seconds,
                }
              : {}),
          }));

          if (rows.length) {
            const { error } = await admin
              .from("creatives")
              .upsert(rows, { onConflict: "client_id,provider,ad_id" });
            if (error) throw new Error(error.message);
            creativesUpserted += rows.length;
          }
        } catch (accErr) {
          accountsFailed += 1;
          console.error(
            `[cron/refresh-creatives-meta] account ${account.id} failed`,
            describeError(accErr)
          );
        }
      }
    } catch (err) {
      console.error(
        "[cron/refresh-creatives-meta] integration failed",
        describeError(err)
      );
    }
  }

  return NextResponse.json({
    ok: true,
    creatives_upserted: creativesUpserted,
    accounts_failed: accountsFailed,
    metric_columns: hasMetricColumns,
  });
}
