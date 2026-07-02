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
