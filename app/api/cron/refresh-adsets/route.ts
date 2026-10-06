import { NextResponse } from "next/server";

import { hasAdsetTable, syncAdsetsForClient } from "@/lib/integrations/adset-sync";
import { createAdminClient } from "@/lib/supabase/admin";

// Ad set (Meta) / ad group (Google) daily rows for ad set goals. Its own cron
// with its own time budget: as a side job of the campaign crons it never got
// to run on a big account, whose campaign backfill used the budget first.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Nothing starts after this much of maxDuration; a running sync stops
// between 7-day slices/accounts, so the function is never killed mid-write.
const STOP_MS = 240_000;

export async function GET(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const admin = createAdminClient();
  if (!(await hasAdsetTable(admin))) {
    return NextResponse.json({ ok: true, skipped: "migration 0033 not applied" });
  }

  const onlyClient = new URL(request.url).searchParams.get("client");
  let q = admin
    .from("integrations")
    .select("client_id")
    .in("provider", ["meta_ads", "google_ads"]);
  if (onlyClient) q = q.eq("client_id", onlyClient);
  const { data: rows } = await q;
  const clientIds = Array.from(new Set((rows ?? []).map((r) => r.client_id as string)));

  const shouldStop = () => Date.now() - startedAt > STOP_MS;
  let written = 0;
  const errors: string[] = [];
  for (const clientId of clientIds) {
    if (shouldStop()) break;
    const r = await syncAdsetsForClient(admin, clientId, { shouldStop });
    written += r.written;
    for (const e of r.errors) {
      console.error("[cron/refresh-adsets]", clientId, e);
      errors.push(`${clientId}: ${e}`);
    }
  }

  return NextResponse.json({ ok: true, rows_upserted: written, errors });
}
