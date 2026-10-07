import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { encrypt } from "@/lib/integrations/encryption";
import type { IntegrationProvider } from "@/lib/types";

// The agency-wide "Połącz ponownie" on /clients reuses the per-client flow
// (oauth_states.client_id is required, so one broken client anchors it) and
// marks the state so the callback returns to /clients. The suffix is part of
// the stored, single-use state, so it cannot be forged or swapped in transit.
const RETURN_TO_CLIENTS = ".clients";

export type OAuthReturnTo = "settings" | "clients";

/** One-time OAuth state, optionally marked to return to the agency list. */
export function newOAuthState(returnTo: OAuthReturnTo): string {
  return `${randomUUID()}${returnTo === "clients" ? RETURN_TO_CLIENTS : ""}`;
}

export function oauthReturnTo(state: string | null): OAuthReturnTo {
  return state?.endsWith(RETURN_TO_CLIENTS) ? "clients" : "settings";
}

/** Where a callback lands after a flow, with the propagation count. */
export function oauthDoneUrl(
  origin: string,
  opts: {
    returnTo: OAuthReturnTo;
    slug: string | null;
    provider: IntegrationProvider;
    ok: boolean;
    fixed?: number;
  }
): string {
  const fixed = opts.fixed ? `&fixed=${opts.fixed}` : "";
  if (opts.returnTo === "clients") {
    return opts.ok
      ? `${origin}/clients?reconnected=${opts.provider}${fixed}#polaczenia`
      : `${origin}/clients?conn_error=${opts.provider}#polaczenia`;
  }
  const base = `${origin}/${opts.slug ?? "dre"}/settings`;
  return opts.ok
    ? `${base}?connected=${opts.provider}${fixed}`
    : `${base}?error=${opts.provider}`;
}

/**
 * Validate a returned OAuth `state`: it must exist, match the provider, belong
 * to the current user and not be expired. Consumes (deletes) it on success.
 * Returns the client_id it was minted for, or null if invalid.
 */
export async function consumeOAuthState(
  admin: SupabaseClient,
  state: string,
  provider: IntegrationProvider,
  currentUserId: string
): Promise<{ clientId: string } | null> {
  const { data } = await admin
    .from("oauth_states")
    .select("id, client_id, provider, user_id, expires_at")
    .eq("state", state)
    .maybeSingle();

  if (
    !data ||
    data.provider !== provider ||
    data.user_id !== currentUserId ||
    new Date(data.expires_at).getTime() < Date.now()
  ) {
    return null;
  }

  await admin.from("oauth_states").delete().eq("id", data.id);
  return { clientId: data.client_id as string };
}

/** Upsert an integration's encrypted credentials + account list. */
export async function upsertIntegration(
  admin: SupabaseClient,
  clientId: string,
  provider: IntegrationProvider,
  credentials: unknown,
  accountIds: unknown
): Promise<void> {
  // Reconnecting returns a fresh account list with no `selected` flags, and
  // every cron syncs only selected accounts - so a routine "token expired ->
  // reconnect" used to switch the sync off until someone re-ticked the
  // accounts by hand. Carry the per-account choices over by id.
  let merged = accountIds;
  if (Array.isArray(accountIds)) {
    const { data: existing } = await admin
      .from("integrations")
      .select("account_ids")
      .eq("client_id", clientId)
      .eq("provider", provider)
      .maybeSingle();
    const previous = Array.isArray(existing?.account_ids)
      ? (existing.account_ids as Array<Record<string, unknown>>)
      : [];
    merged = mergeAccountSelection(previous, accountIds as Array<Record<string, unknown>>);
    const before = previous.filter((a) => a.selected === true).length;
    const after = (merged as Array<Record<string, unknown>>).filter((a) => a.selected === true).length;
    if (before > 0 && after === 0) {
      console.warn(
        `[integrations] ${provider} for client ${clientId}: account selection went from ${before} to 0`
      );
    }
  }

  const { error } = await admin.from("integrations").upsert(
    {
      client_id: clientId,
      provider,
      credentials_encrypted: encrypt(JSON.stringify(credentials)),
      account_ids: merged,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_id,provider" }
  );

  if (error) {
    throw new Error(`Failed to store integration: ${error.message}`);
  }
}

/** Account ids across formats: "act_123" (Meta), "123-456-7890" (Google). */
const accountKey = (id: unknown) => String(id).replace(/^act_/, "").replace(/-/g, "");

/**
 * The new account list with the previous per-account choices carried over.
 * A previously SELECTED account the new login doesn't list (a System User
 * token without that account assigned, a reconnect with another Facebook
 * profile) used to vanish with its selection - DRE went to "0 of 46
 * selected" and every sync failed. It now stays, still selected and marked
 * `unlisted`: the sync then names the account it can't read instead of
 * silently pulling nothing, and the choice survives the next reconnect.
 */
export function mergeAccountSelection(
  previous: Array<Record<string, unknown>>,
  next: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const byId = new Map(previous.map((a) => [accountKey(a.id), a]));
  const listed = new Set(next.map((a) => accountKey(a.id)));
  const carried = next.map((a) => {
    const prev = byId.get(accountKey(a.id));
    if (!prev) return a;
    return {
      ...a,
      ...(prev.selected !== undefined ? { selected: prev.selected } : {}),
      ...(prev.video_only !== undefined ? { video_only: prev.video_only } : {}),
    };
  });
  const kept = previous
    .filter((a) => a.selected === true && !listed.has(accountKey(a.id)))
    .map((a) => ({ ...a, unlisted: true }));
  return [...carried, ...kept];
}

/** Resolve a client's slug for redirecting back into the dashboard. */
export async function getClientSlug(
  admin: SupabaseClient,
  clientId: string
): Promise<string | null> {
  const { data } = await admin
    .from("clients")
    .select("slug")
    .eq("id", clientId)
    .maybeSingle();
  return (data?.slug as string) ?? null;
}
