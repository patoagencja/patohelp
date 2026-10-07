"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { clientDataTag } from "@/lib/dashboard/sync-cache";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import {
  generateIngestKey,
  toSaleRows,
  upsertShopSales,
  validateCsvRecords,
} from "@/lib/shop/ingest";
import { decodeCsvBytes, isMissingTableError, parseSalesCsv } from "@/lib/shop/parse";
import { createAdminClient } from "@/lib/supabase/admin";

// Vercel rejects function request bodies over 4.5 MB before they reach us,
// so the file limit sits under that (next.config.mjs raises the Server Action
// body limit to match). A whole season of a 7-market shop is well under 1 MB.
const MAX_CSV_BYTES = 4 * 1024 * 1024;
const MIGRATION_HINT = "Najpierw uruchom supabase/migrations/ALL_RECENT_8.sql w Supabase.";

const Input = z.object({ clientSlug: z.string().min(1).max(100) });

export type ShopKeyResult =
  | { ok: true; key: string; prefix: string }
  | { ok: false; error: string };

/**
 * Generates the shop's API key, replacing any previous one (the old key stops
 * working at once). The full key is returned to the calling client component
 * exactly once - only its hash is stored - and never travels in a URL.
 */
export async function generateShopIngestKey(input: { clientSlug: string }): Promise<ShopKeyResult> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane." };

  const access = await requireAgencyClientAccess(parsed.data.clientSlug);
  if (!access.ok) return { ok: false, error: "Brak uprawnień do tego klienta." };

  const { key, hash, prefix } = generateIngestKey();
  // shop_ingest_keys has RLS with no policies - service role only.
  const { error } = await createAdminClient()
    .from("shop_ingest_keys")
    .upsert(
      {
        client_id: access.clientId,
        key_hash: hash,
        key_prefix: prefix,
        created_at: new Date().toISOString(),
        last_used_at: null,
        last_rows: null,
      },
      { onConflict: "client_id" }
    );
  if (error) {
    return {
      ok: false,
      error: isMissingTableError(error) ? MIGRATION_HINT : "Nie udało się zapisać klucza. Spróbuj ponownie.",
    };
  }

  revalidatePath(`/${access.clientSlug}/settings`);
  return { ok: true, key, prefix };
}

/** Deletes the shop's API key: its next push gets 401. Data already sent stays. */
export async function disableShopIngestKey(input: {
  clientSlug: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane." };

  const access = await requireAgencyClientAccess(parsed.data.clientSlug);
  if (!access.ok) return { ok: false, error: "Brak uprawnień do tego klienta." };

  const { error } = await createAdminClient()
    .from("shop_ingest_keys")
    .delete()
    .eq("client_id", access.clientId);
  if (error) return { ok: false, error: "Nie udało się wyłączyć klucza. Spróbuj ponownie." };

  revalidatePath(`/${access.clientSlug}/settings`);
  return { ok: true };
}

/**
 * CSV history upload (e.g. last season exported from the shop's panel).
 * Same validation and upsert as the API, source 'csv'. Redirects back with
 * ?saved=shop_csv&rows=N, or ?error=shop_csv&msg=<Polish message naming the
 * first bad line> for the settings toast.
 */
export async function uploadShopSalesCsv(formData: FormData) {
  const clientSlug = String(formData.get("client") ?? "");
  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) return;

  const back = `/${access.clientSlug}/settings`;
  function fail(message: string): never {
    redirect(`${back}?error=shop_csv&msg=${encodeURIComponent(message.slice(0, 300))}#sprzedaz-sklepu`);
  }

  const file = formData.get("file");
  if (!file || typeof file === "string" || file.size === 0) fail("Wybierz plik CSV.");
  if (file.size > MAX_CSV_BYTES) {
    fail("Plik jest za duży (maks. 4 MB). Podziel go na kilka części, np. po sezonach.");
  }

  const parsed = parseSalesCsv(decodeCsvBytes(new Uint8Array(await file.arrayBuffer())));
  if (!parsed.ok) fail(parsed.error);

  const validated = validateCsvRecords(parsed.records);
  if (!validated.ok) fail(validated.error);

  const saved = await upsertShopSales(
    createAdminClient(),
    access.clientId,
    toSaleRows(validated.rows),
    "csv"
  );
  if (!saved.ok) {
    console.error(`[shop-sales] CSV upsert failed for client ${access.clientId}: ${saved.message}`);
    fail(saved.missingTable ? MIGRATION_HINT : "Nie udało się zapisać danych. Spróbuj ponownie.");
  }

  // Sales may feed any of the client's pages once wired in, not just settings.
  // The season page caches per ad-sync stamp + last API push; a CSV upload
  // moves neither, so drop this client's cached aggregates explicitly.
  revalidateTag(clientDataTag(access.clientId));
  revalidatePath(`/${access.clientSlug}`, "layout");
  redirect(`${back}?saved=shop_csv&rows=${saved.rows}#sprzedaz-sklepu`);
}
