import type { SupabaseClient } from "@supabase/supabase-js";

import { decrypt } from "@/lib/integrations/encryption";
import type { GoogleOAuthCredentials } from "@/lib/integrations/google-identity";
import type { IntegrationProvider } from "@/lib/types";

// Shape of the decrypted credential blob per provider. Stored as encrypted
// JSON in integrations.credentials_encrypted.
export interface MetaCredentials {
  access_token: string;
  /** null for Business Manager system user tokens, which never expire. */
  expires_at: string | null;
  kind?: "system_user";
  /** /me of the token (person or system user); absent on older rows. Lets a
   *  reconnect find every client authorised with the same login. */
  identity?: { id: string; name: string | null } | null;
}
export type GoogleAdsCredentials = GoogleOAuthCredentials;
export interface TikTokCredentials {
  access_token: string;
}

export interface LoadedIntegration<T> {
  credentials: T;
  accountIds: unknown;
}

/**
 * Load and decrypt an integration's credentials. Requires a service-role
 * client (integration rows are only readable by the service role for writes /
 * by agency users for select). Returns null when the integration is missing.
 */
export async function loadIntegration<T>(
  admin: SupabaseClient,
  clientId: string,
  provider: IntegrationProvider
): Promise<LoadedIntegration<T> | null> {
  const { data } = await admin
    .from("integrations")
    .select("credentials_encrypted, account_ids")
    .eq("client_id", clientId)
    .eq("provider", provider)
    .maybeSingle();

  if (!data?.credentials_encrypted) {
    return null;
  }

  return {
    credentials: JSON.parse(decrypt(data.credentials_encrypted)) as T,
    accountIds: data.account_ids,
  };
}
