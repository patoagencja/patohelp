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
export const maxDuration = 60;

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
  const since = formatInTimeZone(subDays(now, 29), WARSAW_TZ, "yyyy-MM-dd");

  const { data: integrations } = await admin
    .from("integrations")
    .select("client_id, credentials_encrypted, account_ids")
    .eq("provider", "meta_ads");

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
  });
}
