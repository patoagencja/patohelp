import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { isAgencyUser, type UserRole } from "@/lib/types";

export type GuardSuccess = {
  ok: true;
  user: User;
  role: UserRole;
  clientId: string;
  clientSlug: string;
};

export type GuardFailure = {
  ok: false;
  status: 401 | 403 | 404;
};

/**
 * Agency-only guard without a specific client: logged-in admin/member. Used
 * where one action touches many clients at once (credential propagation).
 */
export async function requireAgencyUser(): Promise<
  { ok: true; user: User; role: UserRole } | GuardFailure
> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401 };

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || !isAgencyUser(profile.role as UserRole)) {
    return { ok: false, status: 403 };
  }
  return { ok: true, user, role: profile.role as UserRole };
}

/**
 * Guard for numbers a client keeps together with the agency (hand-entered
 * ad costs on "Wynik dzień po dniu" - the shop filled them into its own
 * sheet until now): a logged-in agency user, or a client user whose own
 * client is `clientSlug`. RLS on clients already hides other clients from
 * a client user; the client_id match makes it explicit, so a write never
 * rests on a policy alone.
 */
export async function requireClientEditor(
  clientSlug: string
): Promise<(GuardSuccess & { clientType: "ecommerce" | "engagement" }) | GuardFailure> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401 };

  const [{ data: profile }, { data: client }] = await Promise.all([
    supabase.from("users").select("role, client_id").eq("id", user.id).maybeSingle(),
    supabase.from("clients").select("id, slug, client_type").eq("slug", clientSlug).maybeSingle(),
  ]);
  if (!profile) return { ok: false, status: 403 };
  if (!client) return { ok: false, status: 404 };
  const role = profile.role as UserRole;
  if (!isAgencyUser(role) && !(role === "client" && profile.client_id === client.id)) {
    return { ok: false, status: 403 };
  }
  return {
    ok: true,
    user,
    role,
    clientId: client.id as string,
    clientSlug: client.slug as string,
    clientType: client.client_type === "ecommerce" ? "ecommerce" : "engagement",
  };
}

/**
 * Session guard for integration routes and the settings page. Confirms the
 * caller is a logged-in agency user (admin/member) with access to the given
 * client. Uses the cookie-bound server client, so RLS still applies.
 */
export async function requireAgencyClientAccess(
  clientSlug: string
): Promise<GuardSuccess | GuardFailure> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, status: 401 };
  }

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !isAgencyUser(profile.role as UserRole)) {
    return { ok: false, status: 403 };
  }

  const { data: client } = await supabase
    .from("clients")
    .select("id, slug")
    .eq("slug", clientSlug)
    .single();

  if (!client) {
    return { ok: false, status: 404 };
  }

  return {
    ok: true,
    user,
    role: profile.role as UserRole,
    clientId: client.id as string,
    clientSlug: client.slug as string,
  };
}
