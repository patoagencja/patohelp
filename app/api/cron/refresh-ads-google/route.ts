import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { isCronAuthorized } from "@/lib/integrations/cron-auth";
import { seasonalOrShopIds } from "@/lib/ab/eligibility";
import {
  AccountErrors,
  datesMissingRawKey,
  eachDay,
  patchRowsMissingRawKey,
  toRanges,
} from "@/lib/integrations/ads-daily-history";
import {
  deferredFirst,
  leastRecentFirst,
  newestSuccessByClient,
  presentAdDates,
  splitRanges,
} from "@/lib/integrations/cron-runs";
import { decrypt } from "@/lib/integrations/encryption";
import { describeError } from "@/lib/integrations/errors";
import { createFxConverter, normalizeCurrency } from "@/lib/integrations/fx";
import { hasClicksAllColumn } from "@/lib/integrations/link-clicks";
import { resolveSyncOutcome } from "@/lib/integrations/sync-status";
import {
  cachedActiveDays,
  isDue,
  readSyncState,
  rememberActiveDays,
  writeSyncState,
  type ActiveDayCache,
} from "@/lib/integrations/sync-state";
import {
  getCampaignMetrics,
  getDeliveryDays,
  getPurchaseMetrics,
  syncImpressionShareSnapshot,
  syncSearchTermsSnapshot,
  type GoogleCampaignMetric,
  type GooglePurchaseMetric,
} from "@/lib/integrations/google-ads";
import { addDaysIso } from "@/lib/season/config";
import { historyDaysFor } from "@/lib/season/history";
import { createAdminClient } from "@/lib/supabase/admin";

// Vercel Cron: pull Google Ads campaign metrics for yesterday+today into
// ads_daily, plus whatever history is due (see below). GAQL's segments.date
// returns per-day rows, so one query per account and range covers it. Auth
// via `Authorization: Bearer <CRON_SECRET>`.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WARSAW_TZ = "Europe/Warsaw";

// No client starts, and no account starts its yesterday+today query, after
// this (the first account of a started client excepted). Every GAQL query
// is capped at 25 s (google-ads.ts), so the last one plus its write still
// ends inside maxDuration. Clients and accounts left out lead the next run
// (oldest success first, deferred accounts first) - before, every client
// ran whatever the time, and a killed function wrote nothing for the client
// it was on and left its sync_runs row "running".
const RUN_DEADLINE_MS = 30_000;
// Don't START a snapshot step after this much of maxDuration (60s) is used -
// leaves ~25s for the step itself so the function isn't killed mid-run.
const SNAPSHOT_START_BUDGET_MS = 35_000;
// No client starts its history setup after this much time; later clients
// get yesterday+today and their history on a quieter tick.
const HISTORY_BUDGET_MS = 20_000;
// No history query (delivery probe or range) starts after this much time:
// with the 25 s query cap it is over by ~50 s. It used to be 40 s, which let
// a range query start too late to finish inside the 60 s function.
const HISTORY_STOP_MS = 25_000;
/** Longest history range one query asks for (it must finish under the cap). */
const MAX_RANGE_DAYS = 62;
/**
 * Every client pulls D-14..D-2 again once a day per account: Google keeps
 * attributing conversions to earlier clicks for weeks, for engagement
 * clients as much as for shops. The old full-window refetch covered that
 * for everyone; without it a day kept whatever it read as "yesterday".
 */
const MATURE_FROM = 14;
const MATURE_TO = 2;
const MATURE_EVERY_MS = 20 * 3_600_000;
/** History range queries per account per run (newest first; the rest next run). */
const MAX_RANGES_PER_ACCOUNT = 4;
/** Missing days at most this far apart go out as one range. */
const MERGE_GAP_DAYS = 7;
/** A scan that found no pre-purchase-only rows is trusted this long. */
const PURCHASE_SCAN_TTL_MS = 7 * 24 * 3_600_000;
const STATE_KEY = "google_ads";

interface GoogleAccount {
  id: string;
  selected?: boolean;
  /** Only pull YouTube (VIDEO) campaigns for this account. */
  video_only?: boolean;
  /** customer.currency_code saved at connect time (fallback only). */
  currency?: string;
}

