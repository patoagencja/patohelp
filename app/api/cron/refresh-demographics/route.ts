import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { decrypt } from "@/lib/integrations/encryption";
import { describeError } from "@/lib/integrations/errors";
import {
  getAgeBrackets,
  getGenders,
  getRegions,
  type DateRange,
} from "@/lib/integrations/ga4";
import { getDemographics } from "@/lib/integrations/meta-ads";
import { createAdminClient } from "@/lib/supabase/admin";

// Vercel Cron: pull age/gender/geo demographics (GA4) and age/gender (Meta) for
// the last 30 days and store them as a snapshot dated today. Replaces the
// client's previous snapshot so the report always shows the latest.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
  const range: DateRange = { startDate: since, endDate: until };

  let processed = 0;

  const onlyClient = new URL(request.url).searchParams.get("client");
  const scoped = (provider: string) => {
    let q = admin
      .from("integrations")
      .select("client_id, credentials_encrypted, account_ids")
      .eq("provider", provider);
    if (onlyClient) q = q.eq("client_id", onlyClient);
    return q;
  };

  // Collect rows per client, then replace that client's snapshot atomically.
  const [ga4Res, metaRes] = await Promise.all([scoped("ga4"), scoped("meta_ads")]);

  const clientIds = new Set<string>();
  const rowsByClient = new Map<string, Record<string, unknown>[]>();
  const push = (clientId: string, row: Record<string, unknown>) => {
    clientIds.add(clientId);
    const arr = rowsByClient.get(clientId) ?? [];
    arr.push(row);
    rowsByClient.set(clientId, arr);
  };

  // --- GA4: age / gender / region ---
  for (const integration of ga4Res.data ?? []) {
    const propertyId = (integration.account_ids as { propertyId?: string })
      ?.propertyId;
    if (!propertyId) continue;
    try {
      const { refresh_token } = JSON.parse(
        decrypt(integration.credentials_encrypted as string)
      );
      const [age, gender, geo] = await Promise.all([
        getAgeBrackets(refresh_token, propertyId, range),
        getGenders(refresh_token, propertyId, range),
        getRegions(refresh_token, propertyId, range),
      ]);
      for (const a of age)
        push(integration.client_id, {
          client_id: integration.client_id,
          provider: "ga4",
          kind: "age",
          bucket: a.bucket,
          value: a.value,
          snapshot_date: until,
        });
      for (const g of gender)
        push(integration.client_id, {
          client_id: integration.client_id,
          provider: "ga4",
          kind: "gender",
          bucket: g.bucket,
          value: g.value,
          snapshot_date: until,
        });
      for (const r of geo)
        push(integration.client_id, {
          client_id: integration.client_id,
          provider: "ga4",
          kind: "geo",
          bucket: r.bucket,
          value: r.value,
          snapshot_date: until,
        });
    } catch (err) {
      console.error("[cron/refresh-demographics] GA4 failed", describeError(err));
    }
  }

  // --- Meta: age / gender (aggregated across selected accounts) ---
  for (const integration of metaRes.data ?? []) {
    try {
      const { access_token } = JSON.parse(
        decrypt(integration.credentials_encrypted as string)
      );
      const accounts = ((integration.account_ids ?? []) as MetaAccount[]).filter(
        (a) => a.selected === true
      );
      const age = new Map<string, number>();
      const gender = new Map<string, number>();
      for (const account of accounts) {
        try {
          const demo = await getDemographics(access_token, account.id, since, until);
          for (const a of demo.age)
            if (a.bucket) age.set(a.bucket, (age.get(a.bucket) ?? 0) + a.value);
          for (const g of demo.gender)
            if (g.bucket)
              gender.set(g.bucket, (gender.get(g.bucket) ?? 0) + g.value);
        } catch (accErr) {
          console.error(
            "[cron/refresh-demographics] Meta account failed",
            account.id,
            describeError(accErr)
          );
        }
      }
      for (const [bucket, value] of age)
        push(integration.client_id, {
          client_id: integration.client_id,
          provider: "meta_ads",
          kind: "age",
          bucket,
          value,
          snapshot_date: until,
        });
      for (const [bucket, value] of gender)
        push(integration.client_id, {
          client_id: integration.client_id,
          provider: "meta_ads",
          kind: "gender",
          bucket,
          value,
          snapshot_date: until,
        });
    } catch (err) {
      console.error("[cron/refresh-demographics] Meta failed", describeError(err));
    }
  }

  // Replace each client's snapshot with the fresh rows.
  for (const clientId of clientIds) {
    const rows = rowsByClient.get(clientId) ?? [];
    if (rows.length === 0) continue;
    await admin.from("demographics").delete().eq("client_id", clientId);
    const { error } = await admin.from("demographics").insert(rows);
    if (error) {
      console.error("[cron/refresh-demographics] insert failed", error.message);
      continue;
    }
    processed += 1;
  }

  return NextResponse.json({ ok: true, clients_processed: processed });
}
