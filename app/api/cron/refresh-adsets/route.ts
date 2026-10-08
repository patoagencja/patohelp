import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { hasAdsetTable, syncAdsetsForClient } from "@/lib/integrations/adset-sync";
import { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

interface GoalCampaign {
  clientId: string;
  provider: "meta_ads" | "google_ads";
  campaignId: string;
  since: string;
}

/**
 * Campaigns with a running ad set goal, each from its earliest goal start.
 * They go first in every run: the bulk pass walks every account in turn
 * (DRE has 46) and a time cut or a Meta limit used to leave an OLX ad set
 * goal at "0 kliknięć" while Ads Manager counted hundreds.
 */
async function goalCampaigns(admin: Admin, today: string, onlyClient: string | null): Promise<GoalCampaign[]> {
  let q = admin
    .from("campaign_flights")
    .select("client_id, provider, campaign_id, start_date, end_date, adset_id")
    .not("adset_id", "is", null)
    .gte("end_date", plusDays(today, -2))
    .lte("start_date", today);
  if (onlyClient) q = q.eq("client_id", onlyClient);
  const { data, error } = await q;
  if (error || !data) return [];
  const floor = plusDays(today, -119);
  const byKey = new Map<string, GoalCampaign>();
  for (const r of data) {
    const provider = r.provider === "google_ads" ? "google_ads" : r.provider === "meta_ads" ? "meta_ads" : null;
    if (!provider || !r.campaign_id) continue;
    const key = `${r.client_id}|${provider}|${r.campaign_id}`;
    const start = String(r.start_date) < floor ? floor : String(r.start_date);
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, { clientId: String(r.client_id), provider, campaignId: String(r.campaign_id), since: start });
    } else if (start < cur.since) cur.since = start;
  }
  return [...byKey.values()];
}

/** The ad account a campaign's ad sets were last seen in; null = ask them all. */
async function accountOf(admin: Admin, g: GoalCampaign): Promise<string | null> {
  const { data } = await admin
    .from("ads_adset_daily")
    .select("account_id")
    .eq("client_id", g.clientId)
    .eq("provider", g.provider)
    .eq("campaign_id", g.campaignId)
    .not("account_id", "is", null)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.account_id as string | undefined) ?? null;
}

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
  const writtenBy = new Map<string, number>();
  const note = (clientId: string, r: { written: number; errors: string[] }) => {
    written += r.written;
    writtenBy.set(clientId, (writtenBy.get(clientId) ?? 0) + r.written);
    for (const e of r.errors) {
      console.error("[cron/refresh-adsets]", clientId, e);
      errors.push(`${clientId}: ${e}`);
    }
  };

  // 1. Ad set goals first: one campaign, its own account, from the goal's start.
  const today = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");
  const goals = await goalCampaigns(admin, today, onlyClient);
  for (const g of goals) {
    if (shouldStop()) break;
    const account = await accountOf(admin, g);
    note(
      g.clientId,
      await syncAdsetsForClient(admin, g.clientId, {
        provider: g.provider,
        campaignId: g.campaignId,
        accountIds: account ? [account] : undefined,
        window: { since: g.since, until: today },
        shouldStop,
      })
    );
  }

  // 2. Everything else (the goal form's picker, goals added later).
  for (const clientId of clientIds) {
    if (shouldStop()) break;
    note(clientId, await syncAdsetsForClient(admin, clientId, { shouldStop }));
  }

  // New rows only show once the client's sync stamp moves (the dashboard
  // caches per stamp, lib/dashboard/sync-cache.ts): this job wrote no
  // sync_runs row, so goals kept yesterday's numbers until another sync
  // landed. sync_runs.provider is free text; the health checks only look at
  // connected providers, so "adsets" never raises a banner.
  const nowIso = new Date().toISOString();
  const stamps = [...writtenBy.entries()]
    .filter(([, n]) => n > 0)
    .map(([clientId]) => ({ client_id: clientId, provider: "adsets", status: "success", finished_at: nowIso }));
  if (stamps.length) {
    const { error } = await admin.from("sync_runs").insert(stamps);
    if (error) console.warn("[cron/refresh-adsets] stamp write failed", error.message);
  }

  return NextResponse.json({ ok: true, rows_upserted: written, goal_campaigns: goals.length, errors });
}
