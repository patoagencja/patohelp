"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { BrandingFetchError, fetchBrandingFromWebsite } from "@/lib/branding/fetch";
import type { ColorCandidate, LogoCandidate } from "@/lib/branding/parse";
import { URL_PROBLEM_MESSAGE, WEBSITE_URL_MAX, parseWebsiteUrl } from "@/lib/branding/website";
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

// ---------------------------------------------------------------------------
// "Pobierz ze strony": fetch the client's website and PROPOSE a logo and a
// colour. Nothing branding-related is written here - the agency user picks
// from the preview and saves through saveClientBranding above.

const PreviewInput = z.object({
  clientSlug: z.string().min(1).max(100),
  websiteUrl: z
    .string()
    .trim()
    .min(1, "Wpisz adres strony klienta.")
    .max(WEBSITE_URL_MAX, `Adres może mieć maksymalnie ${WEBSITE_URL_MAX} znaków.`),
});

export interface BrandingPreview {
  /** Normalised URL that was fetched (and remembered, see websiteSaved). */
  websiteUrl: string;
  /** False before migration 0032 - the preview still works, the URL isn't kept. */
  websiteSaved: boolean;
  siteName: string | null;
  finalUrl: string;
  notes: string[];
  logoCandidates: Array<Pick<LogoCandidate, "url" | "kind" | "confidence" | "label">>;
  colorCandidates: Array<Pick<ColorCandidate, "color" | "source" | "label">>;
}

export type BrandingPreviewResult = { ok: true; preview: BrandingPreview } | { ok: false; error: string };

/** Remember the website for next time and for the bulk fill on /clients. */
async function saveWebsiteUrl(clientId: string, websiteUrl: string): Promise<boolean> {
  const { error } = await createAdminClient()
    .from("clients")
    .update({ website_url: websiteUrl })
    .eq("id", clientId);
  // 42703 / PGRST204: migration 0032 not run yet - not worth failing over.
  return !error;
}

export async function fetchBrandingPreview(input: {
  clientSlug: string;
  websiteUrl: string;
}): Promise<BrandingPreviewResult> {
  const parsed = PreviewInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane." };
  }
  const website = parseWebsiteUrl(parsed.data.websiteUrl);
  if (!website.ok) return { ok: false, error: URL_PROBLEM_MESSAGE[website.problem] };

  // The fetch is an outbound request to a user-typed host: agency only.
  const access = await requireAgencyClientAccess(parsed.data.clientSlug);
  if (!access.ok) return { ok: false, error: "Brak uprawnień do tego klienta." };

  try {
    const result = await fetchBrandingFromWebsite(website.url);
    const websiteSaved = await saveWebsiteUrl(access.clientId, website.url);
    if (websiteSaved) revalidatePath(`/${access.clientSlug}/settings`);
    return {
      ok: true,
      preview: {
        websiteUrl: website.url,
        websiteSaved,
        siteName: result.siteName,
        finalUrl: result.finalUrl,
        notes: result.notes,
        logoCandidates: result.logoCandidates.map(({ url, kind, confidence, label }) => ({ url, kind, confidence, label })),
        colorCandidates: result.colorCandidates.map(({ color, source, label }) => ({ color, source, label })),
      },
    };
  } catch (err) {
    if (err instanceof BrandingFetchError) {
      // The site exists but misbehaved (timeout, 403, bad TLS): the address
      // is probably right, keep it so the next try doesn't need retyping.
      if (!["invalid_url", "blocked_host", "dns"].includes(err.code)) {
        await saveWebsiteUrl(access.clientId, website.url);
      }
      return { ok: false, error: err.message };
    }
    console.error("[branding] fetchBrandingPreview failed", err);
    return { ok: false, error: "Nie udało się pobrać strony. Spróbuj ponownie." };
  }
}