interface GoogleSyncState {
  /** Days each account delivered on, learned once a Warsaw day. */
  active?: ActiveDayCache;
  /** Accounts the run deadline left without fresh days last run: first next. */
  deferred?: string[];
  /**
   * account id -> days it delivered on (account level) that came back
   * without a single campaign row when fetched: only since-REMOVED
   * campaigns ran then. Past days don't change, so they are never asked
   * again (pruned as they leave the window).
   */
  empty?: Record<string, string[]>;
  /** account id -> when its D-14..D-2 re-pull last completed. */
  mature?: Record<string, string>;
  /** Last purchase_source scan that found nothing left to re-pull. */
  purchaseScanCleanAt?: string;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** 03:00-04:59 Warsaw: the fallback slot for once-a-day work. */
function isNightlyWindow(now: Date): boolean {
  const hour = Number(formatInTimeZone(now, WARSAW_TZ, "H"));
  return hour === 3 || hour === 4;
}

/** What one account fetched this run (for the bookkeeping after the loops). */
interface AccountTrack {
  /** Days fetched AND written. */
  fetchedDays: Set<string>;
  /** Days written with purchase-only values. */
  purchaseDays: Set<string>;
  /** Days with at least one campaign row from the API. */
  daysWithRows: Set<string>;
}

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const pastDeadline = () => elapsed() > RUN_DEADLINE_MS;
  const historyStopped = () => elapsed() > HISTORY_STOP_MS;
  const admin = createAdminClient();
  await admin.rpc("cleanup_expired_oauth_states");

  const now = new Date();
  const until = formatInTimeZone(now, WARSAW_TZ, "yyyy-MM-dd");
  const since = formatInTimeZone(subDays(now, 1), WARSAW_TZ, "yyyy-MM-dd");
  const historyEnd = addDaysIso(until, -2);

  const onlyClient = new URL(request.url).searchParams.get("client");
  let q = admin
    .from("integrations")
    .select("client_id, credentials_encrypted, account_ids")
    .eq("provider", "google_ads");
  if (onlyClient) q = q.eq("client_id", onlyClient);
  const { data: integrations } = await q;

  // Migration 0034 adds clicks_all; Google ad clicks are link-like, so both
  // columns carry the same number. Omitted until the column exists.
  const withClicksAll = await hasClicksAllColumn(admin, "ads_daily");
  const clientIds = (integrations ?? []).map((i) => i.client_id as string);
  // Seasonal clients and shops: purchase-only values.
  const eligibleIds = await seasonalOrShopIds(admin, clientIds);
  // One converter per run: each NBP block is fetched once for all clients.
  const fx = createFxConverter();
  // Oldest successful Google sync first, so the clients a deadline left out
  // lead the next run.
  const ordered = leastRecentFirst(
    integrations ?? [],
    (i) => i.client_id as string,
    await newestSuccessByClient(admin, "google_ads", clientIds)
  );

  let integrationsProcessed = 0;
  let campaignsUpserted = 0;
  let accountsFailed = 0;
  let historyRanges = 0;
  let clientsDeferred = 0;
  let accountsDeferred = 0;
  const snapshotJobs: Array<{
    clientId: string;
    refreshToken: string;
    accounts: GoogleAccount[];
    currencies: Map<string, string | null>;
  }> = [];

