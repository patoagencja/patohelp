"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";

import { clientDataTag } from "@/lib/dashboard/sync-cache";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import {
  generateIngestKey,
  toSaleRows,
  clearPushedDays,
  upsertShopSales,
  validateCsvRecords,
} from "@/lib/shop/ingest";
import { decodeCsvBytes, isMissingTableError, mixedGranularityDate, parseSalesCsv } from "@/lib/shop/parse";
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

/** Rows one upload may hold: ~10 seasons x 7 markets x a few products. */
const MAX_CSV_ROWS = 50_000;

export type CsvUploadResult = { ok: true; rows: number } | { ok: false; error: string };

/**
 * CSV history upload (e.g. last season exported from the shop's panel).
 * Same validation and upsert as the API, source 'csv'. Returns the result to
 * the calling component, which shows the toast - the message used to ride
 * back in the URL, where anyone could craft a convincing fake one.
 */
export async function uploadShopSalesCsv(formData: FormData): Promise<CsvUploadResult> {
  const clientSlug = String(formData.get("client") ?? "");
  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) return { ok: false, error: "Brak dostępu do tego klienta." };

  const file = formData.get("file");
  if (!file || typeof file === "string" || file.size === 0) return { ok: false, error: "Wybierz plik CSV." };
  if (file.size > MAX_CSV_BYTES) {
    return { ok: false, error: "Plik jest za duży (maks. 4 MB). Podziel go na kilka części, np. po sezonach." };
  }

  const parsed = parseSalesCsv(decodeCsvBytes(new Uint8Array(await file.arrayBuffer())));
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (parsed.records.length > MAX_CSV_ROWS) {
    return {
      ok: false,
      error: `Plik ma ${parsed.records.length} wierszy (maks. ${MAX_CSV_ROWS}). Podziel go na kilka części, np. po sezonach.`,
    };
  }

  const validated = validateCsvRecords(parsed.records);
  if (!validated.ok) return { ok: false, error: validated.error };

  const rows = toSaleRows(validated.rows);
  // Same rules as the API: one level of detail per day, and a file
  // replaces the days it contains. Only upserting kept a day's old
  // per-product rows next to a new day total (revenue twice) and left
  // renamed products behind.
  const mixed = mixedGranularityDate(rows);
  if (mixed) {
    return {
      ok: false,
      error: `Dzień ${mixed} ma w pliku wiersze z produktem i bez - podaj go albo w całości per produkt, albo jedną sumą.`,
    };
  }
  const admin = createAdminClient();
  await clearPushedDays(admin, access.clientId, rows.map((r) => r.date));
  const saved = await upsertShopSales(admin, access.clientId, rows, "csv");
  if (!saved.ok) {
    console.error(`[shop-sales] CSV upsert failed for client ${access.clientId}: ${saved.message}`);
    return { ok: false, error: saved.missingTable ? MIGRATION_HINT : "Nie udało się zapisać danych. Spróbuj ponownie." };
  }

  // The season page caches per ad-sync stamp + last API push; a CSV upload
  // moves neither, so drop this client's cached aggregates explicitly.
  revalidateTag(clientDataTag(access.clientId));
  revalidatePath(`/${access.clientSlug}`, "layout");
  return { ok: true, rows: saved.rows };
}
