import type { SupabaseClient } from "@supabase/supabase-js";

import { decrypt, encrypt } from "@/lib/integrations/encryption";
import { isTokenError } from "@/lib/integrations/errors";
import {
  isServiceAccountCredentials,
  listAccessibleProperties,
} from "@/lib/integrations/ga4";
import { listAccessibleCustomerIds } from "@/lib/integrations/google-ads";
import { canAccessAdAccount } from "@/lib/integrations/meta-ads";

// "Napraw wszystkie naraz". The agency authorises every client with the same
// personal Facebook / Google login, so when that login's tokens die (password
// change, Facebook security reset, Google Testing-mode expiry) every client
// breaks at once and used to be reconnected one by one, per provider. After a
// fresh token is saved for one client, this tries it on every OTHER client of
// the same provider family that is broken or shares the dead login, verifies
// cheaply that it reaches that client's own accounts, and only then swaps the
// stored credentials. Nothing else (accounts, selections, property) changes.

export type PropagatableProvider = "meta_ads" | "google_ads" | "ga4";

export interface PropagationInput {
  /** Providers the new credentials can serve (google_ads + ga4 may share). */
  providers: PropagatableProvider[];
  /** Encrypted-as-is credential blob to store (same shape for both Google providers). */
  credentials: Record<string, unknown>;
  /** The token inside `credentials` (Meta access_token / Google refresh_token). */
  token: string;
  /** Login the token belongs to: Meta /me id or Google account email. */
  identity: string | null;
  /** Tokens the source client held before this reconnect: anyone else still
   *  holding one of them holds the same dead login. */
  previousTokens: string[];
  /** (client, provider) rows the caller already saved itself. */
  skip: Array<{ clientId: string; provider: PropagatableProvider }>;
  /**
   * "repair": only integrations that are broken (latest sync failed with a
   * token error / unreadable credentials), hold a previous dead token, or
   * belong to the same login. "all": every integration the token can reach -
   * for a Meta System User token, which is worth putting everywhere.
   */
  mode: "repair" | "all";
  /** Stop starting new checks after this many ms (callbacks have a budget). */
  budgetMs?: number;
}

export interface PropagationResult {
  fixed: Array<{ clientId: string; provider: PropagatableProvider }>;
  /** Candidates whose accounts the new login cannot reach - left untouched. */
  noAccess: number;
}

interface IntegrationRow {
  client_id: string;
  provider: PropagatableProvider;
  credentials_encrypted: string | null;
  account_ids: unknown;
  updated_at: string | null;
}

type StoredCreds = Record<string, unknown> | null;

function tokenOf(provider: PropagatableProvider, creds: StoredCreds): string | null {
  if (!creds) return null;
  const v = provider === "meta_ads" ? creds.access_token : creds.refresh_token;
  return typeof v === "string" && v ? v : null;
}

function identityOf(provider: PropagatableProvider, creds: StoredCreds): string | null {
  if (!creds) return null;
  if (provider === "meta_ads") {
    const id = (creds.identity as { id?: unknown } | null | undefined)?.id;
    return typeof id === "string" ? id : null;
  }
  const email = creds.account_email;
  return typeof email === "string" ? email.toLowerCase() : null;
}

function readCreds(row: { credentials_encrypted: string | null }): StoredCreds | "unreadable" {
  if (!row.credentials_encrypted) return null;
  try {
    return JSON.parse(decrypt(row.credentials_encrypted)) as Record<string, unknown>;
  } catch {
    return "unreadable";
  }
}

/** Ad-account ids the client actually syncs (all listed ones if none ticked). */
function selectedAccountIds(accountIds: unknown): string[] {
  if (!Array.isArray(accountIds)) return [];
  const list = accountIds as Array<{ id?: unknown; selected?: unknown }>;
  const selected = list.filter((a) => a?.selected === true);
  return (selected.length ? selected : list)
    .map((a) => (a?.id != null ? String(a.id) : ""))
    .filter(Boolean);
}

/**
 * Tokens (and login identities) a client currently stores for the given
 * providers. Read BEFORE overwriting the client's own row, so the caller can
 * pass them as `previousTokens`. Never throws.
 */
