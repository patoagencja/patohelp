import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { seasonalOrShopIds } from "@/lib/ab/eligibility";
import {
  AccountErrors,
  datesMissingRawKey,
  eachDay,
  patchRowsMissingRawKey,
  toRanges,
} from "@/lib/integrations/ads-daily-history";
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

// Don't START a snapshot step after this much of maxDuration (60s) is used -
// leaves ~25s for the step itself so the function isn't killed mid-run.
const SNAPSHOT_START_BUDGET_MS = 35_000;
// No client starts its history ranges after this much time; later clients
// get yesterday+today and their history on a quieter tick.
const HISTORY_BUDGET_MS = 20_000;
// No single history range query starts after this much time.
const HISTORY_STOP_MS = 40_000;
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

export async function GET(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
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
  // Seasonal clients and shops: purchase-only values.
  const eligibleIds = await seasonalOrShopIds(
    admin,
    (integrations ?? []).map((i) => i.client_id as string)
  );
  // One converter per run: each NBP block is fetched once for all clients.
  const fx = createFxConverter();

  let integrationsProcessed = 0;
  let campaignsUpserted = 0;
  let accountsFailed = 0;
  let historyRanges = 0;
  const snapshotJobs: Array<{
    clientId: string;
    refreshToken: string;
    accounts: GoogleAccount[];
    currencies: Map<string, string | null>;
  }> = [];

  for (const integration of integrations ?? []) {
    const clientId = integration.client_id as string;
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
      const present = new Set<string>();
      for (let offset = 0; ; offset += 1000) {
        const { data: dateRows } = await admin
          .from("ads_daily")
          .select("date")
          .eq("client_id", clientId)
          .eq("provider", "google_ads")
          .gte("date", backfillStart)
          .order("date", { ascending: true })
          .range(offset, offset + 999);
        for (const r of dateRows ?? []) present.add(r.date as string);
        if (!dateRows || dateRows.length < 1000) break;
      }
      // Days with no row at all. Most are days nothing ran (an off-season
      // month, a Christmas pause) - re-fetching the whole window whenever
      // one existed did that on every run, for ever. Only days the account
      // actually delivered on are fetched (see `active` below).
      const gapDays = backfillStart <= historyEnd
        ? eachDay(backfillStart, historyEnd).filter((d) => !present.has(d))
        : [];

      // Only accounts explicitly selected for this client.
      const accounts = ((integration.account_ids ?? []) as GoogleAccount[]).filter(
        (a) => a.selected === true
      );

      const stateRead = await readSyncState<GoogleSyncState>(admin, clientId, STATE_KEY);
      const state: GoogleSyncState = { ...(stateRead.value ?? {}) };
      let stateChanged = false;
      const withinHistoryBudget = Date.now() - startedAt < HISTORY_BUDGET_MS;

      // Rows stored before purchase-only values existed (or while the client
      // wasn't a shop / seasonal) carry every primary conversion as
      // "purchase value": pulled again once, newest first.
      let noSource = new Set<string>();
      if (
        eligible &&
        withinHistoryBudget &&
        isDue(state.purchaseScanCleanAt, PURCHASE_SCAN_TTL_MS)
      ) {
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

      const rows = new Map<string, Record<string, unknown>>();
      const errors = new AccountErrors();
      const currencies = new Map<string, string | null>();
      // campaign|date -> purchase-only numbers (PLN), for the leftover rows
      // of removed campaigns when a day is closed below.
      const purchaseByKey = new Map<string, { purchases: number; value: number }>();
      // day -> accounts that re-pulled it with purchase-only values (an
      // account whose segmented query failed leaves the day open).
      const doneBy = new Map<string, number>();

      // One bad account (manager account, no access, etc.) must not sink the
      // whole sync - isolate each account.
      for (const account of accounts) {
        const videoOnly = account.video_only === true;
        const ranges: Array<{ since: string; until: string }> = [{ since, until }];
        let matureDays: string[] = [];
        // Gap days this account delivered on (account level) - for the
        // "fetched empty" memory below.
        let deliveredGaps = new Set<string>();
        const knownEmpty = new Set(state.empty?.[account.id] ?? []);

        if (withinHistoryBudget) {
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
          // All clients; only the purchase-only query below stays with
          // seasonal clients and shops.
          const matureAllowed = stateRead.ok || isNightlyWindow(now);
          if (matureAllowed && isDue(state.mature?.[account.id], MATURE_EVERY_MS)) {
            matureDays = eachDay(addDaysIso(until, -MATURE_FROM), addDaysIso(until, -MATURE_TO));
            matureDays.forEach((d) => wantedDays.add(d));
          }
          const history = toRanges(wantedDays, MERGE_GAP_DAYS).slice(0, MAX_RANGES_PER_ACCOUNT);
          historyRanges += history.length;
          ranges.push(...history);
        }

        // Days written from this account / written with purchase-only values
        // / with at least one campaign row from the API.
        const fetchedDays = new Set<string>();
        const purchaseDays = new Set<string>();
        const daysWithRows = new Set<string>();
        try {
          for (const [rangeIndex, range] of ranges.entries()) {
            // The fresh range always runs; history ranges only while the
            // 60 s function has room (the rest continues next run).
            if (rangeIndex > 0 && Date.now() - startedAt > HISTORY_STOP_MS) break;
            const metrics = await getCampaignMetrics(
              refresh_token,
              account.id,
              range.since,
              range.until,
              videoOnly
            );
            for (const m of metrics) daysWithRows.add(m.date);
            // Purchase-only values for seasonal clients and shops; if the
            // segmented query fails the old totals stay, marked as such.
            let purchases: Map<string, GooglePurchaseMetric> | null = null;
            if (eligible) {
              try {
                const list = await getPurchaseMetrics(
                  refresh_token,
                  account.id,
                  range.since,
                  range.until,
                  videoOnly
                );
                purchases = new Map(list.map((p) => [`${p.campaign_id}|${p.date}`, p]));
              } catch (purchaseErr) {
                console.warn(
                  `[cron/refresh-ads-google] purchase-only query failed for ${account.id}, keeping all conversions`,
                  describeError(purchaseErr)
                );
              }
            }

            const currency =
              normalizeCurrency(metrics.find((m) => m.currency)?.currency) ??
              normalizeCurrency(account.currency);
            if (metrics.length && !currencies.has(account.id)) currencies.set(account.id, currency);
            const skippedDays = new Set<string>();
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
              fetchedDays.add(d);
              if (purchases) purchaseDays.add(d);
            }
          }
        } catch (accErr) {
          accountsFailed += 1;
          errors.add(account.id, describeError(accErr));
          console.error(
            `[cron/refresh-ads-google] account ${account.id} failed`,
            describeError(accErr)
          );
        }

        for (const d of purchaseDays) doneBy.set(d, (doneBy.get(d) ?? 0) + 1);
        if (matureDays.length && matureDays.every((d) => fetchedDays.has(d))) {
          state.mature = { ...(state.mature ?? {}), [account.id]: new Date().toISOString() };
          stateChanged = true;
        }
        // Delivered (account level) yet no campaign row once fetched: only
        // since-removed campaigns ran. Remember it, or the day stays a gap
        // and is fetched again on every run.
        const newlyEmpty = [...deliveredGaps].filter(
          (d) => fetchedDays.has(d) && !daysWithRows.has(d) && !knownEmpty.has(d)
        );
        const kept = [...knownEmpty].filter((d) => d >= backfillStart);
        if (newlyEmpty.length || kept.length !== knownEmpty.size) {
          state.empty = { ...(state.empty ?? {}), [account.id]: [...kept, ...newlyEmpty].sort() };
          stateChanged = true;
        }
      }

      // Chunked: a long re-fetch is tens of thousands of rows, too big for
      // one PostgREST request. Keyed by campaign+day above, so a day in two
      // ranges is never sent twice in one statement.
      const list = [...rows.values()];
      for (let i = 0; i < list.length; i += 1000) {
        const chunk = list.slice(i, i + 1000);
        const { error } = await admin
          .from("ads_daily")
          .upsert(chunk, { onConflict: "client_id,provider,campaign_id,date" });
        if (error) throw new Error(error.message);
        campaignsUpserted += chunk.length;
      }

      // Days every account re-pulled with purchase-only values: rows still
      // without a source belong to campaigns removed since (or to accounts
      // no longer selected) - close them so the day stops counting as due.
      if (eligible && noSource.size && accounts.length) {
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

      if (stateChanged) await writeSyncState(admin, clientId, STATE_KEY, state);

      await admin
        .from("sync_runs")
        .update({
          ...resolveSyncOutcome({
            accountsSelected: accounts.length,
            rowsWritten: list.length,
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
