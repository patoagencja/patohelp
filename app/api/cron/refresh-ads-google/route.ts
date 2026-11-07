import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { isCronAuthorized } from "@/lib/integrations/cron-auth";
import { seasonalOrShopIds } from "@/lib/ab/eligibility";
import {
  AccountErrors,
  datesMissingRawKey,
  eachDay,
  patchRowsByKey,
  patchRowsMissingRawKey,
  startHistoryProgress,
  toRanges,
} from "@/lib/integrations/ads-daily-history";
import {
  chunkByDay,
  deferredFirst,
  leastRecentFirst,
  newestAttemptByClient,
  splitRanges,
  stampsByClient,
} from "@/lib/integrations/cron-runs";
import { decrypt } from "@/lib/integrations/encryption";
import { describeError } from "@/lib/integrations/errors";
import { createFxConverter, normalizeCurrency } from "@/lib/integrations/fx";
import {
  clearRedo,
  closableDays,
  decodeProgress,
  encodeProgress,
  leastServedFirst,
  markFetched,
  markRedone,
  markServed,
  pendingDays,
  plannedDays,
  sameProgress,
  settleUndelivered,
  type FlaggedDays,
  type HistoryProgress,
  type HistoryWindow,
} from "@/lib/integrations/history-progress";
import { hasClicksAllColumn } from "@/lib/integrations/link-clicks";
import { purchaseCreditedDays, removedPurchasePatches } from "@/lib/integrations/removed-purchases";
import { resolveSyncOutcome } from "@/lib/integrations/sync-status";
import {
  cachedActiveDays,
  isDue,
  readSyncState,
  readSyncStates,
  rememberActiveDays,
  writeSyncState,
  type ActiveDayCache,
} from "@/lib/integrations/sync-state";
import {
  getCampaignMetrics,
  getDeliveryDays,
  getPurchaseMetrics,
  GoogleAdsTimeoutError,
  syncImpressionShareSnapshot,
  syncSearchTermsSnapshot,
  withQueryTimeout,
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
// of this route is capped at QUERY_CAP_MS, so the last one plus its write
// still ends inside maxDuration. Clients and accounts left out lead the next
// run (least recently started first, deferred accounts first) - before,
// every client ran whatever the time, and a killed function wrote nothing
// for the client it was on and left its sync_runs row "running".
const RUN_DEADLINE_MS = 30_000;
/** Per GAQL query of this route (google-ads.ts withQueryTimeout). */
const QUERY_CAP_MS = 25_000;
// Don't START a snapshot step after this much of maxDuration (60s) is used -
// leaves ~25s for the step itself so the function isn't killed mid-run.
const SNAPSHOT_START_BUDGET_MS = 35_000;
// History runs in a second pass, after every started client has its
// yesterday+today. No client but the one whose turn it is (least recently
// served first) starts its history setup after this much time.
const HISTORY_BUDGET_MS = 20_000;
// The turn itself needs the first pass to end before HISTORY_STOP_MS. With
// enough clients it ends near RUN_DEADLINE_MS every time and no history ran
// at all - so when nobody had a turn for this long (the last run gave none),
// this run stops starting clients and accounts at RESERVED_DEADLINE_MS. The
// ones left out lead the next run; history gets a turn at least every
// other run.
const TURN_GAP_MS = 45 * 60_000;
const RESERVED_DEADLINE_MS = 10_000;
// No history query (delivery probe or range) starts after this much time:
// with the 25 s query cap it is over by ~50 s. It used to be 40 s, which let
// a range query start too late to finish inside the 60 s function.
const HISTORY_STOP_MS = 25_000;
// A history range may start at HISTORY_STOP_MS and wait QUERY_CAP_MS: the
// removed-campaign patches after it (a read and a write per flagged day)
// stop here, leaving the rest uncounted (re-pulled later) instead of
// running the 60 s function out of time.
const PATCH_STOP_MS = 52_000;
/** Longest history range one query asks for (it must finish under the cap). */
const MAX_RANGE_DAYS = 62;
/**
 * An account whose history range hit the query cap asks for half as many
 * days next time (kept in sync state), down to this. Failing the account
 * instead stopped its history at the same range on every run.
 */
const MIN_RANGE_DAYS = 7;
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
   * Before per-account history progress: account id -> days it delivered
   * on that came back without a campaign row (only since-REMOVED campaigns
   * ran). Read once into `history` (a fetched day is done, rows or not),
   * then dropped.
   */
  empty?: Record<string, string[]>;
  /**
   * Per account: days fetched or without delivery, flagged days re-pulled,
   * whose history went last (lib/integrations/history-progress).
   */
  history?: HistoryProgress;
  /** account id -> when its D-14..D-2 re-pull last completed. */
  mature?: Record<string, string>;
  /** Last purchase_source scan that found nothing left to re-pull. */
  purchaseScanCleanAt?: string;
  /** account id -> history range length after a range hit the query cap. */
  rangeDays?: Record<string, number>;
  /** When this client last had the run's history turn. */
  historyTurnAt?: string;
}

