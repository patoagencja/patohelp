"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { inspectMetaToken, listAdAccounts } from "@/lib/integrations/meta-ads";
import { upsertIntegration } from "@/lib/integrations/oauth-flow";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Store a Meta Business Manager System User token instead of the OAuth user
 * token. User tokens die after ~60 days and the sync silently stops; a system
 * user token issued with "never" expiry keeps Meta connected for good.
 * Previously selected ad accounts are kept (upsertIntegration merges them).
 */
export async function saveMetaSystemToken(formData: FormData) {
  const clientSlug = String(formData.get("client"));
  const token = String(formData.get("token") ?? "").trim();
  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) return;
  if (!token) redirect(`/${clientSlug}/settings?error=meta_token_empty`);

  let expiresAt: Date | null = null;
  let accounts: Awaited<ReturnType<typeof listAdAccounts>> = [];
  try {
    const info = await inspectMetaToken(token);
    if (!info.valid) throw new Error("invalid");
    expiresAt = info.expiresAt;
    accounts = await listAdAccounts(token);
  } catch (err) {
    console.error("[meta/system-token] rejected", (err as Error).message);
    redirect(`/${clientSlug}/settings?error=meta_token_invalid`);
  }

  await upsertIntegration(
    createAdminClient(),
    access.clientId,
    "meta_ads",
    {
      access_token: token,
      expires_at: expiresAt ? expiresAt.toISOString() : null,
      kind: "system_user",
    },
    accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }))
  );

  revalidatePath(`/${clientSlug}`, "layout");
  redirect(
    `/${clientSlug}/settings?saved=${expiresAt ? "meta_token_expiring" : "meta_token"}`
  );
}
