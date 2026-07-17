import type { SupabaseClient } from "@supabase/supabase-js";

import { decrypt } from "@/lib/integrations/encryption";
import type { IntegrationProvider } from "@/lib/types";

// Shape of the decrypted credential blob per provider. Stored as encrypted
// JSON in integrations.credentials_encrypted.
export interface MetaCredentials {
  access_token: string;
  expires_at: string;
}
export interface GoogleAdsCredentials {
  refresh_token: string;
}
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
