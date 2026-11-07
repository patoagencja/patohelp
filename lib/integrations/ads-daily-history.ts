import type { SupabaseClient } from "@supabase/supabase-js";

import { readPresentAdDates } from "@/lib/integrations/cron-runs";
import { bootstrapProgress, type ProgressView } from "@/lib/integrations/history-progress";
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
/** Pages (1000 rows each) read for lately filled old days at bootstrap. */
const SUSPECT_PAGES = 20;

/**
 * The first per-account history record for a client (bootstrapProgress in
 * history-progress.ts explains the trade-off): stored days count as fetched
 * by every selected account, except the last RECHECK_DAYS days and older days
 * whose rows were first written in that time (filled by the backfill under
 * the old "any row = present" rule). One account alone can't have left
 * another one's day out, so a single-account client skips that scan. null
 * when the stored days can't be read: nothing is assumed (a failed read is
 * not "no rows"), the next run tries again.
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
  }
): Promise<ProgressView | null> {
  const present = await readPresentAdDates(admin, opts.clientId, opts.provider, opts.windowStart);
  if (!present.ok) return null;
  const recheckFrom = addDaysIso(opts.today, -RECHECK_DAYS);
  let suspect = new Set<string>();
  if (opts.accounts.length > 1 && opts.windowStart < recheckFrom) {
    const found = await datesWrittenSince(
      admin,
      opts.clientId,
      opts.provider,
      new Date((opts.now ?? Date.now()) - RECHECK_DAYS * 86_400_000).toISOString(),
      opts.windowStart,
      recheckFrom,
      SUSPECT_PAGES
    );
    if (!found) return null;
    suspect = found;
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
 * Days in [fromDate, beforeDate) holding a `provider` row first written at
 * or after `writtenSince` (an ISO timestamp; an upsert keeps created_at):
 * old days filled by the history backfill lately rather than synced as they
 * happened. Walks back from the newest such day a page at a time, at most
 * `maxPages` pages (older days beyond that are not looked at). null when the
 * first page can't be read.
 */
export async function datesWrittenSince(
  admin: SupabaseClient,
  clientId: string,
  provider: string,
  writtenSince: string,
  fromDate: string,
  beforeDate: string,
  maxPages: number
): Promise<Set<string> | null> {
  const out = new Set<string>();
  let upper = beforeDate;
  for (let page = 0; page < maxPages; page += 1) {
    const { data, error } = await admin
      .from("ads_daily")
      .select("date")
      .eq("client_id", clientId)
      .eq("provider", provider)
      .gte("created_at", writtenSince)
      .gte("date", fromDate)
      .lt("date", upper)
      .order("date", { ascending: false })
      .limit(1000);
    if (error) return page === 0 ? null : out;
    if (!data || data.length === 0) break;
    for (const r of data) out.add(String(r.date).slice(0, 10));
    // Continue strictly before the oldest day of this page: each page
    // yields at least one new day, however many rows a day has.
    upper = String(data[data.length - 1].date).slice(0, 10);
    if (data.length < 1000) break;
  }
  return out;
}

/**
 * Rows of `days` still lacking raw_data `key` after those days were pulled
 * again from every account - campaigns the platform no longer reports for
 * the day. `patch` returns the keys to merge into their raw_data (null =
 * leave the row). Without this they would keep their day "due" for ever.
 * Upsert of the key columns + raw_data only touches raw_data. `campaignIds`
 * narrows the read to those campaigns (rows patched before every account
 * re-pulled the day - other accounts' rows would fill the page otherwise).
 */
export async function patchRowsMissingRawKey(
  admin: SupabaseClient,
  clientId: string,
  provider: string,
  key: string,
  days: string[],
  patch: (row: { campaign_id: string; date: string; raw: Record<string, unknown> }) => Record<string, unknown> | null,
  campaignIds?: readonly string[]
): Promise<number> {
  if (!days.length || (campaignIds && !campaignIds.length)) return 0;
  let query = admin
    .from("ads_daily")
    .select("campaign_id, date, raw_data")
    .eq("client_id", clientId)
    .eq("provider", provider)
    .in("date", days)
    .is(`raw_data->>${key}`, null);
  if (campaignIds) query = query.in("campaign_id", [...campaignIds]);
  // PostgREST caps a page at 1000; any rest is patched on a later run.
  const { data, error } = await query.limit(1000);
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
