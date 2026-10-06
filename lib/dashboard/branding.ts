import type { CSSProperties } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

// "Panel w barwach klienta" (migration 0031): the client's own logo and an
// optional accent colour. Both are client data, not design tokens - the colour
// only ever reaches the UI through the `--client-accent` CSS variable (see the
// `client-accent` colour in tailwind.config.ts), and only in subtle places.
//
// Everything here re-validates what comes out of the DB: the values land in an
// <img src> and a style attribute, so the DB check constraint is not the only
// line of defence (older rows, a constraint dropped by hand, the demo).

export const LOGO_URL_MAX = 500;
export const BRAND_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export interface ClientBranding {
  logoUrl: string | null;
  brandColor: string | null;
}

export const NO_BRANDING: ClientBranding = { logoUrl: null, brandColor: null };

/** Where the native colour picker opens when no colour is set yet (an
 *  <input type="color"> can't be empty). Our indigo primary, as hex. */
export const BRAND_COLOR_PICKER_START = "#4f46e5";

/** An https URL we are willing to put in <img src>, or null. */
export function safeLogoUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.length > LOGO_URL_MAX || /\s/.test(v)) return null;
  try {
    const url = new URL(v);
    return url.protocol === "https:" && url.hostname ? url.toString() : null;
  } catch {
    return null;
  }
}

/** A strict #rrggbb colour (lower-cased), or null. */
export function safeBrandColor(value: unknown): string | null {
  return typeof value === "string" && BRAND_COLOR_RE.test(value.trim())
    ? value.trim().toLowerCase()
    : null;
}

export function toBranding(row: { logo_url?: unknown; brand_color?: unknown } | null) {
  return row
    ? { logoUrl: safeLogoUrl(row.logo_url), brandColor: safeBrandColor(row.brand_color) }
    : NO_BRANDING;
}

/**
 * Branding for one client. `available: false` means migration 0031 has not
 * been run (the select errors on the missing columns) - callers then keep the
 * default look instead of failing the page or the e-mail.
 */
export async function getClientBranding(
  supabase: SupabaseClient,
  clientId: string
): Promise<ClientBranding & { available: boolean }> {
  const { data, error } = await supabase
    .from("clients")
    .select("logo_url, brand_color")
    .eq("id", clientId)
    .maybeSingle();
  if (error) return { ...NO_BRANDING, available: false };
  return { ...toBranding(data), available: true };
}

/**
 * Style for the wrapper that scopes the accent: sets `--client-accent` only
 * when a valid colour exists, so everything else falls back to the primary
 * colour (the token's own fallback).
 */
export function clientAccentStyle(brandColor: string | null | undefined): CSSProperties | undefined {
  const color = safeBrandColor(brandColor);
  return color ? ({ "--client-accent": color } as CSSProperties) : undefined;
}
