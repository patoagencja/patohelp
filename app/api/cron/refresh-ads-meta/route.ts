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
  startHistoryProgress,
} from "@/lib/integrations/ads-daily-history";
import {
  closeStaleRuns,
  deferredFirst,
  leastRecentFirst,
  newestAttemptByClient,
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
import { resolveSyncOutcome } from "@/lib/integrations/sync-status";
import { hasClicksAllColumnStrict, metaClickColumns } from "@/lib/integrations/link-clicks";
import {
  describeThrottle,
  extractConversions,
  extractPurchases,
  getActiveDays,
  getCampaignInsights,
  MetaThrottledError,
  type MetaCampaignInsight,
} from "@/lib/integrations/meta-ads";
import {
  isDue,
  readSyncState,
  readSyncStates,
  rememberActiveDays,
  unknownActiveRanges,
  writeSyncState,
  type ActiveDayCache,
} from "@/lib/integrations/sync-state";
import { addDaysIso } from "@/lib/season/config";
import { historyDaysFor } from "@/lib/season/history";
import { createAdminClient } from "@/lib/supabase/admin";

// Vercel Cron: pull Meta Ads campaign insights for yesterday+today into
// ads_daily, plus whatever history is due. Auth via
// `Authorization: Bearer <CRON_SECRET>`.
export const dynamic = "force-dynamic";
// Per-day insight fetching for a large account (DRE ~1900 campaigns) is many
// sequential paginated requests; the deadlines below end a run long before
// this, it is only the safety net for a request that hangs.
export const maxDuration = 300;

const WARSAW_TZ = "Europe/Warsaw";

// No client starts, and no account starts its yesterday+today batch, after
// this much wall time (the first account of a started client excepted, see
// below). With the history turn after it and the batch in flight the run
// ends well under the scheduler's 150 s curl timeout. Fresh days used to run
// for every client whatever the time: with DRE's 46 accounts a run passed
// the scheduler's timeout, it retried while the run was still going
// (overlapping runs -> Meta rate limits -> failures for every client after
// it), and past maxDuration Vercel killed it, leaving the sync_runs row
// "running" and later clients with no row at all. Clients and accounts left
// out lead the next run (least recently started first, deferred accounts
// first).
const RUN_DEADLINE_MS = 70_000;
// "Odśwież" for one client (?client=) has the whole request to itself: all
// of a big client's accounts get today's numbers instead of a deferred tail
// the button could only report as missing. In-flight batch included it
// still answers inside sync/run's 280 s.
const SINGLE_CLIENT_DEADLINE_MS = 150_000;
// History (setup reads, active-day probes, backfill and mature batches)
// runs only after every started client has its fresh days, and no history
// work starts after this - except for the client whose turn it is.
const BACKFILL_BUDGET_MS = 45_000;
// The run's history turn goes round the clients (least recently served
// first) and always gets this long, measured from its own start: a fresh
// pass that alone outlasts the budget (DRE's 46 accounts) must not mean
// that client's history - backfill, re-pulls - never runs again.
const TURN_SLICE_MS = 15_000;
// Cap historical work per run (BACKFILL_BUDGET_MS cuts it shorter on big
// accounts); successive runs (cron / manual refresh) continue.
const MAX_BACKFILL_PER_RUN = 150;
/** Newest unknown days asked about per run: one probe request per account. */
const PROBE_DAYS = 92;
/**
 * Seasonal clients and shops pull D-7..D-2 again once a day: Meta keeps
 * attributing purchases to past days for its whole attribution window, and
 * days synced only as "yesterday" made this season read low next to a
 * fully matured previous one.
 */
const MATURE_FROM = 7;
const MATURE_TO = 2;
const MATURE_EVERY_MS = 20 * 3_600_000;
/** A scan that found no rows without purchase values is trusted this long. */
const PURCHASE_SCAN_TTL_MS = 7 * 24 * 3_600_000;
const STATE_KEY = "meta_ads";
/** sync_runs note for clients an app-wide limit (code 4) left out of a run. */
const APP_THROTTLE_SKIP_MESSAGE =
  "Meta ograniczyła liczbę zapytań aplikacji - pominięto w tym przebiegu, ponowimy za ~30 min";
/** Days fetched side by side per account (sequential was the bottleneck). */
const CONCURRENCY = 4;

interface MetaAccount {
  id: string;
  selected?: boolean;
  /** Account currency saved at connect time (fallback only). */
  currency?: string;
}

interface MetaSyncState {
  /** Days each account delivered on, learned once a Warsaw day. */
  active?: ActiveDayCache;
  /** Accounts the run deadline left without fresh days last run: first next. */
  deferred?: string[];
  /** account id -> when its D-7..D-2 re-pull last completed. */
  mature?: Record<string, string>;
  /** Last purchase_value scan that found nothing left to re-pull. */
  purchaseScanCleanAt?: string;
  /** When this client last had the run's history turn. */
  historyTurnAt?: string;
  /**
   * Per account: days fetched or without delivery, flagged days re-pulled,
   * whose history went last (lib/integrations/history-progress).
   */
  history?: HistoryProgress;
}

/** A started client's history step, run once every client has fresh days. */
interface PendingHistory {
  clientId: string;
  failedAccounts: Set<string>;
  /** Under a Meta limit: no history this run, so no turn either. */
  blocked: () => boolean;
  history: (open: () => boolean, turn: boolean) => Promise<void>;
  fail: (message: string) => Promise<void>;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** 03:00-04:59 Warsaw: the fallback slot for once-a-day work. */
function isNightlyWindow(now: Date): boolean {
  const hour = Number(formatInTimeZone(now, WARSAW_TZ, "H"));
  return hour === 3 || hour === 4;
}

/**
 * The newest days (at most `limit`) since `fromDate` that still hold Meta rows
 * from before migration 0034 (clicks_all IS NULL: `clicks` there is clicks
 * (all), not link clicks). They are re-pulled like missing days so charts and
 * year-over-year compare link clicks with link clicks. Walks back a page at a
 * time from the newest stale row, so it reads a few pages, not the whole year.
 * null when the first page can't be read: an unread scan must not look like
 * "nothing stale left" (that clears the accounts' re-pull progress).
 */
async function staleClickDates(
  admin: ReturnType<typeof createAdminClient>,
  clientId: string,
  fromDate: string,
  beforeDate: string,
  limit: number
): Promise<Set<string> | null> {
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
    if (error) return guard === 0 ? null : stale;
    if (!data || data.length === 0) break;
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

/**
 * One ads_daily row from a campaign-day insight, money converted to PLN at
 * `rate` (1 for PLN accounts). Foreign accounts keep their own currency and
 * amounts in raw_data.
 */
function buildRow(
  clientId: string,
  insight: MetaCampaignInsight,
  rate: number,
  currency: string | null,
  eligible: boolean,
  withClicksAll: boolean
): Record<string, unknown> {
  const foreign = currency !== "PLN";
  const scale = (v?: string) =>
    v != null && v !== "" && foreign ? String(parseFloat(v) * rate) : v;
  // metaClickColumns turns the CPC strings into grosze; scaled first, it
  // rounds once, on the PLN amount.
  const clickInput = foreign
    ? { ...insight, cpc: scale(insight.cpc), link_cpc: scale(insight.link_cpc) }
    : insight;
  const sale = eligible ? extractPurchases(insight.actions, insight.action_values) : null;
  const spend = parseFloat(insight.spend) || 0;
  return {
    client_id: clientId,
    provider: "meta_ads",
    campaign_id: insight.campaign_id,
    campaign_name: insight.campaign_name,
    date: insight.date,
    spend_minor_units: Math.round(spend * rate * 100),
    impressions: parseInt(insight.impressions, 10) || 0,
    // clicks = link clicks, clicks_all = clicks (all), CTR/CPC per link
    // click - or the pre-0034 shape without the column.
    ...metaClickColumns(clickInput, withClicksAll),
    reach: insight.reach != null ? parseInt(insight.reach, 10) : null,
    frequency: insight.frequency != null ? parseFloat(insight.frequency) : null,
    conversions: extractConversions(insight.actions),
    raw_data: {
      ...insight,
      // purchases / purchase_value (PLN, major units): sales from ads for
      // seasonal clients and shops (lib/season), same keys as the Google
      // rows. Left out for everyone else - without action_values they would
      // read 0, and a missing key is what marks a day for re-pull once the
      // client becomes seasonal or a shop.
      ...(sale ? { purchases: sale.purchases, purchase_value: round2(sale.value * rate) } : {}),
      ...(foreign
        ? {
            currency,
            fx_rate: rate,
            spend_original: spend,
            ...(sale ? { purchase_value_original: sale.value } : {}),
          }
        : {}),
    } as unknown as Record<string, unknown>,
  };
}

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  // Optional ?client=<id> scopes the run to a single client (used by on-demand
  // refresh) so large accounts don't time out competing with other clients.
  const onlyClient = new URL(request.url).searchParams.get("client");
  const deadlineMs = onlyClient ? SINGLE_CLIENT_DEADLINE_MS : RUN_DEADLINE_MS;
  const pastDeadline = () => Date.now() - startedAt > deadlineMs;
  const withinBackfill = () => Date.now() - startedAt <= BACKFILL_BUDGET_MS;
  const admin = createAdminClient();
  // Rows a killed function left on "running" (any provider) are closed as
  // failed, instead of staying "running" for ever.
  await closeStaleRuns(admin);

  const now = new Date();
  const until = formatInTimeZone(now, WARSAW_TZ, "yyyy-MM-dd");
  const since = formatInTimeZone(subDays(now, 1), WARSAW_TZ, "yyyy-MM-dd");
  const backfillEnd = addDaysIso(until, -2);

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

  const clientIds = (integrations ?? []).map((i) => i.client_id as string);
  // Seasonal clients and shops: purchase values, the mature re-pull.
  const eligibleIds = await seasonalOrShopIds(admin, clientIds);
  // One converter per run: each NBP block is fetched once for all clients.
  const fx = createFxConverter();
  // The client least recently started goes first: a run the deadline cuts
  // short leaves the clients it never started at the head of the next one,
  // instead of the same clients at the end of the list missing out every
  // time (or one failing client leading, and stalling, every run).
  const ordered = leastRecentFirst(
    integrations ?? [],
    (i) => i.client_id as string,
    await newestAttemptByClient(admin, "meta_ads", clientIds, APP_THROTTLE_SKIP_MESSAGE)
  );
  // Whose history turn it is: least recently served first.
  const turnStamps = stampsByClient(
    await readSyncStates<MetaSyncState>(admin, clientIds, STATE_KEY),
    (s) => s.historyTurnAt
  );
  const pending: PendingHistory[] = [];
  // client id -> its recorded outcome (sync/run reads its own client's).
  const clientRuns: Record<string, { status: string; error_message: string | null }> = {};

  let integrationsProcessed = 0;
  let campaignsUpserted = 0;
  let accountsFailed = 0;
  let accountsThrottled = 0;
  let staleDaysQueued = 0;
  // An app-wide limit (code 4) blocks every client: stop calling Meta for
  // the rest of the run instead of hammering it with doomed requests.
  let appThrottle: MetaThrottledError | null = null;
  let clientsSkipped = 0;
  let clientsDeferred = 0;
  let accountsDeferred = 0;

  for (const integration of ordered) {
    const clientId = integration.client_id as string;
    if (appThrottle) {
      clientsSkipped += 1;
      // Without a row the health banner said nothing while this client's
      // numbers went stale; the next tick retries.
      await admin.from("sync_runs").insert({
        client_id: clientId,
        provider: "meta_ads",
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: APP_THROTTLE_SKIP_MESSAGE,
      });
      continue;
    }
    if (pastDeadline()) {
      // Not started, so no sync_runs row: a client waiting for the next
      // tick is not a failing integration. Its older last start puts it
      // first next run; if that keeps not happening, the health check's
      // "no success for 12 h" still speaks up.
      clientsDeferred += 1;
      continue;
    }
    const { data: run } = await admin
      .from("sync_runs")
      .insert({
        client_id: clientId,
        provider: "meta_ads",
        status: "running",
      })
      .select("id")
      .single();

    try {
      const { access_token } = JSON.parse(
        decrypt(integration.credentials_encrypted as string)
      );
      const eligible = eligibleIds.has(clientId);

      const stateRead = await readSyncState<MetaSyncState>(admin, clientId, STATE_KEY);
      const state: MetaSyncState = { ...(stateRead.value ?? {}) };
      let stateChanged = false;
      const saveState = async () => {
        // An unreadable state was replaced by an empty one above: writing it
        // would wipe what is stored (history progress, delivery answers)
        // over a read blip. The next run reads it again.
        if (!stateChanged || !stateRead.ok) return;
        stateChanged = false;
        await writeSyncState(admin, clientId, STATE_KEY, state);
      };

      // Only accounts explicitly selected for this client (avoids pulling
      // every account the agency user can access into one client's data).
      // Accounts the deadline left out last run go first.
      const accounts = deferredFirst(
        ((integration.account_ids ?? []) as MetaAccount[]).filter((a) => a.selected === true),
        state.deferred
      );

      const errors = new AccountErrors();
      // Accounts that sit out the rest of this run (throttled, broken, or
      // a failed write).
      const stopped = new Set<string>();
      // Accounts with a non-throttle failure (counted once each).
      const failedAccounts = new Set<string>();
      // A per-user limit (code 17 without the per-account subcode) covers
      // every account of this token; a per-account one only that account.
      let clientThrottle: MetaThrottledError | null = null;
      const onThrottle = (accountId: string, err: MetaThrottledError) => {
        accountsThrottled += 1;
        stopped.add(accountId);
        errors.add(accountId, describeThrottle(err));
        if (err.scope === "app") appThrottle = err;
        else if (err.scope === "user") clientThrottle = err;
      };
      const blockedBy = (): MetaThrottledError | null => appThrottle ?? clientThrottle;

      // Per-integration count: campaignsUpserted spans every client, so it
      // can't tell us whether THIS client actually received any data.
      let writtenForClient = 0;
      // account -> days it fetched (and, if they had rows, wrote).
      const doneDays = new Map<string, Set<string>>();

      // Which days each account has fetched (or had no delivery on), kept
      // across runs (lib/integrations/history-progress). History used to
      // treat a day as done once ANY account had a row for it, so accounts
      // a run's budget cut off before that day never fetched it. null = not
      // known this run (no record yet, unreadable state): no backfill then.
      let progress = stateRead.ok ? decodeProgress(state.history) : null;
      // Set once history has its window; the flagged days once scanned.
      let historyWindow: HistoryWindow | null = null;
      let stale: Set<string> | null = null;
      let noPurchase: Set<string> | null = null;
      // Accounts whose history ran this run: they go last next run.
      const served = new Set<string>();
      /** This run's fetches into the record (idempotent); kept if it changed. */
      const recordProgress = () => {
        if (!progress) return;
        for (const [accountId, days] of doneDays) {
          // Today is still changing; yesterday from the fresh pass counts.
          markFetched(progress, accountId, days, until);
          if (stale) markRedone(progress, "clicks", accountId, days, stale);
          if (noPurchase) markRedone(progress, "purchase", accountId, days, noPurchase);
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
      };

      /**
       * Fetch `days` of one account side by side and write every day that
       * came back - a failed or throttled day no longer takes the others of
       * its batch down with it. False = this account stops for the run
       * (throttled, every day of the batch failed - the account itself is
       * broken -, or a write failed).
       */
      const runBatch = async (account: MetaAccount, days: string[]): Promise<boolean> => {
        const done = doneDays.get(account.id) ?? new Set<string>();
        doneDays.set(account.id, done);
        const settled = await Promise.allSettled(
          days.map((day) =>
            getCampaignInsights(access_token, account.id, day, day, { actionValues: eligible })
          )
        );
        let throttle: MetaThrottledError | null = null;
        let failed = 0;
        for (const [i, result] of settled.entries()) {
          const day = days[i];
          if (result.status === "rejected") {
            if (result.reason instanceof MetaThrottledError) {
              throttle = throttle ?? result.reason;
              continue;
            }
            failed += 1;
            failedAccounts.add(account.id);
            errors.add(account.id, `${day}: ${describeError(result.reason)}`);
            console.error(
              `[cron/refresh-ads-meta] account ${account.id} day ${day} failed`,
              describeError(result.reason)
            );
            continue;
          }
          const insights = result.value;
          if (!insights.length) {
            done.add(day);
            continue;
          }
          const currency =
            normalizeCurrency(insights.find((r) => r.account_currency)?.account_currency) ??
            normalizeCurrency(account.currency);
          const rate = await fx.rate(currency, day);
          if (rate == null) {
            // Never store foreign money as złoty: this day waits for a rate.
            errors.add(
              account.id,
              currency ? `brak kursu NBP ${currency} dla ${day}` : "nieznana waluta konta"
            );
            continue;
          }
          const dayRows = insights.map((insight) =>
            buildRow(clientId, insight, rate, currency, eligible, withClicksAll)
          );
          const { error } = await admin
            .from("ads_daily")
            .upsert(dayRows, { onConflict: "client_id,provider,campaign_id,date" });
          if (error) {
            failedAccounts.add(account.id);
            errors.add(account.id, `${day}: ${error.message}`);
            console.error(`[cron/refresh-ads-meta] account ${account.id} write failed`, error.message);
            stopped.add(account.id);
            return false;
          }
          campaignsUpserted += dayRows.length;
          writtenForClient += dayRows.length;
          done.add(day);
        }
        if (throttle) {
          // Retrying right away only extends the block.
          onThrottle(account.id, throttle);
          return false;
        }
        if (failed === days.length) {
          stopped.add(account.id);
          return false;
        }
        return true;
      };

      // 1. Yesterday + today for EVERY account before any history work.
      // With history first (per account, and the history setup reads and
      // probes before everything), DRE's first account could spend the
      // whole budget on its backfill while the other 45 still showed
      // yesterday's numbers.
      const freshDays = eachDay(since, until);
      const freshOk = new Set<string>();
      const deferred: string[] = [];
      let attempted = 0;
      for (const account of accounts) {
        const blocked = blockedBy();
        if (blocked) {
          // Recorded per account: a token / app limit mid-run must not read
          // as a clean success with half the accounts missing.
          errors.add(account.id, describeThrottle(blocked));
          continue;
        }
        // The first account always runs: a started client does real work,
        // so its row never records a "sync" in which nothing was asked.
        if (attempted > 0 && pastDeadline()) {
          deferred.push(account.id);
          continue;
        }
        attempted += 1;
        try {
          if (await runBatch(account, freshDays)) freshOk.add(account.id);
        } catch (accErr) {
          // Anything runBatch doesn't handle itself stays this account's.
          failedAccounts.add(account.id);
          errors.add(account.id, describeError(accErr));
          console.error(`[cron/refresh-ads-meta] account ${account.id} failed`, describeError(accErr));
        }
      }
      accountsDeferred += deferred.length;
      if ((state.deferred ?? []).join(",") !== deferred.join(",")) {
        state.deferred = deferred.length ? deferred : undefined;
        stateChanged = true;
      }
      if (deferred.length) {
        console.warn(
          `[cron/refresh-ads-meta] ${deferred.length} of ${accounts.length} accounts left for the next run (deadline)`
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
      // row must not sit on "running" meanwhile. Yesterday's fetches are
      // recorded now too, in case the function dies before history.
      recordProgress();
      await saveState();
      await recordOutcome();
      integrationsProcessed += 1;

      // 2. History - in the second pass below, after every started client
      // has its fresh days - only for the accounts whose fresh days went
      // through, while `open` says there is room.
      const history = async (open: () => boolean, turn: boolean) => {
        // Taken now: next run the turn moves on to the next client.
        if (turn && !blockedBy()) {
          state.historyTurnAt = new Date().toISOString();
          stateChanged = true;
        }
        // Least recently served first: with a fixed order one account's long
        // backlog took every run's history time while the others waited.
        const historyAccounts = leastServedFirst(
          accounts.filter((a) => freshOk.has(a.id)),
          progress?.order
        );
        // account -> its backfill this run, newest first.
        const plans = new Map<string, string[]>();
        if (historyAccounts.length && open() && !blockedBy()) {
          // Keep a full year of history (clients compare year-over-year),
          // newest first - so a run that stops mid-backfill just means the
          // next one resumes where it stopped. Seasonal clients: ~15 months,
          // a whole previous season (lib/season).
          const HISTORY_DAYS = await historyDaysFor(admin, clientId);
          const windowStart = formatInTimeZone(
            subDays(now, HISTORY_DAYS - 1),
            WARSAW_TZ,
            "yyyy-MM-dd"
          );
          const window: HistoryWindow = { from: windowStart, to: backfillEnd };
          historyWindow = window;
          // First run with per-account progress: what is stored already
          // counts for every account except the recent window (see
          // startHistoryProgress). Not with an unreadable state: it could
          // not be saved, and a later run would start over.
          if (!progress && stateRead.ok) {
            progress = await startHistoryProgress(admin, {
              clientId,
              provider: "meta_ads",
              windowStart,
              today: until,
              accounts: accounts.map((a) => a.id),
            });
          }
          const view = progress;

          if (view && windowStart <= backfillEnd) {
            // One-time history re-pull after migration 0034: days whose rows
            // still carry clicks (all) are re-pulled by every account that
            // delivered on them, newest first, within the same per-run cap -
            // a year converts over a few runs.
            stale = withClicksAll
              ? await staleClickDates(admin, clientId, windowStart, since, MAX_BACKFILL_PER_RUN)
              : null;

            // Days synced before purchase values existed (or while the client
            // was neither seasonal nor a shop) read 0 sales from ads - the
            // previous season looked empty. Re-pulled once, newest first, like
            // stale clicks.
            if (
              eligible &&
              open() &&
              isDue(state.purchaseScanCleanAt, PURCHASE_SCAN_TTL_MS)
            ) {
              const found = await datesMissingRawKey(
                admin,
                clientId,
                "meta_ads",
                "purchase_value",
                windowStart,
                since,
                MAX_BACKFILL_PER_RUN
              );
              if (found) {
                noPurchase = found;
                if (found.size === 0) {
                  state.purchaseScanCleanAt = new Date().toISOString();
                  stateChanged = true;
                }
              }
            }
            const flagged: FlaggedDays[] = [];
            if (stale) flagged.push({ kind: "clicks", days: stale });
            if (noPurchase) flagged.push({ kind: "purchase", days: noPurchase });
            const answerOf = (accountId: string) => state.active?.byAccount?.[accountId];

            // A day an account hasn't fetched is either a hole or a day it
            // delivered nothing on (history shorter than the window, an
            // off-season month, a paused account). The latter used to be
            // re-pulled on EVERY run, forever. Meta is asked which days had
            // any delivery, and the answers are kept for good (sync-state): a
            // later run asks only about days never asked before. Only each
            // account's newest PROBE_DAYS pending days are asked about, one
            // request per account: asking a whole year per account every day
            // used up the run's history time before a single day was filled,
            // so the weeks a Meta outage left empty stayed empty. Unknown
            // (call failed) -> keep the old behaviour.
            let probeOk = true;
            for (const account of historyAccounts) {
              // A token / app limit: recorded where it was hit.
              if (blockedBy()) break;
              settleUndelivered(view, account.id, answerOf(account.id), window, flagged);
              const pending = pendingDays(view, account.id, window, flagged);
              if (!pending.length) continue;
              const asked = pending.slice(-PROBE_DAYS);
              const ranges = unknownActiveRanges(state.active, account.id, asked[0], asked[asked.length - 1]);
              if (!ranges.length) continue;
              // Probes are history work too. Past the budget the accounts
              // not probed yet keep their unknown days out of this run; the
              // answers already learned are kept for the next one.
              if (!open()) break;
              try {
                for (const r of ranges) {
                  const got = await getActiveDays(access_token, account.id, r.since, r.until);
                  state.active = rememberActiveDays(state.active, until, account.id, r.since, r.until, got);
                  stateChanged = true;
                }
              } catch (activeErr) {
                if (activeErr instanceof MetaThrottledError) {
                  // Per-account limit: only this account sits out, the
                  // others are still probed and synced.
                  onThrottle(account.id, activeErr);
                  continue;
                }
                probeOk = false;
                console.warn(
                  "[cron/refresh-ads-meta] active-day probe failed, backfilling every unprobed day",
                  describeError(activeErr)
                );
                break;
              }
            }

            // Each account's own backfill: the days it delivered on and has
            // not fetched, whatever rows other accounts left for them.
            // Unknown days older than the asked window wait for a later run.
            const queuedStale = new Set<string>();
            for (const account of historyAccounts) {
              const answer = answerOf(account.id);
              settleUndelivered(view, account.id, answer, window, flagged);
              const days = plannedDays(view, account.id, answer, window, flagged, {
                includeUnknown: !probeOk,
                cap: MAX_BACKFILL_PER_RUN,
              });
              plans.set(account.id, days);
              for (const d of days) if (stale?.has(d)) queuedStale.add(d);
            }
            staleDaysQueued += queuedStale.size;
          }

          // Unreadable state would make every run look due: then only at night.
          const matureAllowed = eligible && (stateRead.ok || isNightlyWindow(now));
          const matureDays = matureAllowed
            ? eachDay(addDaysIso(until, -MATURE_FROM), addDaysIso(until, -MATURE_TO))
            : [];

          for (const account of historyAccounts) {
            // Throttled in the probe: already recorded.
            if (stopped.has(account.id)) continue;
            if (!open() || blockedBy()) break;
            const matureDue =
              matureDays.length > 0 && isDue(state.mature?.[account.id], MATURE_EVERY_MS);
            try {
              // The due mature days and the backfill, newest first, while the
              // budget lasts (the rest continues next tick).
              const historyDays = [
                ...new Set([...(matureDue ? matureDays : []), ...(plans.get(account.id) ?? [])]),
              ].filter((d) => !freshDays.includes(d));
              for (let i = 0; i < historyDays.length; i += CONCURRENCY) {
                if (!open() || blockedBy()) break;
                served.add(account.id);
                if (!(await runBatch(account, historyDays.slice(i, i + CONCURRENCY)))) break;
              }
            } catch (accErr) {
              // Anything runBatch doesn't handle itself stays this account's.
              failedAccounts.add(account.id);
              errors.add(account.id, describeError(accErr));
              console.error(`[cron/refresh-ads-meta] account ${account.id} failed`, describeError(accErr));
            }
            const done = doneDays.get(account.id);
            if (matureDue && done && matureDays.every((d) => done.has(d))) {
              state.mature = { ...(state.mature ?? {}), [account.id]: new Date().toISOString() };
              stateChanged = true;
            }
          }
        }

        if (progress) {
          recordProgress();
          // Flagged days every account has re-pulled - in this run or an
          // earlier one - or delivered nothing on: leftover rows are
          // campaigns Meta no longer reports for that day. Close them so the
          // day stops counting as due. Counted within one run, DRE's 46
          // accounts never all got there, and its first account re-pulled
          // the same days for ever. An account that never re-pulled a day
          // (broken access) keeps it open.
          const accountIds = accounts.map((a) => a.id);
          if (withClicksAll && stale?.size) {
            await closeStaleClickRows(admin, clientId, closableDays(progress, "clicks", stale, accountIds));
          }
          if (noPurchase?.size) {
            await patchRowsMissingRawKey(
              admin,
              clientId,
              "meta_ads",
              "purchase_value",
              closableDays(progress, "purchase", noPurchase, accountIds),
              () => ({ purchases: 0, purchase_value: 0 })
            );
          }
          // Nothing flagged any more (or no purchase values wanted): the
          // re-pull records are done with. A later flag starts afresh.
          if (stale?.size === 0) clearRedo(progress, "clicks");
          if (!eligible || noPurchase?.size === 0) clearRedo(progress, "purchase");
          recordProgress();
        }

        await saveState();
        await recordOutcome();
      };

      pending.push({
        clientId,
        failedAccounts,
        blocked: () => blockedBy() !== null,
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
      console.error("[cron/refresh-ads-meta] integration failed", message);
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
  // The client whose turn it is goes first and gets TURN_SLICE_MS whatever
  // the clock; the others only while the shared budget lasts. A turn moves
  // on once taken, so every client's history advances within a few runs.
  // A client under a Meta limit can't use a turn: it goes to the next one
  // (kept, the limited client would hold it - and starve everyone - for as
  // long as its limit lasts).
  const byTurn = leastRecentFirst(pending, (p) => p.clientId, turnStamps);
  const turnClient = byTurn.find((p) => !p.blocked());
  const historyOrder = turnClient
    ? [turnClient, ...byTurn.filter((p) => p !== turnClient)]
    : byTurn;
  for (const p of historyOrder) {
    const turn = p === turnClient;
    const sliceStart = Date.now();
    const open = () => withinBackfill() || (turn && Date.now() - sliceStart <= TURN_SLICE_MS);
    try {
      await p.history(open, turn);
    } catch (err) {
      const message = describeError(err);
      console.error("[cron/refresh-ads-meta] history failed", message);
      await p.fail(message);
    } finally {
      accountsFailed += p.failedAccounts.size;
    }
  }

  return NextResponse.json({
    ok: true,
    integrations_processed: integrationsProcessed,
    campaigns_upserted: campaignsUpserted,
    accounts_failed: accountsFailed,
    accounts_throttled: accountsThrottled,
    clients_skipped: clientsSkipped,
    clients_deferred: clientsDeferred,
    accounts_deferred: accountsDeferred,
    link_clicks: withClicksAll,
    stale_click_days_queued: staleDaysQueued,
    // Not printed by the scheduler (objects are filtered from its log).
    client_runs: clientRuns,
  });
}