export async function readStoredTokens(
  admin: SupabaseClient,
  clientId: string,
  providers: PropagatableProvider[]
): Promise<string[]> {
  try {
    const { data } = await admin
      .from("integrations")
      .select("provider, credentials_encrypted")
      .eq("client_id", clientId)
      .in("provider", providers);
    const out: string[] = [];
    for (const row of data ?? []) {
      const creds = readCreds(row as { credentials_encrypted: string | null });
      if (creds === "unreadable") continue;
      const t = tokenOf(row.provider as PropagatableProvider, creds);
      if (t) out.push(t);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Apply fresh credentials to every other eligible integration. Never throws:
 * the caller's own reconnect already succeeded and must not fail because a
 * neighbour could not be repaired.
 */
export async function propagateCredentials(
  admin: SupabaseClient,
  input: PropagationInput
): Promise<PropagationResult> {
  const result: PropagationResult = { fixed: [], noAccess: 0 };
  if (!input.token || !input.providers.length) return result;
  const deadline = Date.now() + (input.budgetMs ?? 40_000);

  let rows: IntegrationRow[] = [];
  try {
    const { data, error } = await admin
      .from("integrations")
      .select("client_id, provider, credentials_encrypted, account_ids, updated_at")
      .in("provider", input.providers);
    if (error) throw new Error(error.message);
    rows = (data ?? []) as IntegrationRow[];
  } catch (err) {
    console.error("[propagate] failed to list integrations", (err as Error).message);
    return result;
  }

  const skip = new Set(input.skip.map((s) => `${s.clientId}:${s.provider}`));
  const previous = new Set(input.previousTokens.filter(Boolean));
  const identity = input.identity?.toLowerCase() ?? null;

  // One listing per provider for the new token, shared by every candidate.
  let adsIds: Promise<Set<string>> | null = null;
  let ga4Ids: Promise<Set<string>> | null = null;
  const metaAccess = new Map<string, Promise<boolean>>();

  const canReach = async (row: IntegrationRow): Promise<boolean> => {
    if (row.provider === "meta_ads") {
      const ids = selectedAccountIds(row.account_ids);
      if (!ids.length) return false;
      const checks = ids.map((id) => {
        let p = metaAccess.get(id);
        if (!p) {
          p = canAccessAdAccount(input.token, id);
          metaAccess.set(id, p);
        }
        return p;
      });
      return (await Promise.all(checks)).every(Boolean);
    }
    if (row.provider === "google_ads") {
      const ids = selectedAccountIds(row.account_ids).map((id) => id.replace(/-/g, ""));
      if (!ids.length) return false;
      adsIds ??= listAccessibleCustomerIds(input.token)
        .then((list) => new Set(list))
        .catch(() => new Set<string>());
      const reachable = await adsIds;
      return ids.every((id) => reachable.has(id));
    }
    const propertyId = (row.account_ids as { propertyId?: string | null } | null)?.propertyId;
    if (!propertyId) return false;
    ga4Ids ??= listAccessibleProperties(input.token)
      .then((list) => new Set(list.map((p) => p.propertyId)))
      .catch(() => new Set<string>());
    return (await ga4Ids).has(String(propertyId));
  };

  const latestRun = async (row: IntegrationRow) => {
    const { data } = await admin
      .from("sync_runs")
      .select("status, error_message, started_at")
      .eq("client_id", row.client_id)
      .eq("provider", row.provider)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data as {
      status?: string;
      error_message?: string | null;
      started_at?: string | null;
    } | null;
  };

  const consider = async (row: IntegrationRow): Promise<void> => {
    if (skip.has(`${row.client_id}:${row.provider}`)) return;
    if (Date.now() > deadline) return;

    const creds = readCreds(row);
    // A GA4 service account never expires and is not tied to the login.
    if (creds !== "unreadable" && row.provider === "ga4" && isServiceAccountCredentials(creds)) {
      return;
    }
    const stored = creds === "unreadable" ? null : creds;
    const currentToken = tokenOf(row.provider, stored);
    if (currentToken && currentToken === input.token) return;

    const run = await latestRun(row).catch(() => null);
    // A failure from before the last (re)connect is about a token that is no
    // longer stored - someone already fixed this one, maybe on purpose with a
    // different login, so it does not count as broken.
    const runIsStale =
      !!run?.started_at &&
      !!row.updated_at &&
      new Date(row.updated_at).getTime() > new Date(run.started_at).getTime();
    const broken =
      creds === "unreadable" ||
      !currentToken ||
      (run?.status === "failed" && !runIsStale && isTokenError(run.error_message ?? null));

    // A working permanent Meta token is better than anything we could bring.
    if (row.provider === "meta_ads" && stored?.kind === "system_user" && !broken) return;

    const eligible =
      input.mode === "all" ||
      broken ||
      (!!currentToken && previous.has(currentToken)) ||
      (!!identity && identityOf(row.provider, stored) === identity);
    if (!eligible) return;

    let reachable = false;
    try {
      reachable = await canReach(row);
    } catch {
      reachable = false;
    }
    if (!reachable) {
      result.noAccess += 1;
      return;
    }

    const { error } = await admin
      .from("integrations")
      .update({
        credentials_encrypted: encrypt(JSON.stringify(input.credentials)),
        // The health check treats "saved after the last failed run" as
        // reconnected, so the banner turns to "dociągniemy dane" at once.
        updated_at: new Date().toISOString(),
      })
      .eq("client_id", row.client_id)
      .eq("provider", row.provider);
    if (error) {
      console.error("[propagate] update failed", row.client_id, row.provider, error.message);
      return;
    }
    result.fixed.push({ clientId: row.client_id, provider: row.provider });
  };

  // Small pool: Meta checks are one Graph call per ad account, and dozens of
  // clients in parallel would trip rate limits.
  const queue = [...rows];
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const row = queue.shift()!;
      try {
        await consider(row);
      } catch (err) {
        console.error("[propagate] candidate failed", row.client_id, row.provider, (err as Error).message);
      }
    }
  });
  await Promise.all(workers);
  return result;
}
