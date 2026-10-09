import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { isCronAuthorized } from "@/lib/integrations/cron-auth";
import { leastRecentFirst } from "@/lib/integrations/cron-runs";
import { decrypt } from "@/lib/integrations/encryption";
import { describeError } from "@/lib/integrations/errors";
import {
  getAgeBrackets,
  getGenders,
  getRegions,
  parseGa4Credentials,
  type DateRange,
} from "@/lib/integrations/ga4";
import { getDemographics } from "@/lib/integrations/meta-ads";
import { createAdminClient } from "@/lib/supabase/admin";

// Vercel Cron: pull age/gender/geo demographics (GA4) and age/gender (Meta) for
// the last 30 days and store them as a snapshot dated today. Each provider's
// fresh snapshot replaces that provider's previous one for the client, so the
// report always shows the latest COMPLETE numbers.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const WARSAW_TZ = "Europe/Warsaw";

// No client starts after this much wall time, and no Meta account call
// after ACCOUNT_BUDGET_MS - the GitHub scheduler gives up at 90 s. A client
// cut short keeps its last complete snapshot, and the clients with the
// oldest snapshot go first, so the ones left out lead the next run. Without
// a budget DRE's 46 accounts, asked one by one, could run the function into
// maxDuration before anything was written.
const CLIENT_BUDGET_MS = 50_000;
const ACCOUNT_BUDGET_MS = 70_000;

interface MetaAccount {
  id: string;
  selected?: boolean;
}

interface IntegrationRow {
  client_id: string;
  credentials_encrypted: string | null;
  account_ids: unknown;
}

type Admin = ReturnType<typeof createAdminClient>;
type Row = Record<string, unknown>;

/** A provider's snapshot for one client: complete rows, or why there are none. */
type Fetched =
  | { kind: "rows"; rows: Row[] }
  | { kind: "failed"; error: string }
  | { kind: "deferred" };

/**
 * client|provider -> epoch ms of its newest stored snapshot, in one query
 * over the newest rows (a pair missing from them is older than every row
 * read). null = unreadable.
 */
async function newestSnapshots(admin: Admin, clientIds: string[]): Promise<Map<string, number> | null> {
  const out = new Map<string, number>();
  if (clientIds.length < 2) return out;
  const { data, error } = await admin
    .from("demographics")
    .select("client_id, provider, created_at")
    .in("client_id", clientIds)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) return null;
  for (const r of data ?? []) {
    const key = `${r.client_id}|${r.provider}`;
    const t = Date.parse(String(r.created_at));
    if (!out.has(key) && Number.isFinite(t)) out.set(key, t);
  }
  return out;
}

/**
 * Insert one provider's fresh rows for a client, then drop that provider's
 * older rows. Insert-then-delete: the old delete-then-insert left the
 * client with NO demographics when the insert failed or the run died in
 * between, and two overlapping runs (no unique key on this table) both
 * inserted after both deleted - doubled values. One insert = one
 * created_at, so the last run to insert wins. Scoped by provider: a Meta
 * failure used to wipe Meta's last good rows along with GA4's old ones.
 */
