import type { SupabaseClient } from "@supabase/supabase-js";

import { readPresentAdDates } from "@/lib/integrations/cron-runs";
import {
  bootstrapProgress,
  findSuspectDays,
  type ProgressView,
} from "@/lib/integrations/history-progress";
import { addDaysIso } from "@/lib/season/config";

/**
 * History bookkeeping shared by the campaign-level crons (refresh-ads-meta,
 * refresh-ads-google): which stored days must be pulled again, and how to
 * batch them.
 */

/**
 * When per-account history progress is first recorded for a client, every
 * account re-fetches the days it delivered on in the last this-many days,
 * and older days whose rows were first written in that time. That reaches
 * back past the account deferral (since 2026-10-09 a deferred account could
 * miss a day the others had) and takes in the days the outage gap fill wrote
 * (since 2026-11-06, account by account under the budget): the two ways one
 * account lately filled a day the others never fetched. Also the part of
 * history people look at most. A one-time cost: for DRE, 46 accounts x their
 * delivered days in it, spread over the history turns of a few days.
 */
export const RECHECK_DAYS = 45;
/**
 * Count requests the bootstrap may spend finding lately filled old days. A
 * block of them costs a few; past the cap the days not settled yet are taken
 * as lately filled (re-checked per account), never assumed done.
 */
const SUSPECT_REQUESTS = 80;

/**
 * The first per-account history record for a client (bootstrapProgress in
 * history-progress.ts explains the trade-off): stored days count as fetched
 * by every selected account, except the last RECHECK_DAYS days and older days
 * whose rows were first written in that time (filled by the backfill under
 * the old "any row = present" rule; findSuspectDays). One account alone
 * can't have left another one's day out, so a single-account client skips
 * that search. null when the stored days can't be read: nothing is assumed
 * (a failed read is not "no rows"), the next run tries again.
 */
export async function startHistoryProgress(
  admin: SupabaseClient,
  opts: {
    clientId: string;
    provider: string;
    /** First day of the history window. */
    windowStart: string;
    /** Warsaw today. */
    today: string;
    accounts: readonly string[];
    known?: Readonly<Record<string, readonly string[] | undefined>>;
    now?: number;
    /**
     * Epoch ms after which no further count query starts: the search then
     * answers null (nothing assumed) and the next run tries again - a slow
     * database must not run a 60 s function out of time.
     */
    deadline?: number;
  }
): Promise<ProgressView | null> {
  const present = await readPresentAdDates(admin, opts.clientId, opts.provider, opts.windowStart);
  if (!present.ok) return null;
  const recheckFrom = addDaysIso(opts.today, -RECHECK_DAYS);
  let suspect = new Set<string>();
  const older = [...present.dates].filter((d) => d < recheckFrom);
  if (opts.accounts.length > 1 && older.length) {
    const writtenSince = new Date((opts.now ?? Date.now()) - RECHECK_DAYS * 86_400_000).toISOString();
    const found = await findSuspectDays({
      days: older,
      rowsOnDay: present.rows,
      countWrittenSince: (from, to) =>
        opts.deadline !== undefined && Date.now() > opts.deadline
          ? Promise.resolve(null)
          : countRowsWrittenSince(admin, opts.clientId, opts.provider, writtenSince, from, to),
      maxRequests: SUSPECT_REQUESTS,
    });
    if (!found) return null;
    if (found.capped) {
      console.warn(
        `[ads-daily-history] ${opts.provider} bootstrap for ${opts.clientId}: lately filled days not fully narrowed down in ${found.requests} counts, ${found.suspect.size} old days re-checked per account`
      );
    }
    suspect = found.suspect;
  }
  return bootstrapProgress({
    start: opts.today,
    accounts: opts.accounts,
    present: present.dates,
    recheckFrom,
    suspect,
    known: opts.known,
  });
}

