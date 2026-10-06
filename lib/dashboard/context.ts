import { cache } from "react";

import { toBranding, type ClientBranding } from "@/lib/dashboard/branding";
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

export interface DashboardClient extends ClientBranding {
  id: string;
  name: string;
  clientType: "engagement" | "ecommerce";
}

/** The client behind a slug, as the current user is allowed to see it (RLS). */
export const getClientBySlug = cache(
  async (slug: string): Promise<DashboardClient | null> => {
    const supabase = createClient();
    // Newest schema first, then step back: pre-0031 databases have no
    // branding columns and pre-0016 ones no client_type, and either makes the
    // whole select error out - fall back rather than bouncing the user to
    // /login. A plain "not found" (no error) stops the cascade early.
    for (const columns of [
      "id, name, client_type, logo_url, brand_color",
      "id, name, client_type",
      "id, name",
    ]) {
      const { data, error } = await supabase
        .from("clients")
        .select(columns)
        .eq("slug", slug)
        .maybeSingle();
      if (error) continue;
      if (!data) return null;
      const row = data as unknown as {
        id: string;
        name: string;
        client_type?: string;
        logo_url?: string | null;
        brand_color?: string | null;
      };
      return {
        id: row.id,
        name: row.name,
        clientType: row.client_type === "ecommerce" ? "ecommerce" : "engagement",
        ...toBranding(row),
      };
    }
    return null;
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
