"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { BRAND_COLOR_RE, LOGO_URL_MAX, safeLogoUrl } from "@/lib/dashboard/branding";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";

// Empty string = "no custom value" (reset to the default look).
const LogoUrl = z
  .string()
  .trim()
  .max(LOGO_URL_MAX, `Link może mieć maksymalnie ${LOGO_URL_MAX} znaków.`)
  .refine((v) => v === "" || safeLogoUrl(v) !== null, {
    message: "Wklej pełny link zaczynający się od https://",
  })
  .transform((v) => (v === "" ? null : safeLogoUrl(v)));

const BrandColor = z
  .string()
  .trim()
  .refine((v) => v === "" || BRAND_COLOR_RE.test(v), {
    message: "Kolor podaj w formacie #RRGGBB, np. #1E40AF.",
  })
  .transform((v) => (v === "" ? null : v.toLowerCase()));

const Input = z.object({
  clientSlug: z.string().min(1).max(100),
  logoUrl: LogoUrl,
  brandColor: BrandColor,
});

export type BrandingResult = { ok: true } | { ok: false; error: string };

/**
 * Save the client's logo and accent colour (agency only). Both fields are
 * always sent together, so a reset is just saving an empty value.
 */
export async function saveClientBranding(input: {
  clientSlug: string;
  logoUrl: string;
  brandColor: string;
}): Promise<BrandingResult> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane." };
  }
  const { clientSlug, logoUrl, brandColor } = parsed.data;

  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) return { ok: false, error: "Brak uprawnień do tego klienta." };

  // clients only has a SELECT policy (0002), so writes go through the
  // service role - and only after the agency guard above.
  const { error } = await createAdminClient()
    .from("clients")
    .update({ logo_url: logoUrl, brand_color: brandColor })
    .eq("id", access.clientId);
  if (error) {
    // Missing column (Postgres 42703 / PostgREST schema cache PGRST204):
    // migration 0031 hasn't been run yet.
    return {
      ok: false,
      error:
        error.code === "42703" || error.code === "PGRST204"
          ? "Najpierw uruchom w Supabase migrację 0031_client_branding.sql."
          : error.code === "23514"
            ? "Baza odrzuciła wartość - sprawdź link (https) i kolor (#RRGGBB)."
            : "Nie udało się zapisać. Spróbuj ponownie.",
    };
  }

  // The logo sits in the shared layout (sidebar) of every client page.
  revalidatePath(`/${clientSlug}`, "layout");
  return { ok: true };
}
