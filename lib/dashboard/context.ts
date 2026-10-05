import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { isAgencyUser, type UserRole } from "@/lib/types";

// Per-request lookups every dashboard screen needs. The layout and the page
// render in the same request on a full load and both used to ask Supabase the
// same questions one after another (user -> role -> client -> client_type),
// which was the bulk of the time before anything appeared. React `cache`
// dedupes them within a request, and each helper runs its queries in parallel.

export interface Viewer {
  userId: string | null;
  email: string | null;
  isAgency: boolean;
}

export const getViewer = cache(async (): Promise<Viewer> => {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { userId: null, email: null, isAgency: false };
  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  return {
    userId: user.id,
    email: user.email ?? null,
    isAgency: profile ? isAgencyUser(profile.role as UserRole) : false,
  };
});

export interface DashboardClient {
  id: string;
  name: string;
  clientType: "engagement" | "ecommerce";
}

/** The client behind a slug, as the current user is allowed to see it (RLS). */
export const getClientBySlug = cache(
  async (slug: string): Promise<DashboardClient | null> => {
    const supabase = createClient();
    const { data } = await supabase
      .from("clients")
      .select("id, name, client_type")
      .eq("slug", slug)
      .maybeSingle();
    if (data) {
      const row = data as { id: string; name: string; client_type?: string };
      return {
        id: row.id,
        name: row.name,
        clientType: row.client_type === "ecommerce" ? "ecommerce" : "engagement",
      };
    }
    // Pre-0016 databases have no client_type column and the select above
    // errors out - fall back rather than bouncing the user to /login.
    const { data: basic } = await supabase
      .from("clients")
      .select("id, name")
      .eq("slug", slug)
      .maybeSingle();
    return basic
      ? { id: basic.id as string, name: basic.name as string, clientType: "engagement" }
      : null;
  }
);

/** Newest successful sync for the client - drives "Zaktualizowano X temu". */
export async function getLastSyncAt(clientId: string): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("sync_runs")
    .select("finished_at")
    .eq("client_id", clientId)
    .eq("status", "success")
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.finished_at as string | undefined) ?? null;
}
