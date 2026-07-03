"use server";

import { revalidatePath } from "next/cache";
import { formatInTimeZone } from "date-fns-tz";

import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";

// Set (upsert) this month's total budget. Agency users only.
export async function setMonthlyBudget(formData: FormData) {
  const clientSlug = String(formData.get("client"));
  const amountPln = Number(String(formData.get("amount")).replace(",", "."));

  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok || !Number.isFinite(amountPln) || amountPln <= 0) return;

  const month = `${formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM")}-01`;
  const admin = createAdminClient();
  await admin.from("client_budgets").upsert(
    {
      client_id: access.clientId,
      month,
      platform: "total",
      budget_minor_units: Math.round(amountPln * 100),
    },
    { onConflict: "client_id,month,platform" }
  );

  revalidatePath(`/${clientSlug}`);
}

// Dismiss an alert. Agency users only.
export async function dismissAlert(formData: FormData) {
  const clientSlug = String(formData.get("client"));
  const alertId = String(formData.get("alertId"));

  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) return;

  const admin = createAdminClient();
  await admin
    .from("client_alerts")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("id", alertId)
    .eq("client_id", access.clientId);

  revalidatePath(`/${clientSlug}`);
}
