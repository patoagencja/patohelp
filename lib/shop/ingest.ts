import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

import type { createAdminClient } from "@/lib/supabase/admin";

import {
  aggregateSales,
  CSV_COLUMN_LABEL,
  dateBounds,
  isIsoDate,
  isMissingTableError,
  MAX_API_ROWS,
  mixedGranularityDate,
  normalizeDateInput,
  normalizeMarket,
  normalizeProduct,
  PRODUCT_MAX,
  toMinorUnits,
  toNumberLoose,
  type CsvField,
  type CsvRecord,
  type SaleRow,
} from "./parse";

// Shop sales ingest, shared by POST /api/ingest/sales (the shop's hourly
// push) and the CSV upload in settings. Server-only: hashes keys with
// node:crypto and writes with the service-role client.

type Admin = ReturnType<typeof createAdminClient>;

// ------------------------------------------------------------------- keys

export const INGEST_KEY_PREFIX = "kal_live_";
/** Characters of the key kept in the DB to recognise it in the UI. */
const VISIBLE_PREFIX_LENGTH = INGEST_KEY_PREFIX.length + 4;
// 32 random bytes in base64url = 43 characters.
const KEY_RE = /^kal_live_[A-Za-z0-9_-]{43}$/;

/**
 * A new API key for a shop. 256 random bits: the key alone lets anyone
 * overwrite the client's sales numbers, so it must be unguessable. Only the
 * hash and a short prefix are stored; the full key is shown once.
 */
