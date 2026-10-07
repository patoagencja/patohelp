"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  loadIntegration,
  type MetaCredentials,
} from "@/lib/integrations/credentials";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import {
  getMetaIdentity,
  inspectMetaToken,
  listAdAccounts,
} from "@/lib/integrations/meta-ads";
import { upsertIntegration } from "@/lib/integrations/oauth-flow";
import {
  propagateCredentials,
  readStoredTokens,
} from "@/lib/integrations/propagate";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Store a Meta Business Manager System User token instead of the OAuth user
 * token. User tokens die after ~60 days - or at once when the agency person
 * changes their Facebook password - and the sync silently stops; a system
 * user token issued with "never" expiry keeps Meta connected for good.
 * Previously selected ad accounts are kept (upsertIntegration merges them).
 *
 * With "apply_all" ticked, the same token is also put on every other client
 * whose selected ad accounts it can read (verified per account first).
 * Without it, it still repairs clients broken by the same dead token.
 */
export async function saveMetaSystemToken(formData: FormData) {
  const clientSlug = String(formData.get("client"));
  const token = String(formData.get("token") ?? "").trim();
  const applyAll = formData.get("apply_all") === "on";
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

  const admin = createAdminClient();
  const previousTokens = await readStoredTokens(admin, access.clientId, ["meta_ads"]);
  const identity = await getMetaIdentity(token).catch(() => null);
  const credentials: MetaCredentials = {
    access_token: token,
    expires_at: expiresAt ? expiresAt.toISOString() : null,
    kind: "system_user",
    ...(identity ? { identity } : {}),
  };

  await upsertIntegration(
    admin,
    access.clientId,
    "meta_ads",
    credentials,
    accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }))
  );

  const propagation = await propagateCredentials(admin, {
    providers: ["meta_ads"],
    credentials: credentials as unknown as Record<string, unknown>,
    token,
    identity: identity?.id ?? null,
    previousTokens,
    skip: [{ clientId: access.clientId, provider: "meta_ads" }],
    mode: applyAll ? "all" : "repair",
  }).catch(() => ({ fixed: [], noAccess: 0 }));

  revalidatePath(`/${clientSlug}`, "layout");
  const fixed = propagation.fixed.length ? `&fixed=${propagation.fixed.length}` : "";
  redirect(
    `/${clientSlug}/settings?saved=${expiresAt ? "meta_token_expiring" : "meta_token"}${fixed}`
  );
}

/**
 * Put this client's already-saved System User token on every other client
 * whose selected ad accounts it can read. One Business Manager system user
 * usually covers all the agency's ad accounts, so one token fixes them all.
 */
export async function shareMetaSystemToken(formData: FormData) {
  const clientSlug = String(formData.get("client"));
  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) return;

  const admin = createAdminClient();
  let credentials: MetaCredentials | null = null;
  try {
    credentials =
      (await loadIntegration<MetaCredentials>(admin, access.clientId, "meta_ads"))
        ?.credentials ?? null;
  } catch {
    credentials = null;
  }
  if (!credentials?.access_token || credentials.kind !== "system_user") {
    redirect(`/${clientSlug}/settings?error=meta_token_invalid`);
  }

  const propagation = await propagateCredentials(admin, {
    providers: ["meta_ads"],
    credentials: credentials as unknown as Record<string, unknown>,
    token: credentials.access_token,
    identity: credentials.identity?.id ?? null,
    previousTokens: [],
    skip: [{ clientId: access.clientId, provider: "meta_ads" }],
    mode: "all",
  }).catch(() => ({ fixed: [], noAccess: 0 }));

  revalidatePath("/clients");
  const fixed = propagation.fixed.length ? `&fixed=${propagation.fixed.length}` : "";
  redirect(`/${clientSlug}/settings?saved=meta_token_shared${fixed}#polaczenia`);
}
