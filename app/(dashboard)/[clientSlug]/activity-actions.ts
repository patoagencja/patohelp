"use server";

import { revalidatePath } from "next/cache";
import { addDays, format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { z } from "zod";

import {
  AGENCY_WORK_CATEGORIES,
  eventTypeForCategory,
} from "@/lib/dashboard/overview";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";

export type ActivityActionResult = { ok: true } | { ok: false; error: string };

const addSchema = z.object({
  client: z.string().min(1).max(64),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Nieprawidłowa data."),
  category: z.enum(AGENCY_WORK_CATEGORIES, {
    errorMap: () => ({ message: "Wybierz kategorię." }),
  }),
  title: z
    .string()
    .trim()
    .min(3, "Tytuł jest za krótki.")
    .max(120, "Tytuł może mieć maks. 120 znaków."),
  description: z
    .string()
    .trim()
    .max(500, "Opis może mieć maks. 500 znaków.")
    .optional()
    .transform((v) => (v ? v : null)),
  visible: z.boolean(),
});

const deleteSchema = z.object({
  client: z.string().min(1).max(64),
  id: z.string().uuid(),
});

// Log a piece of agency work for the client's "Co dla Ciebie zrobiliśmy"
// card. Agency users only; the service-role write is safe because the guard
// already checked the role and the row is pinned to the guarded client_id.
export async function addAgencyActivity(
  formData: FormData
): Promise<ActivityActionResult> {
  const parsed = addSchema.safeParse({
    client: formData.get("client"),
    date: formData.get("date"),
    category: formData.get("category"),
    title: formData.get("title") ?? "",
    description: formData.get("description") ?? undefined,
    visible: formData.get("visible") === "on",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Błędne dane." };
  }
  const input = parsed.data;

  // The log is "what we did", so no future dates; one day of slack covers a
  // browser clock that's already past midnight.
  const today = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");
  const latest = format(addDays(new Date(`${today}T12:00:00`), 1), "yyyy-MM-dd");
  const earliest = format(addDays(new Date(`${today}T12:00:00`), -730), "yyyy-MM-dd");
  if (input.date > latest || input.date < earliest) {
    return { ok: false, error: "Data musi być z ostatnich 2 lat, nie z przyszłości." };
  }

  const access = await requireAgencyClientAccess(input.client);
  if (!access.ok) return { ok: false, error: "Brak uprawnień." };

  const admin = createAdminClient();
  const base = {
    client_id: access.clientId,
    event_date: input.date,
    title: input.title,
    description: input.description,
    event_type: eventTypeForCategory(input.category),
    created_by: access.user.id,
  };

  const { error } = await admin
    .from("client_events")
    .insert({ ...base, category: input.category, visible_to_client: input.visible });

  if (error) {
    // Before migration 0029 the new columns don't exist. A visible entry can
    // still be saved the old way; a hidden one can't (it would leak to the
    // client), so that case asks for the migration instead.
    if (!input.visible) {
      return {
        ok: false,
        error: "Ukryte wpisy wymagają migracji 0029 - zapisz jako widoczny lub uruchom migrację.",
      };
    }
    const legacy = await admin.from("client_events").insert(base);
    if (legacy.error) return { ok: false, error: "Nie udało się zapisać. Spróbuj ponownie." };
  }

  revalidatePath(`/${access.clientSlug}`);
  return { ok: true };
}

// Remove a logged entry. Scoped by client_id so an id from another client
// can't be deleted through this client's page.
export async function deleteAgencyActivity(
  formData: FormData
): Promise<ActivityActionResult> {
  const parsed = deleteSchema.safeParse({
    client: formData.get("client"),
    id: formData.get("id"),
  });
  if (!parsed.success) return { ok: false, error: "Błędne dane." };

  const access = await requireAgencyClientAccess(parsed.data.client);
  if (!access.ok) return { ok: false, error: "Brak uprawnień." };

  const { error } = await createAdminClient()
    .from("client_events")
    .delete()
    .eq("id", parsed.data.id)
    .eq("client_id", access.clientId);
  if (error) return { ok: false, error: "Nie udało się usunąć. Spróbuj ponownie." };

  revalidatePath(`/${access.clientSlug}`);
  return { ok: true };
}
