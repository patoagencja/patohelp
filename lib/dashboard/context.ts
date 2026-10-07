import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { toBranding, type ClientBranding } from "@/lib/dashboard/branding";
import { createAdminClient } from "@/lib/supabase/admin";
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

/** `sub` of a Supabase access token, unverified (see getViewer). */
function tokenSubject(token: string | undefined): string | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")
    ) as { sub?: unknown };
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export const getViewer = cache(async (): Promise<Viewer> => {
  const supabase = createClient();
  // The role lookup used to wait for getUser() (a round trip to the auth
  // server) only to learn the user id - two sequential trips in front of
  // the whole shell. The id is already in the session cookie's token, so
  // both run side by side. Nothing is trusted from the cookie alone:
  // getUser() still verifies the session, PostgREST verifies the token on
  // the users read, and the profile only counts if both name the same user.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const cookieUserId = tokenSubject(session?.access_token);
  const readRole = (id: string) =>
    supabase.from("users").select("role").eq("id", id).maybeSingle();
  const [userRes, earlyProfile] = await Promise.all([
    supabase.auth.getUser(),
    cookieUserId ? readRole(cookieUserId) : Promise.resolve(null),
  ]);
  const user = userRes.data.user;
  if (!user) return { userId: null, email: null, isAgency: false };
  const profile =
    earlyProfile && cookieUserId === user.id
      ? earlyProfile.data
      : (await readRole(user.id)).data;
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
    // The sync stamp (live indicator, data-cache keys) is needed right after
    // the client on every screen; start it now by slug so it lands with the
    // client instead of one round trip later. It is only used once RLS has
    // resolved this slug to the same client id (see getLastSyncAt).
    const stampPromise = lastSyncBySlug(slug);
    const client = await readClientBySlug(slug);
    if (client) {
      stampMemo().set(
        client.id,
        stampPromise.then((r) =>
          r && r.clientId === client.id ? r.finishedAt : r === null ? null : readLastSyncAt(client.id)
        )
      );
    }
    return client;
  }
);

async function readClientBySlug(slug: string): Promise<DashboardClient | null> {
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

/**
 * The live indicator's poll (a server action, every minute per open tab):
 * the RLS client lookup and the stamp-by-slug read side by side, one round
 * trip instead of two. null when the slug isn't visible to the viewer.
 */
export async function getSyncStampForSlug(slug: string): Promise<string | null> {
  const [client, bySlug] = await Promise.all([readClientBySlug(slug), lastSyncBySlug(slug)]);
  if (!client) return null;
  if (bySlug && bySlug.clientId === client.id) return bySlug.finishedAt;
  if (bySlug === null) return null;
  return readLastSyncAt(client.id);
}

// Per-request: client id -> sync stamp promise, primed by getClientBySlug.
const stampMemo = cache(() => new Map<string, Promise<string | null>>());

/**
 * Newest successful sync for the client behind `slug`, with that client's
 * id (service role, one round trip via the clients join). `null` = the slug
 * exists but nothing synced yet, or no such slug; `undefined` = the read
 * failed (the caller then asks by id).
 */
async function lastSyncBySlug(
  slug: string
): Promise<{ clientId: string; finishedAt: string } | null | undefined> {
  try {
    const { data, error } = await (createAdminClient() as unknown as SupabaseClient)
      .from("sync_runs")
      .select("client_id, finished_at, clients!inner(slug)")
      .eq("clients.slug", slug)
      .eq("status", "success")
      .not("finished_at", "is", null)
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return undefined;
    if (!data) return null;
    return {
      clientId: String(data.client_id),
      finishedAt: String(data.finished_at),
    };
  } catch {
    return undefined;
  }
}

/**
 * Newest successful sync for the client - drives "Zaktualizowano X temu" and
 * the auto-refresh poll. sync_runs is agency-only under RLS (error messages
 * are operational), so through the cookie client a client user always got
 * null: a permanent "Na żywo" over stale data and no auto-refresh. Only the
 * timestamp leaves this function, read with the service role - callers MUST
 * pass an id resolved through RLS (getClientBySlug).
 */
// React `cache`: the layout (live stamp), the page (data-cache key, see
// lib/dashboard/sync-cache.ts) and the alerts scan all ask in one request;
// after getClientBySlug the answer is usually already on its way.
export const getLastSyncAt = cache(async (clientId: string): Promise<string | null> => {
  const primed = stampMemo().get(clientId);
  if (primed) return primed;
  return readLastSyncAt(clientId);
});

async function readLastSyncAt(clientId: string): Promise<string | null> {
  const { data } = await createAdminClient()
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