/** Inclusive list of yyyy-MM-dd between two dates. */
export function eachDay(since: string, until: string): string[] {
  const days: string[] = [];
  const start = new Date(`${since}T00:00:00Z`);
  const end = new Date(`${until}T00:00:00Z`);
  for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

const dayNo = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

/**
 * Days -> date ranges, newest first. Days at most `mergeGap` apart share a
 * range: one GAQL query for a range (re-writing the present days in between)
 * is cheaper than two.
 */
export function toRanges(days: Iterable<string>, mergeGap: number): Array<{ since: string; until: string }> {
  const sorted = [...new Set(days)].sort().reverse();
  const out: Array<{ since: string; until: string }> = [];
  for (const d of sorted) {
    const last = out[out.length - 1];
    if (last && dayNo(last.since) - dayNo(d) <= mergeGap + 1) last.since = d;
    else out.push({ since: d, until: d });
  }
  return out;
}

/**
 * The newest days (at most `limit`) in [fromDate, beforeDate) holding a
 * `provider` row whose raw_data lacks `key` - rows written before that key
 * existed (purchase values, purchase-only Google values). They are pulled
 * again like missing days. Walks back a page at a time from the newest such
 * row, so it reads a few pages, not the whole history.
 */
export async function datesMissingRawKey(
  admin: SupabaseClient,
  clientId: string,
  provider: string,
  key: string,
  fromDate: string,
  beforeDate: string,
  limit: number
): Promise<Set<string> | null> {
  const out = new Set<string>();
  let upper = beforeDate;
  for (let guard = 0; guard < 400 && out.size < limit; guard += 1) {
    const { data, error } = await admin
      .from("ads_daily")
      .select("date")
      .eq("client_id", clientId)
      .eq("provider", provider)
      .is(`raw_data->>${key}`, null)
      .gte("date", fromDate)
      .lt("date", upper)
      .order("date", { ascending: false })
      .limit(1000);
    if (error) return guard === 0 ? null : out;
    if (!data || data.length === 0) break;
    for (const r of data) out.add(r.date as string);
    // Every date of this page is in the set now; continue strictly before
    // the oldest one so each page yields at least one new day.
    upper = data[data.length - 1].date as string;
    if (data.length < 1000) break;
  }
  return out;
}

/**
 * How many `provider` rows dated [fromDate, toDate] were first written at or
 * after `writtenSince` (an ISO timestamp; an upsert keeps created_at): rows
 * the history backfill filled lately rather than synced as they happened.
 * A count, not the rows: DRE writes hundreds of rows a day, so paging them
 * reached only weeks back. null when it can't be read.
 */
async function countRowsWrittenSince(
  admin: SupabaseClient,
  clientId: string,
  provider: string,
  writtenSince: string,
  fromDate: string,
  toDate: string
): Promise<number | null> {
  try {
    const { count, error } = await admin
      .from("ads_daily")
      .select("date", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("provider", provider)
      .gte("created_at", writtenSince)
      .gte("date", fromDate)
      .lte("date", toDate);
    if (error || count == null) return null;
    return count;
  } catch {
    return null;
  }
}

/**
 * Rows of `days` still lacking raw_data `key` after those days were pulled
 * again from every account - campaigns the platform no longer reports for
 * the day. `patch` returns the keys to merge into their raw_data (null =
 * leave the row). Without this they would keep their day "due" for ever.
 * Upsert of the key columns + raw_data only touches raw_data.
 */
export async function patchRowsMissingRawKey(
  admin: SupabaseClient,
  clientId: string,
  provider: string,
  key: string,
  days: string[],
  patch: (row: { campaign_id: string; date: string; raw: Record<string, unknown> }) => Record<string, unknown> | null
): Promise<number> {
  if (!days.length) return 0;
  const { data, error } = await admin
    .from("ads_daily")
    .select("campaign_id, date, raw_data")
    .eq("client_id", clientId)
    .eq("provider", provider)
    .in("date", days)
    .is(`raw_data->>${key}`, null)
    // PostgREST caps a page at 1000; any rest is patched on a later run.
    .limit(1000);
  if (error || !data?.length) return 0;
  const rows: Array<Record<string, unknown>> = [];
  for (const r of data) {
    const raw = (r.raw_data && typeof r.raw_data === "object" ? r.raw_data : {}) as Record<string, unknown>;
    const extra = patch({ campaign_id: String(r.campaign_id), date: String(r.date), raw });
    if (!extra) continue;
    rows.push({
      client_id: clientId,
      provider,
      campaign_id: r.campaign_id,
      date: r.date,
      raw_data: { ...raw, ...extra },
    });
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error: upErr } = await admin
      .from("ads_daily")
      .upsert(rows.slice(i, i + 500), { onConflict: "client_id,provider,campaign_id,date" });
    if (upErr) {
      console.warn(`[ads-daily-history] patching ${provider} ${key} failed`, upErr.message);
      return i;
    }
  }
  return rows.length;
}

/** Campaign ids per read of patchRowsByKey (one row each on one day). */
const KEY_CHUNK = 100;

/**
 * Merges `byCampaign` (campaign id -> raw_data keys) into the rows of those
 * campaigns on `date` that still lack raw_data `key`. Read by exact key - one
 * day, the given campaigns, at most KEY_CHUNK rows a read - so other rows of
 * the day (accounts that haven't re-pulled it yet) can't crowd them out of a
 * page. Upsert of the key columns + raw_data only touches raw_data. False
 * when a read or write failed: the caller must not count the day as done.
 */
export async function patchRowsByKey(
  admin: SupabaseClient,
  clientId: string,
  provider: string,
  key: string,
  date: string,
  byCampaign: ReadonlyMap<string, Record<string, unknown>>
): Promise<boolean> {
  const ids = [...byCampaign.keys()];
  try {
    for (let i = 0; i < ids.length; i += KEY_CHUNK) {
      const { data, error } = await admin
        .from("ads_daily")
        .select("campaign_id, raw_data")
        .eq("client_id", clientId)
        .eq("provider", provider)
        .eq("date", date)
        .in("campaign_id", ids.slice(i, i + KEY_CHUNK))
        .is(`raw_data->>${key}`, null);
      if (error) return false;
      const rows = (data ?? []).map((r) => {
        const raw = (r.raw_data && typeof r.raw_data === "object" ? r.raw_data : {}) as Record<string, unknown>;
        return {
          client_id: clientId,
          provider,
          campaign_id: r.campaign_id,
          date,
          raw_data: { ...raw, ...(byCampaign.get(String(r.campaign_id)) ?? {}) },
        };
      });
      if (!rows.length) continue;
      const { error: upErr } = await admin
        .from("ads_daily")
        .upsert(rows, { onConflict: "client_id,provider,campaign_id,date" });
      if (upErr) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** One message per account, so "every account failed" counts accounts. */
export class AccountErrors {
  private readonly byAccount = new Map<string, string[]>();
  add(accountId: string, message: string): void {
    const list = this.byAccount.get(accountId) ?? [];
    list.push(message);
    this.byAccount.set(accountId, list);
  }
  has(accountId: string): boolean {
    return this.byAccount.has(accountId);
  }
  get size(): number {
    return this.byAccount.size;
  }
  list(): string[] {
    return [...this.byAccount.entries()].map(([id, msgs]) =>
      msgs.length > 1 ? `${id}: ${msgs[0]} (+${msgs.length - 1} more)` : `${id}: ${msgs[0]}`
    );
  }
}
