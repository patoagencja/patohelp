import type { SupabaseClient } from "@supabase/supabase-js";

import { encrypt } from "@/lib/integrations/encryption";
import type { IntegrationProvider } from "@/lib/types";

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
    const byId = new Map(previous.map((a) => [String(a.id), a]));
    merged = (accountIds as Array<Record<string, unknown>>).map((a) => {
      const prev = byId.get(String(a.id));
      if (!prev) return a;
      return {
        ...a,
        ...(prev.selected !== undefined ? { selected: prev.selected } : {}),
        ...(prev.video_only !== undefined ? { video_only: prev.video_only } : {}),
      };
    });
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
