"use server";

import { randomBytes } from "crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";

const EXPIRY_DAYS = { "7": 7, "30": 30, none: null } as const;

const createSchema = z.object({
  client: z.string().min(1).max(64),
  expiry: z.enum(["7", "30", "none"]),
});

const revokeSchema = z.object({
  client: z.string().min(1).max(64),
  token: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/),
});

// Create a read-only overview link for the board (agency only). 24 random
// bytes = 192 bits, base64url so it survives URLs, chats and e-mail clients
// untouched - the token is the only thing standing between the internet and
// the client's numbers, so it must be unguessable, not just unique.
export async function createOverviewShareLink(formData: FormData) {
  const parsed = createSchema.safeParse({
    client: formData.get("client"),
    expiry: formData.get("expiry"),
  });
  if (!parsed.success) return;

  const access = await requireAgencyClientAccess(parsed.data.client);
  if (!access.ok) return;

  const days = EXPIRY_DAYS[parsed.data.expiry];
  const expiresAt =
    days === null ? null : new Date(Date.now() + days * 86_400_000).toISOString();

  await createAdminClient()
    .from("share_links")
    .insert({
      token: randomBytes(24).toString("base64url"),
      client_id: access.clientId,
      kind: "overview",
      expires_at: expiresAt,
      created_by: access.user.id,
    });

  revalidatePath(`/${access.clientSlug}/settings`);
}

// Revoke one overview link. Scoped by client_id + kind so a forged token from
// another client's (or a report) link can't be revoked from this page.
export async function revokeOverviewShareLink(formData: FormData) {
  const parsed = revokeSchema.safeParse({
    client: formData.get("client"),
    token: formData.get("token"),
  });
  if (!parsed.success) return;

  const access = await requireAgencyClientAccess(parsed.data.client);
  if (!access.ok) return;

  await createAdminClient()
    .from("share_links")
    .update({ revoked: true, revoked_at: new Date().toISOString() })
    .eq("token", parsed.data.token)
    .eq("client_id", access.clientId)
    .eq("kind", "overview");

  revalidatePath(`/${access.clientSlug}/settings`);
}
