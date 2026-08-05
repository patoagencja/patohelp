"use server";

import { revalidatePath } from "next/cache";

import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";

// Server action: register a recurring Slides report template (agency only).
export async function addReportTemplate(formData: FormData): Promise<void> {
  const clientSlug = String(formData.get("client_slug") ?? "");
  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) throw new Error("Brak dostępu");

  const name = String(formData.get("name") ?? "").trim();
  // Optional: empty means "use the bundled OLX v3 PPTX template" (no Google).
  const templateId = String(formData.get("template_presentation_id") ?? "").trim();
  if (!name) throw new Error("Nazwa jest wymagana");

  const split = (v: FormDataEntryValue | null) =>
    String(v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const admin = createAdminClient();
  const { error } = await admin.from("report_templates").insert({
    client_id: access.clientId,
    name,
    template_presentation_id: templateId || null,
    campaign_filter: {
      all_of: split(formData.get("all_of")),
      any_of: split(formData.get("any_of")),
    },
    drive_folder_id: String(formData.get("drive_folder_id") ?? "").trim() || null,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/${clientSlug}/raport`);
}
