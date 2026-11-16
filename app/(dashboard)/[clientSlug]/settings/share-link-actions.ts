"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { isShareViewerEmail, SHARE_EMAIL_DOMAIN } from "@/lib/auth/login-policy";
import {
  hashSharePassword,
  newSharePassword,
  newShareSecret,
  sha256Hex,
  shareTokenOf,
} from "@/lib/auth/share-link";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";

export type CreateShareLinkState =
  | { status: "idle" }
  | { status: "created"; link: string; password: string }
  | { status: "error"; message: string };

const CLIENT_SLUG = z.string().min(1).max(64);

function appOrigin(): string | undefined {
  const candidate = process.env.NEXT_PUBLIC_APP_URL || headers().get("origin") || "";
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A new "link z hasłem" for this client (agency only). The password is shown
 * once, right here - only its hash is kept.
 */
export async function createShareLink(
  _prev: CreateShareLinkState,
  formData: FormData
): Promise<CreateShareLinkState> {
  const slug = CLIENT_SLUG.safeParse(formData.get("client"));
  if (!slug.success) return { status: "error", message: "Nie rozpoznano klienta." };
  const access = await requireAgencyClientAccess(slug.data);
  if (!access.ok) return { status: "error", message: "Brak uprawnień." };

  const origin = appOrigin();
  if (!origin) return { status: "error", message: "Ustaw NEXT_PUBLIC_APP_URL w Vercel - bez niego link nie ma adresu." };

  const secret = newShareSecret();
  const password = newSharePassword();
  const admin = createAdminClient();
  const email = `${access.clientSlug}-${randomBytes(4).toString("hex")}@${SHARE_EMAIL_DOMAIN}`.toLowerCase();

  const created = await admin.auth.admin.createUser({
    email,
    // Nobody can click a link sent to this domain; the account is only ever
    // opened through the password page, which proves the right to it.
    email_confirm: true,
    app_metadata: {
      share: {
        client_id: access.clientId,
        secret_sha256: sha256Hex(secret),
        password_hash: hashSharePassword(password),
        created_at: new Date().toISOString(),
      },
    },
  });
  const userId = created.data?.user?.id;
  if (created.error || !userId) {
    console.error("[share-link] create failed", created.error?.message);
    return { status: "error", message: "Nie udało się utworzyć linku. Spróbuj ponownie." };
  }

  // The signup trigger made the profile with no access; the seat is ours to
  // give (only the service role can). Guarded on role so nothing else moves.
  const { data: seated, error: seatError } = await admin
    .from("users")
    .update({ client_id: access.clientId, role: "client" })
    .eq("id", userId)
    .eq("role", "client")
    .select("id");
  if (seatError || !seated?.length) {
    console.error("[share-link] seat failed", seatError?.message);
    await admin.auth.admin.deleteUser(userId);
    return { status: "error", message: "Nie udało się utworzyć linku. Spróbuj ponownie." };
  }

  revalidatePath(`/${access.clientSlug}/settings`);
  return { status: "created", link: `${origin}/k/${shareTokenOf(userId, secret)}`, password };
}

/** Switch a link off: its account goes, and with it every open session. */
export async function revokeShareLink(formData: FormData) {
  const clientSlug = String(formData.get("client") ?? "");
  const userId = z.string().uuid().safeParse(formData.get("user_id"));
  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) return;
  if (!userId.success) redirect(`/${access.clientSlug}/settings?error=share_failed#dostep`);

  const admin = createAdminClient();
  // Only a link account of THIS client - never a person's account.
  const { data: row } = await admin
    .from("users")
    .select("id, email, client_id")
    .eq("id", userId.data)
    .eq("client_id", access.clientId)
    .maybeSingle();
  if (!row || !isShareViewerEmail(row.email as string)) {
    redirect(`/${access.clientSlug}/settings?error=share_failed#dostep`);
  }
  const { error } = await admin.auth.admin.deleteUser(userId.data);
  if (error) {
    console.error("[share-link] revoke failed", error.message);
    redirect(`/${access.clientSlug}/settings?error=share_failed#dostep`);
  }
  redirect(`/${access.clientSlug}/settings?saved=share_revoked#dostep`);
}