async function replaceSnapshot(
  admin: Admin,
  clientId: string,
  provider: string,
  rows: Row[]
): Promise<string | null> {
  const { data: inserted, error } = await admin
    .from("demographics")
    .insert(rows)
    .select("created_at");
  if (error) return error.message;
  const cutoff = inserted?.[0]?.created_at as string | undefined;
  if (cutoff) {
    const { error: delError } = await admin
      .from("demographics")
      .delete()
      .eq("client_id", clientId)
      .eq("provider", provider)
      .lt("created_at", cutoff);
    if (delError) {
      // The fresh rows are in; the old ones go with the next run.
      console.error("[cron/refresh-demographics] cleanup failed", delError.message);
    }
  }
  return null;
}

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const admin = createAdminClient();
  const now = new Date();
  const until = formatInTimeZone(now, WARSAW_TZ, "yyyy-MM-dd");
  const since = formatInTimeZone(subDays(now, 29), WARSAW_TZ, "yyyy-MM-dd");
  const range: DateRange = { startDate: since, endDate: until };

  const onlyClient = new URL(request.url).searchParams.get("client");
  const scoped = (provider: string) => {
    let q = admin
      .from("integrations")
      .select("client_id, credentials_encrypted, account_ids")
      .eq("provider", provider);
    if (onlyClient) q = q.eq("client_id", onlyClient);
    return q;
  };
  const [ga4Res, metaRes] = await Promise.all([scoped("ga4"), scoped("meta_ads")]);

  // client -> its GA4 property and selected Meta accounts (what it can have).
  const byClient = new Map<
    string,
    { ga4?: { row: IntegrationRow; propertyId: string }; meta?: { row: IntegrationRow; accounts: MetaAccount[] } }
  >();
  const entry = (clientId: string) => {
    const e = byClient.get(clientId) ?? {};
    byClient.set(clientId, e);
    return e;
  };
  for (const row of (ga4Res.data ?? []) as IntegrationRow[]) {
    const propertyId = (row.account_ids as { propertyId?: string } | null)?.propertyId;
    if (propertyId) entry(row.client_id).ga4 = { row, propertyId };
  }
  for (const row of (metaRes.data ?? []) as IntegrationRow[]) {
    const accounts = ((row.account_ids ?? []) as MetaAccount[]).filter((a) => a.selected === true);
    if (accounts.length) entry(row.client_id).meta = { row, accounts };
  }

  // Oldest snapshot first, judged by the client's OLDEST provider: with the
  // newest one, a client whose GA4 refreshes every run but whose Meta part
  // keeps running out of time would always go last and never catch up.
  const clientIds = [...byClient.keys()];
  const snapshots = await newestSnapshots(admin, clientIds);
  const oldestOfClient = snapshots
    ? new Map(
        clientIds.map((id) => {
          const e = byClient.get(id)!;
          const times = [
            ...(e.ga4 ? [snapshots.get(`${id}|ga4`) ?? 0] : []),
            ...(e.meta ? [snapshots.get(`${id}|meta_ads`) ?? 0] : []),
          ];
          return [id, Math.min(...times)] as const;
        })
      )
    : null;
  const ordered = leastRecentFirst(clientIds, (id) => id, oldestOfClient);

  // --- GA4: age / gender / region ---
  const fetchGa4 = async (clientId: string, row: IntegrationRow, propertyId: string): Promise<Fetched> => {
    try {
      // Refresh-token or service-account credentials (see ga4.ts).
      const ga4Auth = parseGa4Credentials(decrypt(row.credentials_encrypted as string));
      const [age, gender, geo] = await Promise.all([
        getAgeBrackets(ga4Auth, propertyId, range),
        getGenders(ga4Auth, propertyId, range),
        getRegions(ga4Auth, propertyId, range),
      ]);
      const rows: Row[] = [];
      const add = (kind: string, list: Array<{ bucket: string; value: number }>) => {
        for (const r of list) {
          rows.push({
            client_id: clientId,
            provider: "ga4",
            kind,
            bucket: r.bucket,
            value: r.value,
            snapshot_date: until,
          });
        }
      };
      add("age", age);
      add("gender", gender);
      add("geo", geo);
      return { kind: "rows", rows };
    } catch (err) {
      return { kind: "failed", error: describeError(err) };
    }
  };

  // --- Meta: age / gender (aggregated across selected accounts) ---
  const fetchMeta = async (clientId: string, row: IntegrationRow, accounts: MetaAccount[]): Promise<Fetched> => {
    try {
      const { access_token } = JSON.parse(decrypt(row.credentials_encrypted as string));
      const age = new Map<string, number>();
      const gender = new Map<string, number>();
      for (const account of accounts) {
        // Sums missing some accounts would be stored as the client's whole
        // audience: keep the last complete snapshot instead.
        if (elapsed() > ACCOUNT_BUDGET_MS) return { kind: "deferred" };
        try {
          const demo = await getDemographics(access_token, account.id, since, until);
          for (const a of demo.age)
            if (a.bucket) age.set(a.bucket, (age.get(a.bucket) ?? 0) + a.value);
          for (const g of demo.gender)
            if (g.bucket) gender.set(g.bucket, (gender.get(g.bucket) ?? 0) + g.value);
        } catch (accErr) {
          // Same for a failed account (it used to be skipped and the partial
          // totals stored as complete). The remaining accounts aren't asked:
          // nothing of this run would be written anyway.
          return { kind: "failed", error: `${account.id}: ${describeError(accErr)}` };
        }
      }
      const rows: Row[] = [];
      for (const [bucket, value] of age)
        rows.push({ client_id: clientId, provider: "meta_ads", kind: "age", bucket, value, snapshot_date: until });
      for (const [bucket, value] of gender)
        rows.push({ client_id: clientId, provider: "meta_ads", kind: "gender", bucket, value, snapshot_date: until });
      return { kind: "rows", rows };
    } catch (err) {
      return { kind: "failed", error: describeError(err) };
    }
  };

  let processed = 0;
  let clientsFailed = 0;
  let clientsDeferred = 0;
  let providersWritten = 0;
  const errors: string[] = [];

  // Written client by client: everything used to wait until every client
  // was fetched, so a run that died late stored nothing at all.
  for (const clientId of ordered) {
    if (elapsed() > CLIENT_BUDGET_MS) {
      clientsDeferred += 1;
      continue;
    }
    const e = byClient.get(clientId)!;
    const jobs: Array<{ provider: string; fetch: () => Promise<Fetched> }> = [];
    if (e.ga4) {
      const { row, propertyId } = e.ga4;
      jobs.push({ provider: "ga4", fetch: () => fetchGa4(clientId, row, propertyId) });
    }
    if (e.meta) {
      const { row, accounts } = e.meta;
      jobs.push({ provider: "meta_ads", fetch: () => fetchMeta(clientId, row, accounts) });
    }

    let failed = false;
    let wrote = false;
    for (const job of jobs) {
      const result = await job.fetch();
      if (result.kind === "deferred") {
        console.warn(`[cron/refresh-demographics] ${job.provider} left for the next run (time budget)`);
        continue;
      }
      if (result.kind === "failed") {
        failed = true;
        errors.push(`${clientId} ${job.provider}: ${result.error}`);
        console.error(`[cron/refresh-demographics] ${job.provider} failed, keeping the last snapshot`, result.error);
        continue;
      }
      // Nothing delivered in 30 days: keep the last snapshot rather than
      // replace it with nothing.
      if (!result.rows.length) continue;
      const writeError = await replaceSnapshot(admin, clientId, job.provider, result.rows);
      if (writeError) {
        failed = true;
        errors.push(`${clientId} ${job.provider}: ${writeError}`);
        console.error("[cron/refresh-demographics] insert failed", writeError);
        continue;
      }
      wrote = true;
      providersWritten += 1;
    }
    if (wrote) processed += 1;
    if (failed) clientsFailed += 1;
  }

  return NextResponse.json({
    ok: true,
    clients_processed: processed,
    clients_failed: clientsFailed,
    clients_deferred: clientsDeferred,
    providers_written: providersWritten,
    errors,
  });
}
