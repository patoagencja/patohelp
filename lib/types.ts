// Shared application-level types. Database row types are generated separately
// into `types/database.ts` via the Supabase CLI.

export type UserRole = "admin" | "member" | "client";

export type IntegrationProvider =
  | "meta_ads"
  | "google_ads"
  | "ga4"
  | "tiktok_ads";

/** Paid-ads providers (everything that lands in ads_daily). */
export type AdProvider = "meta_ads" | "google_ads" | "tiktok_ads";

export const AD_PROVIDER_LABEL: Record<AdProvider, string> = {
  meta_ads: "Meta",
  google_ads: "Google",
  tiktok_ads: "TikTok",
};

export const AD_PROVIDER_SHORT: Record<AdProvider, string> = {
  meta_ads: "META",
  google_ads: "GOOG",
  tiktok_ads: "TT",
};

export const AD_PROVIDER_HEX: Record<AdProvider, string> = {
  meta_ads: "#3b82f6",
  google_ads: "#f59e0b",
  tiktok_ads: "#fe2c55",
};

export type SyncStatus = "running" | "success" | "failed";

/** A user row joined with its client, as consumed by the dashboard shell. */
export interface AppUser {
  id: string;
  email: string;
  role: UserRole;
  clientId: string | null;
}

/** Agency users (admin/member) can access every client. */
export function isAgencyUser(role: UserRole): boolean {
  return role === "admin" || role === "member";
}
