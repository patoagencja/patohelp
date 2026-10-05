"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";

const MONTH = /^\d{4}-\d{2}-01$/;

/** "12 345,50" / "12345.5" / "" -> number | null */
function parseAmount(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").replace(/\s/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Save margin / VAT handling and the monthly revenue goals (agency only).
// An emptied goal field deletes that month's goal.
export async function saveEcomSettings(formData: FormData) {
  const clientSlug = String(formData.get("client"));
  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) return;

  const admin = createAdminClient();

  const margin = parseAmount(formData.get("gross_margin_pct"));
  await admin.from("ecom_settings").upsert(
    {
      client_id: access.clientId,
      gross_margin_pct: margin !== null && margin > 0 && margin <= 100 ? margin : null,
      revenue_includes_vat: formData.get("revenue_includes_vat") === "on",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_id" }
  );

  for (const month of formData.getAll("goal_month").map(String)) {
    if (!MONTH.test(month)) continue;
    const goal = parseAmount(formData.get(`goal_${month}`));
    if (goal !== null && goal > 0) {
      await admin.from("revenue_goals").upsert(
        {
          client_id: access.clientId,
          month,
          goal_minor_units: Math.round(goal * 100),
        },
        { onConflict: "client_id,month" }
      );
    } else {
      await admin
        .from("revenue_goals")
        .delete()
        .eq("client_id", access.clientId)
        .eq("month", month);
    }
  }

  revalidatePath(`/${clientSlug}`, "layout");
  redirect(`/${clientSlug}/settings?saved=ecommerce#ecommerce`);
}
