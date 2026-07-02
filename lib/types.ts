// Shared application-level types. Database row types are generated separately
// into `types/database.ts` via the Supabase CLI.

export type UserRole = "admin" | "member" | "client";

export type IntegrationProvider = "meta_ads" | "google_ads" | "ga4";

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
