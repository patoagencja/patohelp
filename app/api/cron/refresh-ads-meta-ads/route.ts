import { NextResponse } from "next/server";

import { listAbClients } from "@/lib/ab/eligibility";
import { AD_DAILY_SYNC_PROVIDER, hasAdDailyTable, syncAdDailyForClient } from "@/lib/ab/sync";
import { describeError } from "@/lib/integrations/errors";
import { resolveSyncOutcome } from "@/lib/integrations/sync-status";
import { createAdminClient } from "@/lib/supabase/admin";

// Meta ad x day rows with purchases (ads_ad_daily) for the creative test
// view, every ~30 minutes: an owner spending tens of thousands a day in
// season must see a money-burning ad within hours. Only seasonal and
// e-commerce clients (lib/ab/eligibility) - ad-level daily pulls are heavy.
// Optional ?client=<id> scopes the run (the dashboard's "Odśwież").
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// No history slice starts after STOP_MS; the fresh days (today, yesterday)
// still run for every client until HARD_STOP_MS, so a long backfill of one
// client can't leave another without today's numbers - and nothing starts
// close enough to maxDuration to be killed mid-write.
const STOP_MS = 240_000;
const HARD_STOP_MS = 270_000;

export async function GET(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const admin = createAdminClient();
  if (!(await hasAdDailyTable(admin))) {
    return NextResponse.json({ ok: true, skipped: "migration 0039 not applied" });
  }

  const onlyClient = new URL(request.url).searchParams.get("client");
  let q = admin.from("integrations").select("client_id, account_ids").eq("provider", "meta_ads");
  if (onlyClient) q = q.eq("client_id", onlyClient);
  const { data: integrations, error } = await q;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 503 });
  }
  // Clients with at least one selected Meta account; nothing to pull otherwise.
  const withAccounts = (integrations ?? [])
    .filter(
      (r) =>
        Array.isArray(r.account_ids) &&
        (r.account_ids as Array<{ selected?: boolean }>).some((a) => a.selected === true)
    )
    .map((r) => r.client_id as string);
  const clients = await listAbClients(admin, Array.from(new Set(withAccounts)));
  if (!clients.length) {
    return NextResponse.json({
      ok: true,
      clients: 0,
      skipped: onlyClient ? "not a seasonal or e-commerce client with Meta" : "no eligible clients",
    });
  }

  const shouldStop = () => Date.now() - startedAt > STOP_MS;
  let rowsUpserted = 0;
  const results: Array<Record<string, unknown>> = [];

  for (const client of clients) {
    if (Date.now() - startedAt > HARD_STOP_MS) {
      results.push({ client: client.id, skipped: "time budget" });
      continue;
    }
    // sync_runs.provider is free text (no CHECK in any migration); a row
    // here also moves the client's "newest sync" stamp, so cached views
    // (lib/dashboard/sync-cache) pick up the new ad rows at once.
    const { data: run } = await admin
      .from("sync_runs")
      .insert({ client_id: client.id, provider: AD_DAILY_SYNC_PROVIDER, status: "running" })
      .select("id")
      .maybeSingle();
    try {
      const r = await syncAdDailyForClient(admin, client, { shouldStop });
      rowsUpserted += r.written;
      for (const e of r.errors) console.error("[cron/refresh-ads-meta-ads]", client.id, e);
      for (const w of r.warnings) console.warn("[cron/refresh-ads-meta-ads]", client.id, w);
      if (run?.id) {
        await admin
          .from("sync_runs")
          .update({
            ...resolveSyncOutcome({
              accountsSelected: r.accounts,
              rowsWritten: r.written,
              accountErrors: r.errors,
            }),
            finished_at: new Date().toISOString(),
          })
          .eq("id", run.id);
      }
      results.push({
        client: client.id,
        rows: r.written,
        days: r.days.length,
        pending_days: r.pending,
        creatives_updated: r.creativesUpdated,
        errors: r.errors,
        warnings: r.warnings,
      });
    } catch (err) {
      const message = describeError(err);
      console.error("[cron/refresh-ads-meta-ads] client failed", client.id, message);
      if (run?.id) {
        await admin
          .from("sync_runs")
          .update({ status: "failed", finished_at: new Date().toISOString(), error_message: message })
          .eq("id", run.id);
      }
      results.push({ client: client.id, error: message });
    }
  }

  return NextResponse.json({ ok: true, clients: clients.length, rows_upserted: rowsUpserted, results });
}
