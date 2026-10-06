"use server";

import { revalidatePath } from "next/cache";

import { BrandingFetchError, fetchBrandingFromWebsite } from "@/lib/branding/fetch";
import type { ColorSource, LogoCandidate } from "@/lib/branding/parse";
import { safeWebsiteUrl } from "@/lib/branding/website";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isAgencyUser, type UserRole } from "@/lib/types";

// "Uzupełnij brandingi": for every client with a website but no logo and/or
// colour, run the website fetcher and save ONLY confident results. Anything
// doubtful (og:image banners, favicons, colours guessed from theme CSS) is
// left for a human in the settings preview - an unattended run must not put
// a wrong logo in front of a client's board.

const CONCURRENCY = 3;
// Each site costs up to ~25 s worst case (page, manifest, image checks at
// 8 s each). Cap the run so it ends well inside the page's maxDuration; the
// rest is picked up by pressing the button again.
const MAX_CLIENTS_PER_RUN = 12;
const TIME_BUDGET_MS = 80_000;

const CONFIDENT_COLOR_SOURCES = new Set<ColorSource>(["theme-color", "manifest", "mask-icon", "svg-logo"]);

function isConfidentLogo(c: LogoCandidate): boolean {
  return (c.kind === "logo" || c.kind === "icon") && (c.confidence === "high" || c.confidence === "medium");
}

export interface BrandingFillItem {
  slug: string;
  name: string;
  status: "filled" | "partial" | "manual" | "skipped";
  filled: Array<"logo" | "color">;
  /** Polish, why a human needs to look (null when fully filled). */
  reason: string | null;
}

export type BrandingFillResult =
  | {
      ok: true;
      /** Clients processed in this run. */
      attempted: number;
      /** Of those, clients with every missing field now filled. */
      completed: number;
      /** Eligible clients left for the next run (limit / time budget). */
      remaining: number;
      items: BrandingFillItem[];
    }
  | { ok: false; error: string };

interface Row {
  id: string;
  slug: string;
  name: string;
  website_url: string | null;
  logo_url: string | null;
  brand_color: string | null;
}

async function requireAgencyUser(): Promise<boolean> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single();
  return Boolean(profile && isAgencyUser(profile.role as UserRole));
}

/** Run `fn` over `items` with at most `limit` in flight, keeping order. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

export async function fillMissingBranding(): Promise<BrandingFillResult> {
  if (!(await requireAgencyUser())) return { ok: false, error: "Brak uprawnień." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clients")
    .select("id, slug, name, website_url, logo_url, brand_color")
    .not("website_url", "is", null)
    .or("logo_url.is.null,brand_color.is.null")
    .order("name", { ascending: true });
  if (error) {
    return {
      ok: false,
      error:
        error.code === "42703" || error.code === "PGRST204"
          ? "Najpierw uruchom w Supabase migracje 0031_client_branding.sql i 0032_client_website.sql."
          : "Nie udało się pobrać listy klientów.",
    };
  }

  const rows = (data ?? []) as Row[];
  const batch = rows.slice(0, MAX_CLIENTS_PER_RUN);
  const started = Date.now();

  const items = await mapPool(batch, CONCURRENCY, async (row): Promise<BrandingFillItem> => {
    const base = { slug: row.slug, name: row.name };
    if (Date.now() - started > TIME_BUDGET_MS) {
      return { ...base, status: "skipped", filled: [], reason: "Zabrakło czasu - uruchom ponownie." };
    }
    const website = safeWebsiteUrl(row.website_url);
    if (!website) return { ...base, status: "manual", filled: [], reason: "Nieprawidłowy adres strony." };

    let result;
    try {
      result = await fetchBrandingFromWebsite(website);
    } catch (err) {
      const reason = err instanceof BrandingFetchError ? err.message : "Nie udało się pobrać strony.";
      if (!(err instanceof BrandingFetchError)) console.error("[branding] bulk fetch failed", row.slug, err);
      return { ...base, status: "manual", filled: [], reason };
    }

    const filled: BrandingFillItem["filled"] = [];
    const reasons: string[] = [];

    if (!row.logo_url) {
      const logo = result.logoCandidates.find(isConfidentLogo);
      if (logo) {
        // `.is(null)` guards against overwriting a logo someone set by hand
        // while this run was fetching.
        const { data: updated, error: saveError } = await admin
          .from("clients")
          .update({ logo_url: logo.url })
          .eq("id", row.id)
          .is("logo_url", null)
          .select("id");
        if (updated?.length) filled.push("logo");
        else if (saveError) reasons.push("nie udało się zapisać: logo");
      } else {
        reasons.push(
          result.logoCandidates.length ? "logo niepewne (tylko og:image / favicon)" : "nie znaleziono logo"
        );
      }
    }

    if (!row.brand_color) {
      const color = result.colorCandidates.find((c) => CONFIDENT_COLOR_SOURCES.has(c.source));
      if (color) {
        const { data: updated, error: saveError } = await admin
          .from("clients")
          .update({ brand_color: color.color })
          .eq("id", row.id)
          .is("brand_color", null)
          .select("id");
        if (updated?.length) filled.push("color");
        else if (saveError) reasons.push("nie udało się zapisać: kolor");
      } else {
        reasons.push(result.colorCandidates.length ? "kolor niepewny (z CSS motywu)" : "nie znaleziono koloru");
      }
    }

    if (filled.length) revalidatePath(`/${row.slug}`, "layout");
    const status: BrandingFillItem["status"] =
      reasons.length === 0 ? "filled" : filled.length ? "partial" : "manual";
    const reason = reasons.length ? `${reasons.join(", ")[0].toUpperCase()}${reasons.join(", ").slice(1)}.` : null;
    return { ...base, status, filled, reason };
  });

  revalidatePath("/clients");
  return {
    ok: true,
    attempted: items.filter((i) => i.status !== "skipped").length,
    completed: items.filter((i) => i.status === "filled").length,
    remaining: rows.length - batch.length + items.filter((i) => i.status === "skipped").length,
    items,
  };
}
