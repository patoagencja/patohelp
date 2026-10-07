"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { describeError } from "@/lib/integrations/errors";
import {
  getServiceAccountEmail,
  listAccessibleProperties,
  verifyPropertyAccess,
  type Ga4Property,
  type Ga4ServiceAccountCredentials,
} from "@/lib/integrations/ga4";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { upsertIntegration } from "@/lib/integrations/oauth-flow";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Switch a client's GA4 to the agency service account (never expires, not tied
 * to anyone's Google login). Saves only after a one-row report proves the
 * service account was added as a Viewer on that property.
 */
export async function saveGa4ServiceAccount(formData: FormData) {
  const clientSlug = String(formData.get("client"));
  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) return;

  // Accept "312345678" or "properties/312345678" (both appear in GA4's UI).
  const propertyId = String(formData.get("propertyId") ?? "")
    .trim()
    .replace(/^properties\//, "");
  const back = `/${clientSlug}/settings/ga4-service-account`;
  if (!/^\d{4,}$/.test(propertyId)) redirect(`${back}?error=ga4_sa_property`);

  const email = getServiceAccountEmail();
  if (!email) redirect(`${back}?error=ga4_sa_missing`);

  const credentials: Ga4ServiceAccountCredentials = {
    mode: "service_account",
    client_email: email,
  };

  try {
    await verifyPropertyAccess(credentials, propertyId);
  } catch (err) {
    console.error("[ga4/service-account] access check failed", describeError(err));
    redirect(`${back}?error=ga4_sa_denied`);
  }

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("integrations")
    .select("account_ids")
    .eq("client_id", access.clientId)
    .eq("provider", "ga4")
    .maybeSingle();
  const previous = (
    (existing?.account_ids as { properties?: Ga4Property[] } | null)?.properties ?? []
  ).filter((p) => p?.propertyId);

  // A readable name for the settings card; best-effort (the Admin API may be
  // disabled in the service account's project - the Data API check passed).
  let named: Ga4Property | undefined = previous.find((p) => p.propertyId === propertyId);
  if (!named) {
    named = await listAccessibleProperties(credentials)
      .then((list) => list.find((p) => p.propertyId === propertyId))
      .catch(() => undefined);
  }
  const properties: Ga4Property[] = [
    ...previous.filter((p) => p.propertyId !== propertyId),
    named ?? { propertyId, displayName: `Usługa ${propertyId}`, accountName: "konto usługi" },
  ];

  await upsertIntegration(admin, access.clientId, "ga4", credentials, {
    propertyId,
    properties,
  });

  revalidatePath(`/${clientSlug}`, "layout");
  redirect(`/${clientSlug}/settings?saved=ga4_service_account`);
}
