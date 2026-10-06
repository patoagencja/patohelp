import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { decrypt } from "@/lib/integrations/encryption";
import { describeError } from "@/lib/integrations/errors";
import { resolveSyncOutcome } from "@/lib/integrations/sync-status";
import { hasClicksAllColumnStrict, metaClickColumns } from "@/lib/integrations/link-clicks";
import {
  extractConversions,
  getActiveDays,
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

// No new BACKFILL batch starts after this much wall time. Fresh days
// (yesterday+today) always run for every client. Without a budget a long
// backfill ran into maxDuration: the function was killed, its sync_runs row
// stayed "running" forever and the clients after it in the loop got nothing.
// It also stays under the scheduler's 90s curl timeout, which otherwise
// counted the run as failed and fired a second, overlapping one.
const BACKFILL_BUDGET_MS = 60_000;

interface MetaAccount {
  id: string;
  selected?: boolean;
}

/** Inclusive list of yyyy-MM-dd between two dates. */
function eachDay(since: string, until: string): string[] {
  const days: string[] = [];
  const start = new Date(`${since}T00:00:00Z`);
  const end = new Date(`${until}T00:00:00Z`);
  for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

/** All dates with at least one row for client+provider since `fromDate`
 *  (paginated - PostgREST caps a single select at ~1000 rows). */
async function presentDates(
  admin: ReturnType<typeof createAdminClient>,
  clientId: string,
  provider: string,
  fromDate: string
): Promise<Set<string>> {
  const present = new Set<string>();
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data } = await admin
      .from("ads_daily")
      .select("date")
      .eq("client_id", clientId)
      .eq("provider", provider)
      .gte("date", fromDate)
      .order("date", { ascending: true })
      .range(offset, offset + PAGE - 1);
    for (const r of data ?? []) present.add(r.date as string);
    if (!data || data.length < PAGE) break;
  }
  return present;
}

/**
 * The newest days (at most `limit`) since `fromDate` that still hold Meta rows
 * from before migration 0034 (clicks_all IS NULL: `clicks` there is clicks
 * (all), not link clicks). They are re-pulled like missing days so charts and
 * year-over-year compare link clicks with link clicks. Walks back a page at a
 * time from the newest stale row, so it reads a few pages, not the whole year.
 */
async function staleClickDates(
  admin: ReturnType<typeof createAdminClient>,
  clientId: string,
  fromDate: string,
  beforeDate: string,
  limit: number
): Promise<Set<string>> {
  const stale = new Set<string>();
  let upper = beforeDate;
  for (let guard = 0; guard < 400 && stale.size < limit; guard += 1) {
    const { data, error } = await admin
      .from("ads_daily")
      .select("date")
      .eq("client_id", clientId)
      .eq("provider", "meta_ads")
      .is("clicks_all", null)
      .gte("date", fromDate)
      .lt("date", upper)
      .order("date", { ascending: false })
      .limit(1000);
    if (error || !data || data.length === 0) break;
    for (const r of data) stale.add(r.date as string);
    // Every date of this page is in the set now; continue strictly before
    // the oldest one so each page yields at least one new day.
    upper = data[data.length - 1].date as string;
    if (data.length < 1000) break;
  }
  return stale;
}

/**
 * After a day was re-pulled from every account, rows Meta no longer reports
 * for it (e.g. a campaign deleted since) would keep clicks_all NULL and get
 * that day re-pulled forever. Close them with clicks_all = their stored
 * clicks - the best we can know for a row Meta won't return any more.
 * Upsert of key columns + clicks_all only touches clicks_all.
 */