/** A started client's history step, run once every client has fresh days. */
interface PendingHistory {
  clientId: string;
  failedAccounts: Set<string>;
  history: (turn: boolean) => Promise<void>;
  fail: (message: string) => Promise<void>;
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
}

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return withQueryTimeout(QUERY_CAP_MS, () => sync(request));
}

async function sync(request: Request) {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  // Set below once the history turns are known.
  let deadlineMs = RUN_DEADLINE_MS;
  const pastDeadline = () => elapsed() > deadlineMs;
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
  // Least recently started first, so the clients a deadline left out lead
  // the next run (and a client whose queries keep timing out doesn't lead,
  // and stall, every run).
  const ordered = leastRecentFirst(
    integrations ?? [],
    (i) => i.client_id as string,
    await newestAttemptByClient(admin, "google_ads", clientIds)
  );
  // Whose history turn it is: least recently served first.
  const turnStates = await readSyncStates<GoogleSyncState>(admin, clientIds, STATE_KEY);
  const turnStamps = stampsByClient(turnStates, (s) => s.historyTurnAt);
  const lastTurn = Math.max(0, ...turnStamps.values());
  // Unreadable stamps say nothing about the last turn: no reservation then,
  // or every run would start fewer clients for as long as the store is down.
  const reserveTurn =
    !onlyClient && turnStates !== null && clientIds.length > 0 && Date.now() - lastTurn > TURN_GAP_MS;
  if (reserveTurn) deadlineMs = RESERVED_DEADLINE_MS;
  const pending: PendingHistory[] = [];
  // client id -> its recorded outcome (sync/run reads its own client's).
  const clientRuns: Record<string, { status: string; error_message: string | null }> = {};

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
        // An unreadable state was replaced by an empty one above: writing it
        // would wipe what is stored (history progress, delivery answers)
        // over a read blip. The next run reads it again.
        if (!stateChanged || !stateRead.ok) return;
        stateChanged = false;
        await writeSyncState(admin, clientId, STATE_KEY, state);
      };

      // Only accounts explicitly selected for this client; the ones the
      // deadline left out last run go first.
      const accounts = deferredFirst(
        ((integration.account_ids ?? []) as GoogleAccount[]).filter((a) => a.selected === true),
        state.deferred
      );

      const errors = new AccountErrors();
      const failedAccounts = new Set<string>();
      const currencies = new Map<string, string | null>();
      const tracks = new Map<string, AccountTrack>();
      const trackOf = (accountId: string): AccountTrack => {
        let t = tracks.get(accountId);
        if (!t) {
          t = { fetchedDays: new Set(), purchaseDays: new Set() };
          tracks.set(accountId, t);
        }
        return t;
      };
      let writtenForClient = 0;

      // Which days each account has fetched (or had no delivery on), kept
      // across runs (lib/integrations/history-progress). History used to
      // treat a day as done once ANY account had a row for it, so an account
      // the history stop cut off before that day never fetched it. null =
      // not known this run (no record yet, unreadable state): no backfill.
      let progress = stateRead.ok ? decodeProgress(state.history) : null;
      if (stateRead.ok && state.history !== undefined && !progress) {
        // Started again below (bootstrap): say so, it re-checks the recent window.
        console.warn(`[cron/refresh-ads-google] history progress of ${clientId} unreadable, starting it again`);
      }
      // Set once history has its window; the flagged days once scanned.
      let historyWindow: HistoryWindow | null = null;
      let noSource: Set<string> | null = null;
      // Accounts whose history ran this run: they go last next run.
      const served = new Set<string>();
      /** This run's fetches into the record (idempotent); kept if it changed. */
      const recordProgress = () => {
        // No selected account (a reconnect gone wrong, "0 of 46"): nothing
        // learned, and nothing of the record may be lost over it.
        if (!progress || !accounts.length) return;
        for (const [accountId, t] of tracks) {
          // Today is still changing; yesterday from the fresh pass counts.
          markFetched(progress, accountId, t.fetchedDays, until);
          // Only days written with purchase-only values re-pull a flagged day.
          if (noSource) markRedone(progress, "purchase", accountId, t.purchaseDays, noSource);
        }
        markServed(progress, served);
        const next = encodeProgress(progress, {
          from: historyWindow?.from,
          accounts: accounts.map((a) => a.id),
        });
        if (!sameProgress(next, state.history)) {
          state.history = next;
          stateChanged = true;
        }
        // Read into the record at its start; a fetched day is done now.
        if (state.empty) {
          state.empty = undefined;
          stateChanged = true;
        }
      };

      /**
       * Fetch one range of one account and write its rows at once. They
       * used to be kept in memory until the client's last account: a
       * function killed in between wrote nothing for the client, not even
       * today. Throws when the metrics query or the write fails.
       */
      const syncRange = async (
        account: GoogleAccount,
        range: { since: string; until: string },
        isHistory = false
      ) => {
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
        // A past range written without purchase-only values is labelled
        // "all conversions" for good (the label is what marks it done):
        // a timed-out purchase query there is the range's timeout, and the
        // range is asked again, smaller. Fresh days are rewritten every run.
        if (
          isHistory &&
          purchasesRes.status === "rejected" &&
          purchasesRes.reason instanceof GoogleAdsTimeoutError
        ) {
          throw purchasesRes.reason;
        }
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
        // PostgREST request. Cut between days, newest first: a function
        // killed mid-range must not leave a half-written day on the
        // dashboard (the range is only recorded as fetched once it is all
        // written, so the account fetches it again).
        for (const chunk of chunkByDay([...rows.values()], (r) => String(r.date), 1000)) {
          const { error } = await admin
            .from("ads_daily")
            .upsert(chunk, { onConflict: "client_id,provider,campaign_id,date" });
          if (error) throw new Error(error.message);
          campaignsUpserted += chunk.length;
          writtenForClient += chunk.length;
        }
        // Removed campaigns appear only in the purchase query, and their
        // numbers exist only now: on flagged history days their rows are
        // patched here, by exact key, before the account counts as having
        // re-pulled the day (lib/integrations/removed-purchases). A day that
        // can't be (no rate, a failed read or write) isn't counted, so the
        // account re-pulls it - and closing a day writes 0 only for
        // campaigns that truly had no purchases.
        const unpatched = new Set<string>();
        if (isHistory && purchases && noSource?.size) {
          const flaggedDays = noSource;
          const rates = new Map<string, number | null>();
          for (const p of purchases.values()) {
            if (!flaggedDays.has(p.date) || rates.has(p.date) || rows.has(`${p.campaign_id}|${p.date}`)) continue;
            rates.set(p.date, currency ? await fx.rate(currency, p.date) : null);
          }
          const { byDay, unpatchable } = removedPurchasePatches(
            purchases.values(),
            new Set(rows.keys()),
            flaggedDays,
            (d) => rates.get(d) ?? null
          );
          unpatchable.forEach((d) => unpatched.add(d));
          for (const [date, byCampaign] of byDay) {
            if (elapsed() > PATCH_STOP_MS) {
              unpatched.add(date);
              continue;
            }
            if (await patchRowsByKey(admin, clientId, "google_ads", "purchase_source", date, byCampaign)) continue;
            unpatched.add(date);
            console.warn(
              `[cron/refresh-ads-google] removed campaigns' purchases on ${date} not written for ${account.id}, day re-pulled later`
            );
          }
        }
        const rangeDays = eachDay(range.since, range.until);
        for (const d of rangeDays) if (!skippedDays.has(d)) track.fetchedDays.add(d);
        for (const d of purchaseCreditedDays(rangeDays, {
          purchasesAnswered: purchases !== null,
          skipped: skippedDays,
          unpatched,
        })) {
          track.purchaseDays.add(d);
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
      // Yesterday's fetches are recorded now, in case the function dies
      // before history.
      recordProgress();
      await saveState();
      if (deferred.length) {
        console.warn(
          `[cron/refresh-ads-google] ${deferred.length} of ${accounts.length} accounts left for the next run (deadline)`
        );
      }

      const recordOutcome = async () => {
        const outcome = resolveSyncOutcome({
          // Accounts left for the next run were neither synced nor
          // broken: judge the run by the accounts it actually asked.
          accountsSelected: accounts.length - deferred.length,
          rowsWritten: writtenForClient,
          accountErrors: errors.list(),
        });
        clientRuns[clientId] = outcome;
        await admin
          .from("sync_runs")
          .update({ ...outcome, finished_at: new Date().toISOString() })
          .eq("id", run?.id);
      };
      // Closed now with the fresh days' outcome (updated after history):
      // the next clients' fresh days come before anyone's history, and a
      // row must not sit on "running" meanwhile.
      await recordOutcome();
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

      // 2. History - in the second pass below, after every started client
      // has its fresh days - per account while the run has room for it (the
      // rest continues next run).
      const history = async (turn: boolean) => {
        // The turn's setup may start until the query stop; the others' only
        // within the shared budget.
        const setupOpen = turn ? !historyStopped() : elapsed() < HISTORY_BUDGET_MS;
        // A turn with no room left (a slow fresh pass) stays for next run.
        if (turn && setupOpen) {
          state.historyTurnAt = new Date().toISOString();
          stateChanged = true;
        }
        const window: HistoryWindow = { from: backfillStart, to: historyEnd };
        if (setupOpen) {
          historyWindow = window;
          // First run with per-account progress: what is stored already
          // counts for every account except the recent window (see
          // startHistoryProgress), plus the old "fetched, no rows" memory.
          // Not with an unreadable state: it could not be saved.
          if (!progress && stateRead.ok) {
            progress = await startHistoryProgress(admin, {
              clientId,
              provider: "google_ads",
              windowStart: backfillStart,
              today: until,
              accounts: accounts.map((a) => a.id),
              known: state.empty,
              // The bootstrap's count queries end with the history queries.
              deadline: startedAt + HISTORY_STOP_MS,
            });
          }
          // Rows stored before purchase-only values existed (or while the
          // client wasn't a shop / seasonal) carry every primary conversion
          // as "purchase value": pulled again once by every account, newest
          // first.
          if (progress && eligible && isDue(state.purchaseScanCleanAt, PURCHASE_SCAN_TTL_MS)) {
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
        // Re-pulled by every account, delivery or not (as before): a video-
        // only account's probe doesn't see REMOVED campaigns, and their
        // purchase values come only with a re-pull.
        const flagged: FlaggedDays[] = noSource
          ? [{ kind: "purchase", days: noSource, ignoreDelivery: true }]
          : [];
        const answerOf = (accountId: string) => state.active?.byAccount?.[accountId];

        // Least recently served first: with a fixed order the first
        // account's ranges could use the history time up on every run.
        for (const account of leastServedFirst(accounts, progress?.order)) {
          if (!setupOpen || historyStopped()) break;
          if (!freshOk.has(account.id)) continue;
          const videoOnly = account.video_only === true;
          let matureDays: string[] = [];

          // The days this account delivered on and has not fetched, whatever
          // rows other accounts left for them. Most days without a fetch are
          // days it didn't run (an off-season month, a Christmas pause) -
          // re-fetching the whole window whenever one existed did that on
          // every run, for ever - so only delivered days are fetched.
          const wantedDays = new Set<string>();
          const view = progress;
          if (view && backfillStart <= historyEnd) {
            settleUndelivered(view, account.id, answerOf(account.id), window, flagged);
            // Flagged days go out whatever the delivery: only the backfill
            // needs the probe.
            const pending = pendingDays(view, account.id, window);
            let probeOk = true;
            if (pending.length && !cachedActiveDays(state.active, until, account.id, pending[0], historyEnd)) {
              try {
                const active = await getDeliveryDays(
                  refresh_token,
                  account.id,
                  pending[0],
                  historyEnd,
                  videoOnly
                );
                state.active = rememberActiveDays(
                  state.active,
                  until,
                  account.id,
                  pending[0],
                  historyEnd,
                  active
                );
                stateChanged = true;
              } catch (probeErr) {
                // Unknown: fetch the pending days (the old, costlier way).
                console.warn(
                  `[cron/refresh-ads-google] active-day probe failed for ${account.id}`,
                  describeError(probeErr)
                );
                probeOk = false;
              }
            }
            const answer = answerOf(account.id);
            settleUndelivered(view, account.id, answer, window, flagged);
            // Ranges, not days, are the limit here (MAX_RANGES_PER_ACCOUNT).
            plannedDays(view, account.id, answer, window, flagged, {
              includeUnknown: !probeOk,
              cap: Number.MAX_SAFE_INTEGER,
            }).forEach((d) => wantedDays.add(d));
          }
          // Unreadable state would make every run look due: then only at night.
          // All clients; only the purchase-only query stays with seasonal
          // clients and shops.
          const matureAllowed = stateRead.ok || isNightlyWindow(now);
          if (matureAllowed && isDue(state.mature?.[account.id], MATURE_EVERY_MS)) {
            matureDays = eachDay(addDaysIso(until, -MATURE_FROM), addDaysIso(until, -MATURE_TO));
            matureDays.forEach((d) => wantedDays.add(d));
          }
          const rangeDays = state.rangeDays?.[account.id] ?? MAX_RANGE_DAYS;
          const ranges = splitRanges(toRanges(wantedDays, MERGE_GAP_DAYS), rangeDays).slice(
            0,
            MAX_RANGES_PER_ACCOUNT
          );

          try {
            for (const range of ranges) {
              // A probe or an earlier range may have used the room up.
              if (historyStopped()) break;
              historyRanges += 1;
              served.add(account.id);
              await syncRange(account, range, true);
            }
          } catch (accErr) {
            if (accErr instanceof GoogleAdsTimeoutError && rangeDays > MIN_RANGE_DAYS) {
              // Too much for one query: half the days next run. Not an
              // account failure - nothing is wrong with its access.
              state.rangeDays = {
                ...(state.rangeDays ?? {}),
                [account.id]: Math.max(MIN_RANGE_DAYS, Math.floor(rangeDays / 2)),
              };
              stateChanged = true;
              console.warn(
                `[cron/refresh-ads-google] history range timed out for ${account.id}, next run asks ${state.rangeDays[account.id]} days`
              );
            } else {
              accountFailed(account, accErr);
            }
          }

          const track = trackOf(account.id);
          if (matureDays.length && matureDays.every((d) => track.fetchedDays.has(d))) {
            state.mature = { ...(state.mature ?? {}), [account.id]: new Date().toISOString() };
            stateChanged = true;
          }
          recordProgress();
          await saveState();
        }

        if (progress) {
          recordProgress();
          if (eligible && noSource?.size) {
            // Days every account has re-pulled with purchase-only values, in
            // this run or an earlier one. Each re-pull already wrote its
            // removed campaigns' purchases (syncRange) before it counted, so
            // rows still without a source are campaigns with no purchases
            // that day (or of accounts no longer selected): close them with
            // 0 so the day stops counting as due. Counted within one run,
            // accounts the history stop cut off kept the day open for ever.
            // (An account whose segmented query failed leaves the day open.)
            await patchRowsMissingRawKey(
              admin,
              clientId,
              "google_ads",
              "purchase_source",
              closableDays(progress, "purchase", noSource, accounts.map((a) => a.id)),
              () => ({ purchases: 0, purchase_value: 0, purchase_source: "purchase" })
            );
          }
          // Nothing flagged any more (or no purchase values wanted): the
          // re-pull record is done with. A later flag starts afresh.
          if (!eligible || noSource?.size === 0) clearRedo(progress, "purchase");
          recordProgress();
        }

        await saveState();
        await recordOutcome();
      };

      pending.push({
        clientId,
        failedAccounts,
        history,
        fail: async (message) => {
          // The fresh days stand; the failed history step is a note on them.
          // What it learned (the turn taken, probes, stamps, the days each
          // account fetched) is kept too, or the same turn would come round
          // again on every run.
          errors.add("historia", message);
          recordProgress();
          await saveState();
          await recordOutcome();
        },
      });
    } catch (err) {
      const message = describeError(err);
      console.error("[cron/refresh-ads-google] integration failed", message);
      clientRuns[clientId] = { status: "failed", error_message: message };
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

  // Second pass: history, once every started client has today's numbers.
  // The client whose turn it is goes first; a turn moves on once taken, so
  // every client's history advances within a few runs instead of the first
  // client's history pushing the others' fresh days past the deadline.
  const historyOrder = leastRecentFirst(pending, (p) => p.clientId, turnStamps);
  for (const [index, p] of historyOrder.entries()) {
    try {
      await p.history(index === 0);
    } catch (err) {
      const message = describeError(err);
      console.error("[cron/refresh-ads-google] history failed", message);
      await p.fail(message);
    } finally {
      accountsFailed += p.failedAccounts.size;
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
    history_turn_reserved: reserveTurn,
    // Not printed by the scheduler (objects are filtered from its log).
    client_runs: clientRuns,
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
