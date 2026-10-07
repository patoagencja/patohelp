import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * History bookkeeping shared by the campaign-level crons (refresh-ads-meta,
 * refresh-ads-google): which stored days must be pulled again, and how to
 * batch them.
 */

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