export function generateIngestKey(): { key: string; hash: string; prefix: string } {
  const key = `${INGEST_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { key, hash: hashIngestKey(key), prefix: key.slice(0, VISIBLE_PREFIX_LENGTH) };
}

// A plain sha256 is enough: the input is 256 random bits, not a password, so
// there is nothing for a slow hash to protect against brute force.
export function hashIngestKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** Cheap shape check before touching the DB with a hash lookup. */
export function looksLikeIngestKey(value: string): boolean {
  return KEY_RE.test(value);
}

export type KeyLookup =
  | { status: "ok"; clientId: string }
  | { status: "unknown" }
  | { status: "unavailable" };

/** Which client an API key belongs to. "unavailable" = the migration isn't
 *  applied or the DB failed - a server problem, not the caller's. */
export async function findClientByIngestKey(admin: Admin, key: string): Promise<KeyLookup> {
  if (!looksLikeIngestKey(key)) return { status: "unknown" };
  const { data, error } = await admin
    .from("shop_ingest_keys")
    .select("client_id")
    .eq("key_hash", hashIngestKey(key))
    .maybeSingle();
  if (error) return { status: "unavailable" };
  if (!data) return { status: "unknown" };
  return { status: "ok", clientId: data.client_id as string };
}

export interface IngestKeyStatus {
  /** False until migration 0038 (ALL_RECENT_8.sql) has run. */
  available: boolean;
  key: {
    prefix: string;
    createdAt: string | null;
    lastUsedAt: string | null;
    lastRows: number | null;
  } | null;
}

export async function getIngestKeyStatus(admin: Admin, clientId: string): Promise<IngestKeyStatus> {
  const { data, error } = await admin
    .from("shop_ingest_keys")
    .select("key_prefix, created_at, last_used_at, last_rows")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return { available: false, key: null };
    throw new Error(`shop_ingest_keys read failed: ${error.message}`);
  }
  return {
    available: true,
    key: data
      ? {
          prefix: data.key_prefix as string,
          createdAt: (data.created_at as string | null) ?? null,
          lastUsedAt: (data.last_used_at as string | null) ?? null,
          lastRows: (data.last_rows as number | null) ?? null,
        }
      : null,
  };
}

// ------------------------------------------------------------- validation

/**
 * One sales row as the shop sends it (JSON API) or as a CSV line reads.
 * Messages are Polish: they end up in the settings toast and in the API's
 * `issues` for the shop's developer, next to the field path.
 */
export function shopRowSchema(now: Date = new Date()) {
  const { min, max } = dateBounds(now);
  return z.object({
    date: z.preprocess(
      normalizeDateInput,
      z
        .string({
          required_error: "brak daty (RRRR-MM-DD)",
          invalid_type_error: "data ma być tekstem RRRR-MM-DD",
        })
        // One message per bad date, not three (format + both bounds).
        .superRefine((d, ctx) => {
          const message = !isIsoDate(d)
            ? "data w formacie RRRR-MM-DD, np. 2025-12-01"
            : d > max
              ? `data z przyszłości - najpóźniej ${max}`
              : d < min
                ? `data starsza niż 3 lata - najwcześniej ${min}`
                : null;
          if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
        })
    ),
    market: z
      .string({ invalid_type_error: "rynek ma być kodem kraju, np. PL" })
      .nullish()
      .transform(normalizeMarket),
    product: z
      .string({ invalid_type_error: "produkt ma być tekstem" })
      .nullish()
      .transform(normalizeProduct)
      .refine((p) => p.length <= PRODUCT_MAX, `nazwa produktu dłuższa niż ${PRODUCT_MAX} znaków`),
    orders: z.preprocess(
      toNumberLoose,
      z
        .number({
          required_error: "brak liczby zamówień",
          invalid_type_error: "liczba zamówień ma być liczbą",
        })
        .int("liczba zamówień ma być liczbą całkowitą")
        .min(0, "liczba zamówień nie może być ujemna")
        .max(10_000_000, "liczba zamówień nierealnie duża")
    ),
    revenue_pln: z.preprocess(
      toNumberLoose,
      z
        .number({
          required_error: "brak przychodu (PLN brutto)",
          invalid_type_error: "przychód ma być liczbą (PLN brutto)",
        })
        .finite("przychód ma być liczbą (PLN brutto)")
        .min(0, "przychód nie może być ujemny")
        .max(1_000_000_000, "przychód nierealnie duży - podaj PLN, nie grosze")
    ),
    // Optional pay-later figures: orders placed that day but not paid yet.
    pending_orders: z.preprocess(
      toNumberLoose,
      z
        .number({ invalid_type_error: "pending_orders ma być liczbą" })
        .int("pending_orders ma być liczbą całkowitą")
        .min(0, "pending_orders nie może być ujemne")
        .max(10_000_000, "pending_orders nierealnie duże")
        .optional()
    ),
    pending_revenue_pln: z.preprocess(
      toNumberLoose,
      z
        .number({ invalid_type_error: "pending_revenue_pln ma być liczbą (PLN brutto)" })
        .finite()
        .min(0, "pending_revenue_pln nie może być ujemne")
        .max(1_000_000_000, "pending_revenue_pln nierealnie duże - podaj PLN, nie grosze")
        .optional()
    ),
  });
}

export type ShopRow = z.output<ReturnType<typeof shopRowSchema>>;

export interface ValidationIssue {
  /** e.g. "rows.12.date" */
  path: string;
  message: string;
}

const MAX_REPORTED_ISSUES = 20;

/**
 * Validates an API body: { rows: [...] } with at most MAX_API_ROWS rows.
 * Reports up to 20 issues so one systematic mistake (a wrong field name)
 * doesn't turn into 5000 lines of error.
 */
/**
 * The API only takes recent days: an hourly push re-sends the last ~14 days
 * (pay-later orders land up to 10 days late). Older history goes through the
 * CSV upload, by the agency - so a leaked key can't rewrite past seasons
 * that the season comparison and forecast stand on.
 */
export const API_MAX_AGE_DAYS = 45;
/** Distinct values one push may carry - bounds what a leaked key can bloat. */
const API_MAX_PRODUCTS = 100;
const API_MAX_MARKETS = 30;

export function validateApiPayload(
  body: unknown,
  now: Date = new Date()
): { ok: true; rows: ShopRow[] } | { ok: false; error: string; issues: ValidationIssue[] } {
  // Count before validating: zod checks every element before applying
  // .max(), so a huge array of junk cost seconds of CPU and hundreds of MB.
  const raw = (body as { rows?: unknown } | null)?.rows;
  if (Array.isArray(raw) && raw.length > MAX_API_ROWS) {
    return {
      ok: false,
      error: "Nieprawidłowe dane",
      issues: [{ path: "rows", message: `maks. ${MAX_API_ROWS} wierszy na żądanie - podziel dane na kilka żądań` }],
    };
  }
  const schema = z.object(
    {
      rows: z
        .array(shopRowSchema(now), {
          required_error: "brak pola rows",
          invalid_type_error: "rows ma być tablicą",
        })
        .max(MAX_API_ROWS, `maks. ${MAX_API_ROWS} wierszy na żądanie - podziel dane na kilka żądań`),
    },
    { invalid_type_error: "oczekiwano obiektu JSON { \"rows\": [...] }" }
  );
  const parsed = schema.safeParse(body);
  if (parsed.success) {
    const rows = parsed.data.rows;
    const cutoff = new Date(now.getTime() - API_MAX_AGE_DAYS * 86_400_000).toISOString().slice(0, 10);
    const old = rows.findIndex((r) => r.date < cutoff);
    if (old >= 0) {
      return {
        ok: false,
        error: "Nieprawidłowe dane",
        issues: [
          {
            path: `rows.${old}.date`,
            message: `API przyjmuje dane z ostatnich ${API_MAX_AGE_DAYS} dni (od ${cutoff}); starszą historię wgraj plikiem CSV w ustawieniach`,
          },
        ],
      };
    }
    const mixed = mixedGranularityDate(rows);
    if (mixed) {
      return {
        ok: false,
        error: "Nieprawidłowe dane",
        issues: [
          {
            path: "rows",
            message: `dzień ${mixed} ma jednocześnie wiersze z produktem/rynkiem i bez - wyślij każdy dzień na jednym poziomie szczegółów`,
          },
        ],
      };
    }
    if (new Set(rows.map((r) => r.product)).size > API_MAX_PRODUCTS) {
      return {
        ok: false,
        error: "Nieprawidłowe dane",
        issues: [{ path: "rows", message: `maks. ${API_MAX_PRODUCTS} różnych produktów w jednym żądaniu` }],
      };
    }
    if (new Set(rows.map((r) => r.market)).size > API_MAX_MARKETS) {
      return {
        ok: false,
        error: "Nieprawidłowe dane",
        issues: [{ path: "rows", message: `maks. ${API_MAX_MARKETS} różnych rynków w jednym żądaniu` }],
      };
    }
    return { ok: true, rows };
  }
  const issues = parsed.error.issues.slice(0, MAX_REPORTED_ISSUES).map((i) => ({
    path: i.path.join("."),
    message: i.message,
  }));
  return { ok: false, error: "Nieprawidłowe dane", issues };
}

/**
 * Validates parsed CSV records with the same row schema as the API. Stops at
 * the first bad line: a CSV usually breaks the same way on every line, and
 * the person fixing it needs a line number, not a list.
 */
export function validateCsvRecords(
  records: readonly CsvRecord[],
  now: Date = new Date()
): { ok: true; rows: ShopRow[] } | { ok: false; error: string } {
  const schema = shopRowSchema(now);
  const rows: ShopRow[] = [];
  for (const record of records) {
    const parsed = schema.safeParse(record.values);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path[0] as CsvField | undefined;
      const raw = field ? record.values[field] : "";
      const column = field && CSV_COLUMN_LABEL[field] ? `kolumna „${CSV_COLUMN_LABEL[field]}”: ` : "";
      const shown = raw ? ` (jest: „${raw.length > 40 ? `${raw.slice(0, 40)}…` : raw}”)` : "";
      return { ok: false, error: `Wiersz ${record.line}: ${column}${issue?.message ?? "błędne dane"}${shown}.` };
    }
    rows.push(parsed.data);
  }
  return { ok: true, rows };
}

/** Validated rows -> grosze, duplicates of one key summed. */
export function toSaleRows(rows: readonly ShopRow[]): SaleRow[] {
  return aggregateSales(
    rows.map((r) => ({
      date: r.date,
      market: r.market,
      product: r.product,
      orders: r.orders,
      revenueMinor: toMinorUnits(r.revenue_pln),
      pendingOrders: r.pending_orders ?? 0,
      pendingRevenueMinor: toMinorUnits(r.pending_revenue_pln ?? 0),
    }))
  );
}

// ----------------------------------------------------------------- writes

const UPSERT_CHUNK = 500;

export type UpsertResult =
  | { ok: true; rows: number }
  | { ok: false; missingTable: boolean; message: string };

/**
 * Writes aggregated rows, replacing the numbers already stored for the same
 * (client, date, market, product) - the shop re-sends the last 14 days every
 * hour as pay-later payments land, so a re-send must overwrite, never add.
 * Chunks run one after another; if one fails the earlier ones stay written,
 * which is harmless because re-sending the same data converges.
 */
export async function upsertShopSales(
  admin: Admin,
  clientId: string,
  rows: readonly SaleRow[],
  source: "api" | "csv"
): Promise<UpsertResult> {
  const updatedAt = new Date().toISOString();
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK).map((r) => ({
      client_id: clientId,
      date: r.date,
      market: r.market,
      product: r.product,
      orders: r.orders,
      revenue_minor_units: r.revenueMinor,
      pending_orders: r.pendingOrders ?? 0,
      pending_revenue_minor_units: r.pendingRevenueMinor ?? 0,
      source,
      updated_at: updatedAt,
    }));
    const { error } = await admin
      .from("shop_sales_daily")
      .upsert(chunk, { onConflict: "client_id,date,market,product" });
    if (error) {
      return { ok: false, missingTable: isMissingTableError(error), message: error.message };
    }
  }
  return { ok: true, rows: rows.length };
}

/**
 * An API push is the truth for the days it carries: rows those days had
 * before but the push no longer contains (a refunded order's product, a
 * market with no sales left) are removed, or they'd stay forever. Called
 * before the upsert; a failure leaves the old rows (re-sent next hour).
 */
export async function clearPushedDays(admin: Admin, clientId: string, dates: readonly string[]): Promise<void> {
  const unique = Array.from(new Set(dates));
  for (let i = 0; i < unique.length; i += 100) {
    await admin
      .from("shop_sales_daily")
      .delete()
      .eq("client_id", clientId)
      .in("date", unique.slice(i, i + 100));
  }
}

/** Pushes one key may make per hour (an hourly push needs a handful). */
const RATE_PER_HOUR = 120;

/**
 * Per-key hourly budget. Not atomic - two racing requests may both pass at
 * the edge - which is fine: the point is to stop a leaked key from looping
 * thousands of writes, not to count exactly. Unavailable columns (migration
 * not applied) let the request through rather than block a real shop.
 */
export async function takeIngestSlot(admin: Admin, clientId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("shop_ingest_keys")
    .select("rate_window_start, rate_count")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error || !data) return true;
  const row = data as { rate_window_start: string | null; rate_count: number | null };
  const now = Date.now();
  const start = row.rate_window_start ? Date.parse(row.rate_window_start) : 0;
  const fresh = !start || now - start > 3_600_000;
  const count = fresh ? 1 : (row.rate_count ?? 0) + 1;
  if (!fresh && count > RATE_PER_HOUR) return false;
  await admin
    .from("shop_ingest_keys")
    .update({
      rate_window_start: fresh ? new Date(now).toISOString() : row.rate_window_start,
      rate_count: count,
    })
    .eq("client_id", clientId);
  return true;
}

/** Stamp the key after a successful push ("ostatnie dane z API" in settings). */
export async function markIngestKeyUsed(admin: Admin, clientId: string, rows: number): Promise<void> {
  await admin
    .from("shop_ingest_keys")
    .update({ last_used_at: new Date().toISOString(), last_rows: rows })
    .eq("client_id", clientId);
}