  for (const integration of ordered) {
    const clientId = integration.client_id as string;
    if (pastDeadline()) {
      // Not started, so no sync_runs row: waiting for the next tick is not
      // a failing integration (the health check's 12 h staleness rule
      // still catches a client that never gets its turn).
      clientsDeferred += 1;
      continue;
    }
    const { data: run } = await admin
      .from("sync_runs")
      .insert({
        client_id: clientId,
        provider: "google_ads",
        status: "running",
      })
      .select("id")
      .single();

    try {
      const { refresh_token } = JSON.parse(
        decrypt(integration.credentials_encrypted as string)
      );
      const eligible = eligibleIds.has(clientId);

      // Keep a year of history (seasonal clients ~15 months, a whole
      // previous season to compare against right to the end of this one).
      const historyDays = await historyDaysFor(admin, clientId);
      const backfillStart = formatInTimeZone(
        subDays(now, historyDays - 1),
        WARSAW_TZ,
        "yyyy-MM-dd"
      );

      const stateRead = await readSyncState<GoogleSyncState>(admin, clientId, STATE_KEY);
      const state: GoogleSyncState = { ...(stateRead.value ?? {}) };
      let stateChanged = false;
      // Saved as each account completes: a function killed later in the
      // run no longer throws away the probes and stamps already earned.
      const saveState = async () => {
        if (!stateChanged) return;
        stateChanged = false;
        await writeSyncState(admin, clientId, STATE_KEY, state);
      };

      // Only accounts explicitly selected for this client; the ones the
      // deadline left out last run go first.
      const accounts = deferredFirst(
        ((integration.account_ids ?? []) as GoogleAccount[]).filter((a) => a.selected === true),
        state.deferred
      );

      const withinHistoryBudget = elapsed() < HISTORY_BUDGET_MS;
      // Days with no row at all. Most are days nothing ran (an off-season
      // month, a Christmas pause) - re-fetching the whole window whenever
      // one existed did that on every run, for ever. Only days the account
      // actually delivered on are fetched (see `active` below).
      let gapDays: string[] = [];
      // Rows stored before purchase-only values existed (or while the client
      // wasn't a shop / seasonal) carry every primary conversion as
      // "purchase value": pulled again once, newest first.
      let noSource = new Set<string>();
      if (withinHistoryBudget) {
        const present = await presentAdDates(admin, clientId, "google_ads", backfillStart);
        gapDays = backfillStart <= historyEnd
          ? eachDay(backfillStart, historyEnd).filter((d) => !present.has(d))
          : [];
        if (eligible && isDue(state.purchaseScanCleanAt, PURCHASE_SCAN_TTL_MS)) {
          const found = await datesMissingRawKey(
            admin,
            clientId,
            "google_ads",
            "purchase_source",
            backfillStart,
            since,
            historyDays
          );
          if (found) {
            noSource = found;
            if (found.size === 0) {
              state.purchaseScanCleanAt = new Date().toISOString();
              stateChanged = true;
            }
          }
        }
      }

      const errors = new AccountErrors();
      const failedAccounts = new Set<string>();
      const currencies = new Map<string, string | null>();
      // campaign|date -> purchase-only numbers (PLN), for the leftover rows
      // of removed campaigns when a day is closed below.
      const purchaseByKey = new Map<string, { purchases: number; value: number }>();
      const tracks = new Map<string, AccountTrack>();
      const trackOf = (accountId: string): AccountTrack => {
        let t = tracks.get(accountId);
        if (!t) {
          t = { fetchedDays: new Set(), purchaseDays: new Set(), daysWithRows: new Set() };
          tracks.set(accountId, t);
        }
        return t;
      };
      let writtenForClient = 0;

      /**
       * Fetch one range of one account and write its rows at once. They
       * used to be kept in memory until the client's last account: a
       * function killed in between wrote nothing for the client, not even
       * today. Throws when the metrics query or the write fails.
       */
      const syncRange = async (account: GoogleAccount, range: { since: string; until: string }) => {
        const videoOnly = account.video_only === true;
        const track = trackOf(account.id);
        // Purchase-only values for seasonal clients and shops, asked side
        // by side with the metrics so a range costs one query's time; if
        // the segmented query fails the old totals stay, marked as such.
        const [metricsRes, purchasesRes] = await Promise.allSettled([
          getCampaignMetrics(refresh_token, account.id, range.since, range.until, videoOnly),
          eligible
            ? getPurchaseMetrics(refresh_token, account.id, range.since, range.until, videoOnly)
            : Promise.resolve(null),
        ]);
        if (metricsRes.status === "rejected") throw metricsRes.reason;
        const metrics = metricsRes.value;
        let purchases: Map<string, GooglePurchaseMetric> | null = null;
        if (purchasesRes.status === "fulfilled") {
          if (purchasesRes.value) {
            purchases = new Map(purchasesRes.value.map((p) => [`${p.campaign_id}|${p.date}`, p]));
          }
        } else {
          console.warn(
            `[cron/refresh-ads-google] purchase-only query failed for ${account.id}, keeping all conversions`,
            describeError(purchasesRes.reason)
          );
        }
        for (const m of metrics) track.daysWithRows.add(m.date);

        const currency =
          normalizeCurrency(metrics.find((m) => m.currency)?.currency) ??
          normalizeCurrency(account.currency);
        if (metrics.length && !currencies.has(account.id)) currencies.set(account.id, currency);
        const skippedDays = new Set<string>();
        // Keyed by campaign+day: one statement never carries a row twice.
        const rows = new Map<string, Record<string, unknown>>();
        for (const metric of metrics) {
          const rate = await fx.rate(currency, metric.date);
          if (rate == null) {
            // Never store foreign money as złoty: skip this day.
            if (!skippedDays.has(metric.date)) {
              skippedDays.add(metric.date);
              errors.add(
                account.id,
                currency
                  ? `brak kursu NBP ${currency} dla ${metric.date}`
                  : "nieznana waluta konta"
              );
            }
            continue;
          }
          rows.set(
            `${metric.campaign_id}|${metric.date}`,
            buildRow(clientId, metric, rate, currency, purchases, eligible, withClicksAll)
          );
        }
        // Chunked: a long range is thousands of rows, too big for one
        // PostgREST request.
        const list = [...rows.values()];
        for (let i = 0; i < list.length; i += 1000) {
          const chunk = list.slice(i, i + 1000);
          const { error } = await admin
            .from("ads_daily")
            .upsert(chunk, { onConflict: "client_id,provider,campaign_id,date" });
          if (error) throw new Error(error.message);
          campaignsUpserted += chunk.length;
          writtenForClient += chunk.length;
        }
        if (purchases && currency) {
          // Removed campaigns appear only here; keep them for closing.
          for (const p of purchases.values()) {
            const rate = await fx.rate(currency, p.date);
            if (rate != null) {
              purchaseByKey.set(`${p.campaign_id}|${p.date}`, {
                purchases: p.purchases,
                value: round2(p.value * rate),
              });
            }
          }
        }
        for (const d of eachDay(range.since, range.until)) {
          if (skippedDays.has(d)) continue;
          track.fetchedDays.add(d);
          if (purchases) track.purchaseDays.add(d);
        }
      };

      const accountFailed = (account: GoogleAccount, accErr: unknown) => {
        failedAccounts.add(account.id);
        errors.add(account.id, describeError(accErr));
        console.error(
          `[cron/refresh-ads-google] account ${account.id} failed`,
          describeError(accErr)
        );
      };

      // 1. Yesterday + today for every account first. One bad account
      // (manager account, no access, etc.) must not sink the whole sync -
      // each account is isolated.
      const freshOk = new Set<string>();
      const deferred: string[] = [];
      let attempted = 0;
      for (const account of accounts) {
        // The first account always runs: a started client does real work,
        // so its row never records a "sync" in which nothing was asked.
        if (attempted > 0 && pastDeadline()) {
          deferred.push(account.id);
          continue;
        }
        attempted += 1;
        try {
          await syncRange(account, { since, until });
          freshOk.add(account.id);
        } catch (accErr) {
          accountFailed(account, accErr);
        }
      }
      accountsDeferred += deferred.length;
      if ((state.deferred ?? []).join(",") !== deferred.join(",")) {
        state.deferred = deferred.length ? deferred : undefined;
        stateChanged = true;
      }
      await saveState();

      // 2. History per account while the run has room for it (the rest
      // continues next run).
      for (const account of accounts) {
        if (!withinHistoryBudget || historyStopped()) break;
        if (!freshOk.has(account.id)) continue;
        const videoOnly = account.video_only === true;
        let matureDays: string[] = [];
        // Gap days this account delivered on (account level) - for the
        // "fetched empty" memory below.
        let deliveredGaps = new Set<string>();
        const knownEmpty = new Set(state.empty?.[account.id] ?? []);

        const wantedDays = new Set<string>(noSource);
        if (gapDays.length) {
          let active = cachedActiveDays(state.active, until, account.id, gapDays[0], historyEnd);
          if (!active) {
            try {
              active = await getDeliveryDays(
                refresh_token,
                account.id,
                gapDays[0],
                historyEnd,
                videoOnly
              );
              state.active = rememberActiveDays(
                state.active,
                until,
                account.id,
                gapDays[0],
                historyEnd,
                active
              );
              stateChanged = true;
            } catch (probeErr) {
              // Unknown: fetch the missing days (the old, costlier way).
              console.warn(
                `[cron/refresh-ads-google] active-day probe failed for ${account.id}`,
                describeError(probeErr)
              );
              active = new Set(gapDays);
            }
          }
          deliveredGaps = new Set(gapDays.filter((d) => active.has(d)));
          for (const d of deliveredGaps) if (!knownEmpty.has(d)) wantedDays.add(d);
        }
        // Unreadable state would make every run look due: then only at night.
        // All clients; only the purchase-only query stays with seasonal
        // clients and shops.
        const matureAllowed = stateRead.ok || isNightlyWindow(now);
        if (matureAllowed && isDue(state.mature?.[account.id], MATURE_EVERY_MS)) {
          matureDays = eachDay(addDaysIso(until, -MATURE_FROM), addDaysIso(until, -MATURE_TO));
          matureDays.forEach((d) => wantedDays.add(d));
        }
        const history = splitRanges(toRanges(wantedDays, MERGE_GAP_DAYS), MAX_RANGE_DAYS).slice(
          0,
          MAX_RANGES_PER_ACCOUNT
        );

        try {
          for (const range of history) {
            // A probe or an earlier range may have used the room up.
            if (historyStopped()) break;
            historyRanges += 1;
            await syncRange(account, range);
          }
        } catch (accErr) {
          accountFailed(account, accErr);
        }

        const track = trackOf(account.id);
        if (matureDays.length && matureDays.every((d) => track.fetchedDays.has(d))) {
          state.mature = { ...(state.mature ?? {}), [account.id]: new Date().toISOString() };
          stateChanged = true;
        }
        // Delivered (account level) yet no campaign row once fetched: only
        // since-removed campaigns ran. Remember it, or the day stays a gap
        // and is fetched again on every run.
        const newlyEmpty = [...deliveredGaps].filter(
          (d) => track.fetchedDays.has(d) && !track.daysWithRows.has(d) && !knownEmpty.has(d)
        );
        const kept = [...knownEmpty].filter((d) => d >= backfillStart);
        if (newlyEmpty.length || kept.length !== knownEmpty.size) {
          state.empty = { ...(state.empty ?? {}), [account.id]: [...kept, ...newlyEmpty].sort() };
          stateChanged = true;
        }
        await saveState();
      }
      accountsFailed += failedAccounts.size;

      // Days every account re-pulled with purchase-only values: rows still
      // without a source belong to campaigns removed since (or to accounts
      // no longer selected) - close them so the day stops counting as due.
      // (An account whose segmented query failed leaves the day open.)
      if (eligible && noSource.size && accounts.length) {
        const doneBy = new Map<string, number>();
        for (const t of tracks.values()) {
          for (const d of t.purchaseDays) doneBy.set(d, (doneBy.get(d) ?? 0) + 1);
        }
        const closable = [...noSource].filter((d) => (doneBy.get(d) ?? 0) >= accounts.length);
        await patchRowsMissingRawKey(admin, clientId, "google_ads", "purchase_source", closable, (row) => {
          const p = purchaseByKey.get(`${row.campaign_id}|${row.date}`);
          return {
            purchases: p?.purchases ?? 0,
            purchase_value: p?.value ?? 0,
            purchase_source: "purchase",
          };
        });
      }

      await saveState();

      if (deferred.length) {
        console.warn(
          `[cron/refresh-ads-google] ${deferred.length} of ${accounts.length} accounts left for the next run (deadline)`
        );
      }
      await admin
        .from("sync_runs")
        .update({
          ...resolveSyncOutcome({
            // Accounts left for the next run were neither synced nor
            // broken: judge the run by the accounts it actually asked.
            accountsSelected: accounts.length - deferred.length,
            rowsWritten: writtenForClient,
            accountErrors: errors.list(),
          }),
          finished_at: new Date().toISOString(),
        })
        .eq("id", run?.id);
      integrationsProcessed += 1;

      // Once-a-day snapshots are deferred until EVERY client's main sync is
      // done: run inline, a slow first-of-day snapshot for one client could
      // push the next client's main sync past maxDuration and leave its
      // sync_runs row stuck on "running".
      snapshotJobs.push({
        clientId,
        refreshToken: refresh_token,
        accounts,
        currencies,
      });
    } catch (err) {
      const message = describeError(err);
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

  // Extra once-a-day snapshots, after all sync_runs rows are closed: they
  // must never change a sync's outcome or its health status. Each step is
  // isolated, and none starts once the budget is spent - a skipped snapshot
  // is simply retried on the next tick, a killed function is not harmless.
  const periodStart = addDaysIso(until, -29);
  for (const job of snapshotJobs) {
    if (Date.now() - startedAt > SNAPSHOT_START_BUDGET_MS) break;
    // 30-day sums: converted at the period's mean NBP rate. Accounts with
    // no known currency keep the old PLN assumption.
    const pricePerUnit = new Map<string, number | null>();
    for (const account of job.accounts) {
      const currency = job.currencies.get(account.id) ?? normalizeCurrency(account.currency);
      if (currency && currency !== "PLN") {
        pricePerUnit.set(account.id, await fx.averageRate(currency, periodStart, until));
      }
    }
    try {
      await syncSearchTermsSnapshot(
        admin,
        job.clientId,
        job.refreshToken,
        job.accounts,
        until,
        pricePerUnit
      );
    } catch (stErr) {
      console.error(
        "[cron/refresh-ads-google] search terms failed",
        describeError(stErr)
      );
    }

    if (Date.now() - startedAt > SNAPSHOT_START_BUDGET_MS) break;
    try {
      await syncImpressionShareSnapshot(
        admin,
        job.clientId,
        job.refreshToken,
        job.accounts,
        until,
        pricePerUnit
      );
    } catch (isErr) {
      console.error(
        "[cron/refresh-ads-google] impression share failed",
        describeError(isErr)
      );
    }
  }

  return NextResponse.json({
    ok: true,
    integrations_processed: integrationsProcessed,
    campaigns_upserted: campaignsUpserted,
    accounts_failed: accountsFailed,
    history_ranges: historyRanges,
    clients_deferred: clientsDeferred,
    accounts_deferred: accountsDeferred,
  });
}

/** One ads_daily row: money converted to PLN grosze at `rate`. */
function buildRow(
  clientId: string,
  metric: GoogleCampaignMetric,
  rate: number,
  currency: string | null,
  purchases: Map<string, GooglePurchaseMetric> | null,
  eligible: boolean,
  withClicksAll: boolean
): Record<string, unknown> {
  // Shops / seasonal: purchase-only numbers when the segmented query
  // worked (no row there = no purchase that day); otherwise every primary
  // conversion, as before, labelled so nobody mistakes it for sales.
  const p = purchases?.get(`${metric.campaign_id}|${metric.date}`);
  const sale = purchases
    ? { purchases: p?.purchases ?? 0, value: p?.value ?? 0, source: "purchase" }
    : { purchases: metric.conversions ?? 0, value: metric.conversions_value ?? 0, source: "all_conversions" };
  const foreign = currency !== "PLN";
  return {
    client_id: clientId,
    provider: "google_ads",
    campaign_id: metric.campaign_id,
    campaign_name: metric.campaign_name,
    date: metric.date,
    spend_minor_units: Math.round((metric.cost_micros * rate) / 10_000),
    impressions: metric.impressions,
    clicks: metric.clicks,
    ...(withClicksAll ? { clicks_all: metric.clicks } : {}),
    ctr: metric.ctr,
    cpc_minor_units:
      metric.average_cpc != null ? Math.round((metric.average_cpc * rate) / 10_000) : null,
    reach: null,
    frequency: null,
    conversions: metric.conversions != null ? Math.round(metric.conversions) : null,
    // Sales-from-ads for shop clients (lib/season): kept in raw_data so it
    // needs no migration; same keys as the Meta rows. Major units, PLN.
    raw_data: {
      status: metric.status,
      purchases: sale.purchases,
      purchase_value: round2(sale.value * rate),
      // Only shops / seasonal clients get the label: a row without it is
      // re-pulled once when the client becomes one.
      ...(eligible ? { purchase_source: sale.source } : {}),
      ...(foreign
        ? {
            currency,
            fx_rate: rate,
            spend_original: metric.cost_micros / 1_000_000,
            purchase_value_original: sale.value,
          }
        : {}),
    } as Record<string, unknown>,
  };
}