async function closeStaleClickRows(
  admin: ReturnType<typeof createAdminClient>,
  clientId: string,
  days: string[]
): Promise<void> {
  if (!days.length) return;
  const { data, error } = await admin
    .from("ads_daily")
    .select("campaign_id, date, clicks")
    .eq("client_id", clientId)
    .eq("provider", "meta_ads")
    .in("date", days)
    .is("clicks_all", null)
    // PostgREST caps a page at 1000; any rest is closed on a later run.
    .limit(1000);
  if (error || !data || data.length === 0) return;
  const rows = data.map((r) => ({
    client_id: clientId,
    provider: "meta_ads",
    campaign_id: r.campaign_id as string,
    date: r.date as string,
    clicks_all: Number(r.clicks ?? 0),
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error: upErr } = await admin
      .from("ads_daily")
      .upsert(rows.slice(i, i + 500), { onConflict: "client_id,provider,campaign_id,date" });
    if (upErr) {
      console.warn("[cron/refresh-ads-meta] closing stale click rows failed", upErr.message);
      return;
    }
  }
}

export async function GET(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const admin = createAdminClient();
  const now = new Date();
  const until = formatInTimeZone(now, WARSAW_TZ, "yyyy-MM-dd");
  const since = formatInTimeZone(subDays(now, 1), WARSAW_TZ, "yyyy-MM-dd");

  // Optional ?client=<id> scopes the run to a single client (used by on-demand
  // refresh) so large accounts don't time out competing with other clients.
  const onlyClient = new URL(request.url).searchParams.get("client");

  let q = admin
    .from("integrations")
    .select("client_id, credentials_encrypted, account_ids")
    .eq("provider", "meta_ads");
  if (onlyClient) q = q.eq("client_id", onlyClient);
  const { data: integrations } = await q;

  // Migration 0034: with clicks_all, `clicks` holds LINK clicks. Probed once
  // per run; without it rows are written exactly as before (all clicks).
  // Strict: a transient probe error must not flip the write shape mid-history.
  let withClicksAll: boolean;
  try {
    withClicksAll = await hasClicksAllColumnStrict(admin, "ads_daily");
  } catch (probeErr) {
    return NextResponse.json(
      { ok: false, error: describeError(probeErr) },
      { status: 503 }
    );
  }

  let integrationsProcessed = 0;
  let campaignsUpserted = 0;
  let accountsFailed = 0;
  let staleDaysQueued = 0;

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

      // Keep a full year of history (clients compare year-over-year).
      // Fresh days first, then backfill CONTIGUOUSLY BACKWARDS from the
      // earliest row we already have - so a timeout mid-backfill just means
      // the next run resumes where this one stopped, with no gaps.
      const HISTORY_DAYS = 365;
      const windowStart = formatInTimeZone(
        subDays(now, HISTORY_DAYS - 1),
        WARSAW_TZ,
        "yyyy-MM-dd"
      );
      // Always refresh yesterday+today; then fill every day in the window we
      // don't have yet (newest first). This covers both extending history
      // backwards AND holes in the middle left by killed runs.
      const present = await presentDates(
        admin,
        integration.client_id as string,
        "meta_ads",
        windowStart
      );
      // Cap historical work per run (BACKFILL_BUDGET_MS cuts it shorter on big
      // accounts); successive runs (cron / manual refresh) continue.
      const MAX_BACKFILL_PER_RUN = 150;
      // One-time history re-pull after migration 0034: days whose rows still
      // carry clicks (all) count as missing, newest first, within the same
      // per-run cap - a year converts over a few runs.
      const stale = withClicksAll
        ? await staleClickDates(
            admin,
            integration.client_id as string,
            windowStart,
            since,
            MAX_BACKFILL_PER_RUN
          )
        : new Set<string>();
      const backfillEnd = formatInTimeZone(subDays(now, 2), WARSAW_TZ, "yyyy-MM-dd");
      let candidates = eachDay(windowStart, backfillEnd).filter(
        (d) => !present.has(d) || stale.has(d)
      );

      // Only accounts explicitly selected for this client (avoids pulling
      // every account the agency user can access into one client's data).
      const accounts = (
        (integration.account_ids ?? []) as MetaAccount[]
      ).filter((a) => a.selected === true);

      // A day with no rows is either a hole or a day with no delivery at all
      // (history shorter than a year, a paused month). The latter used to be
      // re-pulled on EVERY run, forever - up to 150 empty requests per
      // account per run, starving real backfill. Ask Meta once which days had
      // any delivery and only treat those as missing. Unknown (call failed)
      // -> keep the old behaviour.
      if (
        candidates.some((d) => !stale.has(d)) &&
        accounts.length &&
        Date.now() - startedAt <= BACKFILL_BUDGET_MS
      ) {
        try {
          const active = new Set<string>();
          for (const account of accounts) {
            const days = await getActiveDays(
              access_token,
              account.id,
              candidates[0],
              backfillEnd
            );
            days.forEach((d) => active.add(d));
          }
          candidates = candidates.filter((d) => stale.has(d) || active.has(d));
        } catch (activeErr) {
          console.warn(
            "[cron/refresh-ads-meta] active-day probe failed, backfilling every missing day",
            describeError(activeErr)
          );
        }
      }

      const backfill = candidates.reverse().slice(0, MAX_BACKFILL_PER_RUN);
      staleDaysQueued += backfill.filter((d) => stale.has(d)).length;
      const freshDays = eachDay(since, until);
      const dayList: string[] = [...freshDays, ...backfill];

      const accountErrors: string[] = [];
      // Per-integration count: campaignsUpserted spans every client, so it
      // can't tell us whether THIS client actually received any data.
      let writtenForClient = 0;

      // Isolate each ad account so one disabled/error account doesn't sink all.
      for (const [accountIndex, account] of accounts.entries()) {
        const isLastAccount = accountIndex === accounts.length - 1;
        try {
          // Fetch days in small parallel batches (sequential was the wall-clock
          // bottleneck on year-long backfills), upserting per day so progress
          // persists even if the function is killed mid-backfill.
          const CONCURRENCY = 4;
          for (let i = 0; i < dayList.length; i += CONCURRENCY) {
            // Past the budget only the fresh days (first batch) still run;
            // the remaining backfill continues on the next tick.
            if (i >= freshDays.length && Date.now() - startedAt > BACKFILL_BUDGET_MS) {
              break;
            }
            const batch = dayList.slice(i, i + CONCURRENCY);
            const results = await Promise.all(
              batch.map(async (day) => ({
                day,
                insights: await getCampaignInsights(
                  access_token,
                  account.id,
                  day,
                  day
                ),
              }))
            );
            for (const { insights } of results) {
              if (!insights.length) continue;
              const dayRows = insights.map((insight) => ({
                client_id: integration.client_id,
                provider: "meta_ads",
                campaign_id: insight.campaign_id,
                campaign_name: insight.campaign_name,
                date: insight.date,
                spend_minor_units: Math.round(parseFloat(insight.spend) * 100),
                impressions: parseInt(insight.impressions, 10) || 0,
                // clicks = link clicks, clicks_all = clicks (all), CTR/CPC
                // per link click - or the pre-0034 shape without the column.
                ...metaClickColumns(insight, withClicksAll),
                reach: insight.reach != null ? parseInt(insight.reach, 10) : null,
                frequency:
                  insight.frequency != null ? parseFloat(insight.frequency) : null,
                conversions: extractConversions(insight.actions),
                raw_data: insight as unknown as Record<string, unknown>,
              }));
              const { error } = await admin
                .from("ads_daily")
                .upsert(dayRows, { onConflict: "client_id,provider,campaign_id,date" });
              if (error) throw new Error(error.message);
              campaignsUpserted += dayRows.length;
              writtenForClient += dayRows.length;
            }
            // Every account has now re-pulled these days (accounts run in
            // order), so leftover pre-0034 rows are ones Meta no longer
            // reports. Skipped when an account failed - its rows may still be
            // re-pulled on the next run.
            if (withClicksAll && isLastAccount && accountErrors.length === 0) {
              await closeStaleClickRows(admin, integration.client_id as string, batch);
            }
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

      await admin
        .from("sync_runs")
        .update({
          ...resolveSyncOutcome({
            accountsSelected: accounts.length,
            rowsWritten: writtenForClient,
            accountErrors,
          }),
          finished_at: new Date().toISOString(),
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
    link_clicks: withClicksAll,
    stale_click_days_queued: staleDaysQueued,
  });
}
