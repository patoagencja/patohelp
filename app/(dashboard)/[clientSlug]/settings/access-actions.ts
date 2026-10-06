"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { escapeLikePattern, isAgencyEmail } from "@/lib/agency/domains";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";

const CLIENT_SLUG = z.string().min(1).max(64);

const inviteSchema = z.object({
  client: CLIENT_SLUG,
  email: z.string().trim().toLowerCase().max(254).email(),
  sendEmail: z.boolean(),
});

const removeUserSchema = z.object({
  client: CLIENT_SLUG,
  userId: z.string().uuid(),
});

const cancelInvitationSchema = z.object({
  client: CLIENT_SLUG,
  invitationId: z.string().uuid(),
});

interface UserRow {
  id: string;
  email: string;
  role: string;
  client_id: string | null;
}

interface InvitationRow {
  id: string;
  email: string;
  role: string;
  client_id: string;
}

function back(clientSlug: string, query: string): never {
  redirect(`/${clientSlug}/settings?${query}#dostep`);
}

/** Base URL for the invite e-mail's redirect. Supabase also checks it against
 *  its allowed redirect list, so a spoofed Origin can't send people elsewhere. */
function appOrigin(): string | undefined {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  const candidate = configured || headers().get("origin") || "";
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Grant a person CLIENT access to this client's panel (agency only). The role
 * is hard-coded to 'client': agency roles see every tenant, so they must never
 * be grantable from a per-client form. Refuses rather than moves anyone who
 * already belongs to another client or to the agency - silently re-homing an
 * account between tenants would leak one client's numbers to another's staff.
 */
export async function inviteClientUser(formData: FormData) {
  const clientSlug = String(formData.get("client") ?? "");
  const parsed = inviteSchema.safeParse({
    client: clientSlug,
    email: formData.get("email") ?? "",
    sendEmail: formData.get("send_email") === "on",
  });

  const access = await requireAgencyClientAccess(
    parsed.success ? parsed.data.client : clientSlug
  );
  if (!access.ok) return;
  if (!parsed.success) back(access.clientSlug, "error=access_email");

  const { email, sendEmail } = parsed.data;
  if (isAgencyEmail(email)) back(access.clientSlug, "error=access_agency");

  const admin = createAdminClient();
  const pattern = escapeLikePattern(email);

  // Case-insensitive lookups: hand-written SQL rows may not be lowercased, and
  // the signup trigger matches on lower(email). The JS filter keeps it exact.
  const [usersRes, invitesRes] = await Promise.all([
    admin.from("users").select("id, email, role, client_id").ilike("email", pattern),
    admin
      .from("client_invitations")
      .select("id, email, role, client_id")
      .ilike("email", pattern),
  ]);
  if (usersRes.error || invitesRes.error) back(access.clientSlug, "error=access_failed");

  const users = ((usersRes.data ?? []) as UserRow[]).filter(
    (u) => u.email.toLowerCase() === email
  );
  const invites = ((invitesRes.data ?? []) as InvitationRow[]).filter(
    (i) => i.email.toLowerCase() === email
  );

  // All checks before any write, so a refusal leaves nothing half-done.
  if (users.some((u) => u.role !== "client")) back(access.clientSlug, "error=access_agency");
  if (users.some((u) => u.client_id !== null && u.client_id !== access.clientId)) {
    back(access.clientSlug, "error=access_other_client");
  }
  if (invites.some((i) => i.client_id !== access.clientId)) {
    back(access.clientSlug, "error=access_other_client");
  }
  // A hand-made agency-role invitation for this client: leave it to whoever
  // created it instead of quietly downgrading it here.
  if (invites.some((i) => i.role !== "client")) back(access.clientSlug, "error=access_agency");

  if (invites.length === 0) {
    // Plain insert, not upsert on email: if another client's invitation landed
    // in the meantime, the unique constraint refuses instead of overwriting it.
    const { error } = await admin
      .from("client_invitations")
      .insert({ email, client_id: access.clientId, role: "client" });
    if (error) {
      back(
        access.clientSlug,
        error.code === "23505" ? "error=access_other_client" : "error=access_failed"
      );
    }
  }

  const unassigned = users.filter((u) => u.client_id === null).map((u) => u.id);
  if (unassigned.length > 0) {
    // Re-assert role + null client in the WHERE so a concurrent change (e.g.
    // promotion to agency, assignment elsewhere) can't be overwritten.
    const { error } = await admin
      .from("users")
      .update({ client_id: access.clientId })
      .in("id", unassigned)
      .eq("role", "client")
      .is("client_id", null);
    if (error) back(access.clientSlug, "error=access_failed");
  }

  revalidatePath(`/${access.clientSlug}/settings`);

  if (users.length > 0) back(access.clientSlug, "saved=access_existing");
  if (!sendEmail) back(access.clientSlug, "saved=access");

  // Only for addresses with no account yet: Supabase rejects invites to
  // existing users, and those people can just use the normal login link.
  const redirectTo = appOrigin();
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    email,
    redirectTo ? { redirectTo: `${redirectTo}/auth/callback` } : undefined
  );
  // The invitation row is already saved, so a mail failure (rate limit, SMTP)
  // only changes the hint - the person can still log in via /login.
  back(access.clientSlug, inviteError ? "saved=access_mail_failed" : "saved=access_invited");
}

/**
 * Take a client user's access to THIS client away. The account stays (it
 * resolves to an empty panel under RLS); the invitation goes too, otherwise
 * the login-time mapping would hand access straight back.
 */
export async function removeClientUserAccess(formData: FormData) {
  const parsed = removeUserSchema.safeParse({
    client: formData.get("client"),
    userId: formData.get("user_id"),
  });
  if (!parsed.success) return;

  const access = await requireAgencyClientAccess(parsed.data.client);
  if (!access.ok) return;

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("users")
    .select("id, email, role, client_id")
    .eq("id", parsed.data.userId)
    .eq("client_id", access.clientId)
    .maybeSingle();

  const row = target as UserRow | null;
  if (!row) back(access.clientSlug, "error=access_failed");
  if (row.role !== "client") back(access.clientSlug, "error=access_agency");

  const { error } = await admin
    .from("users")
    .update({ client_id: null })
    .eq("id", row.id)
    .eq("client_id", access.clientId)
    .eq("role", "client");
  if (error) back(access.clientSlug, "error=access_failed");

  await admin
    .from("client_invitations")
    .delete()
    .eq("client_id", access.clientId)
    .eq("role", "client")
    .ilike("email", escapeLikePattern(row.email.toLowerCase()));

  revalidatePath(`/${access.clientSlug}/settings`);
  back(access.clientSlug, "saved=access_removed");
}

/** Cancel a pending (not yet used) client invitation for this client. */
export async function cancelClientInvitation(formData: FormData) {
  const parsed = cancelInvitationSchema.safeParse({
    client: formData.get("client"),
    invitationId: formData.get("invitation_id"),
  });
  if (!parsed.success) return;

  const access = await requireAgencyClientAccess(parsed.data.client);
  if (!access.ok) return;

  const { error } = await createAdminClient()
    .from("client_invitations")
    .delete()
    .eq("id", parsed.data.invitationId)
    .eq("client_id", access.clientId)
    .eq("role", "client");
  if (error) back(access.clientSlug, "error=access_failed");

  revalidatePath(`/${access.clientSlug}/settings`);
  back(access.clientSlug, "saved=access_removed");
}
