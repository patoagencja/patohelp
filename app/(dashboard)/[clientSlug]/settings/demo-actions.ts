"use server";

import { formatInTimeZone } from "date-fns-tz";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";

import { addDaysIso, profileKpis } from "@/lib/demo/profile/anonymize";
import { collectDemoProfile } from "@/lib/demo/profile/collect";
import { clearDemoProfile, DEMO_PROFILE_TAG, saveDemoProfile } from "@/lib/demo/profile/store";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";

const Input = z.object({ clientSlug: z.string().min(1).max(64) });

export type DemoActionResult = { ok: true; message: string } | { ok: false; error: string };

/** Agency admins only: the demo is public, so a member can't put a client's numbers there. */
async function adminAccess(raw: unknown) {
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Nieprawidłowe dane." };
  const access = await requireAgencyClientAccess(parsed.data.clientSlug);
  if (!access.ok) return { ok: false as const, error: "Brak dostępu do tego klienta." };
  if (access.role !== "admin") return { ok: false as const, error: "Dane demo może zmienić tylko administrator agencji." };
  return { ok: true as const, access };
}

/**
 * "Użyj liczb tego klienta w demo": snapshot the client's last weeks into the
 * public demo's anonymized profile (numbers only, random factors - see
 * lib/demo/profile/anonymize.ts). Replaces any earlier snapshot. Errors are
 * never echoed or logged with details: they could name the client's rows.
 */
export async function snapshotDemoProfile(input: { clientSlug: string }): Promise<DemoActionResult> {
  const a = await adminAccess(input);
  if (!a.ok) return { ok: false, error: a.error };
  const { access } = a;
  const admin = createAdminClient();

  const { data: client } = await admin.from("clients").select("client_type").eq("id", access.clientId).maybeSingle();
  if ((client as { client_type?: string } | null)?.client_type !== "ecommerce") {
    return { ok: false, error: "Demo pokazuje sklep - wybierz klienta e-commerce." };
  }

  const today = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");
  let profile;
  try {
    profile = await collectDemoProfile(admin, access.clientId, addDaysIso(today, -1));
  } catch {
    return { ok: false, error: "Za mało danych tego klienta z ostatnich tygodni, żeby zbudować demo." };
  }
  const kpis = profileKpis(profile);
  if (kpis.aov === null || kpis.cpc === null || kpis.roas === null) {
    return { ok: false, error: "Brak sprzedaży lub kliknięć z ostatnich 30 dni - demo zostaje bez zmian." };
  }
  if (await saveDemoProfile(admin, access.clientId, profile)) {
    return { ok: false, error: "Nie udało się zapisać zrzutu. Spróbuj ponownie za chwilę." };
  }
  revalidateTag(DEMO_PROFILE_TAG);
  revalidatePath(`/${access.clientSlug}/settings`);
  return { ok: true, message: "Gotowe - demo pokazuje teraz liczby tego klienta (jako sklep Mediaspec)." };
}

/** "Przywróć przykładowe dane": the demo goes back to its synthetic shop. */
export async function restoreDemoSampleData(input: { clientSlug: string }): Promise<DemoActionResult> {
  const a = await adminAccess(input);
  if (!a.ok) return { ok: false, error: a.error };
  if (await clearDemoProfile(createAdminClient())) {
    return { ok: false, error: "Nie udało się przywrócić danych. Spróbuj ponownie za chwilę." };
  }
  revalidateTag(DEMO_PROFILE_TAG);
  revalidatePath(`/${a.access.clientSlug}/settings`);
  return { ok: true, message: "Gotowe - demo pokazuje znowu przykładowe dane." };
}
