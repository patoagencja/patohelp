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
  const { error } = await admin.from("integrations").upsert(
    {
      client_id: clientId,
      provider,
      credentials_encrypted: encrypt(JSON.stringify(credentials)),
      account_ids: accountIds,
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
