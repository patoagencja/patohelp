// Pure helpers for shop sales ingest: market/product/number/date
// normalisation, CSV parsing and per-key aggregation. No imports on purpose:
// lib/shop/parse.test.ts runs this file directly under `node --test`, which
// can't resolve the "@/..." alias or extension-less relative imports.

/** Most rows one POST /api/ingest/sales may carry. */
export const MAX_API_ROWS = 5000;
/** Product names longer than this are rejected, not cut: two names sharing
 *  a prefix would otherwise silently merge into one key. */
export const PRODUCT_MAX = 80;

// Codes shops use that aren't the ones we key on: GB is the UK (the season
// view's campaign-name parser uses the same aliases), ".com" stores sell to
// the international / US market.
const MARKET_ALIASES: Record<string, string> = { GB: "UK", ENG: "UK", USA: "US", COM: "US" };

/**
 * Country code for a market: upper-cased, aliased (GB -> UK, USA/COM -> US),
 * 2-3 letters. A locale like "pt-BR" / "en_GB" keeps its region part.
 * Anything else ("Polska", "", null) becomes '' - unknown market, still
 * counted in the totals.
 */
export function normalizeMarket(value: unknown): string {
  if (typeof value !== "string") return "";
  let v = value.trim().toUpperCase().replace(/^\./, "");
  const locale = /^[A-Z]{2}[-_]([A-Z]{2})$/.exec(v);
  if (locale) v = locale[1];
  v = MARKET_ALIASES[v] ?? v;
  return /^[A-Z]{2,3}$/.test(v) ? v : "";
}

/**
 * Product key: trimmed, inner whitespace collapsed and Unicode-composed, so
 * "List  od Mikołaja" from one export and the decomposed "ł" from another
 * land on the same row instead of splitting a product in two.
 */
export function normalizeProduct(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

/**
 * Lenient number parsing for spreadsheet exports and JSON strings:
 * "1 234,56", "1234.56", "1.234,56", "1,234.56", "99 zł" -> number.
 * A lone separator is the decimal one (Polish exports use a comma); when
 * both appear, the last one is. Returns null for anything else.
 */
export function parseDecimal(input: string): number | null {
  let s = input
    .trim()
    .replace(/\s*(zł|pln)$/i, "")
    .replace(/[\s  ']/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    const decimal = lastComma > lastDot ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    s = s.split(thousands).join("").replace(decimal, ".");
  } else if (lastComma !== -1 || lastDot !== -1) {
    const sep = lastComma !== -1 ? "," : ".";
    const count = s.split(sep).length - 1;
    // "1,234,567" is grouping; a single separator is the decimal point.
    s = count > 1 ? s.split(sep).join("") : s.replace(sep, ".");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Numbers pass through; numeric strings are parsed (PHP's json_encode of
 *  DB values often sends "12" / "1234.50"); anything else is returned as is
 *  so the schema reports it. */
export function toNumberLoose(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const n = parseDecimal(value);
  return n === null ? value : n;
}

/**
 * "YYYY-MM-DD" stays; spreadsheet variants are mapped to it: "DD.MM.YYYY"
 * and a midnight timestamp ("2025-12-01 00:00:00"). A timestamp with a real
 * time is left alone (and rejected) - which day it belongs to depends on a
 * timezone we don't know.
 */
export function normalizeDateInput(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const v = value.trim();
  const midnight = /^(\d{4}-\d{2}-\d{2})[ T]00:00(:00(\.0+)?)?Z?$/.exec(v);
  if (midnight) return midnight[1];
  const pl = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(v);
  if (pl) return `${pl[3]}-${pl[2].padStart(2, "0")}-${pl[1].padStart(2, "0")}`;
  return v;
}

/** True for a "YYYY-MM-DD" that names a real calendar day. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Accepted date window: three years back to tomorrow (UTC). Tomorrow, not
 * today: the shop dates orders on its own clock (Warsaw, UTC+1/+2), which
 * passes midnight an hour or two before UTC does. Three years covers the
 * history a season comparison needs without letting a typo'd year in.
 */
export function dateBounds(now: Date): { min: string; max: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { min: iso(Date.UTC(y - 3, m, d)), max: iso(Date.UTC(y, m, d + 1)) };
}

/** PLN (major units, may carry fractions) -> grosze. */
export function toMinorUnits(pln: number): number {
  return Math.round(pln * 100);
}

export interface SaleRow {
  date: string;
  market: string;
  product: string;
  orders: number;
  revenueMinor: number;
}

/**
 * Sums rows that share (date, market, product). A payload may carry the same
 * key twice (two order lines of one product, two variants mapped to one
 * name); the upsert replaces per key, so without summing the second row
 * would silently overwrite the first. Sorted by key for stable output.
 */
export function aggregateSales(rows: readonly SaleRow[]): SaleRow[] {
  const byKey = new Map<string, SaleRow>();
  for (const r of rows) {
    const key = `${r.date}\u0000${r.market}\u0000${r.product}`;
    const hit = byKey.get(key);
    if (hit) {
      hit.orders += r.orders;
      hit.revenueMinor += r.revenueMinor;
    } else {
      byKey.set(key, { ...r });
    }
  }
  return Array.from(byKey.values()).sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.market.localeCompare(b.market) ||
      a.product.localeCompare(b.product)
  );
}

/** [min, max] date of rows, or null when empty. */
export function dateRange(rows: readonly { date: string }[]): [string, string] | null {
  if (rows.length === 0) return null;
  let min = rows[0].date;
  let max = rows[0].date;
  for (const r of rows) {
    if (r.date < min) min = r.date;
    if (r.date > max) max = r.date;
  }
  return [min, max];
}

// ------------------------------------------------------------------- CSV

export type CsvField = "date" | "market" | "product" | "orders" | "revenue_pln";

/** Column name shown in Polish error messages. */
export const CSV_COLUMN_LABEL: Record<CsvField, string> = {
  date: "data",
  market: "rynek",
  product: "produkt",
  orders: "zamowienia",
  revenue_pln: "przychod_pln",
};

// Header names (lower-case, without Polish diacritics) -> field. Polish is
// the documented format; English matches the JSON API.
const HEADER_ALIASES: Record<string, CsvField> = {
  data: "date",
  date: "date",
  dzien: "date",
  day: "date",
  rynek: "market",
  kraj: "market",
  market: "market",
  country: "market",
  produkt: "product",
  product: "product",
  zamowienia: "orders",
  orders: "orders",
  przychod_pln: "revenue_pln",
  przychod: "revenue_pln",
  revenue_pln: "revenue_pln",
  revenue: "revenue_pln",
};

const REQUIRED_COLUMNS: CsvField[] = ["date", "orders", "revenue_pln"];

function headerKey(cell: string): string {
  return cell
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

/**
 * Splits CSV text into rows of cells. RFC 4180 quoting ("a;b", "say ""hi""",
 * line breaks inside quotes); \n, \r\n and \r line endings. Each row keeps
 * the 1-based line it starts on, for error messages.
 */
export function splitCsv(text: string, delimiter: string): Array<{ line: number; cells: string[] }> {
  const out: Array<{ line: number; cells: string[] }> = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === delimiter) {
      cells.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      cells.push(cell);
      out.push({ line: rowLine, cells });
      cells = [];
      cell = "";
      line++;
      rowLine = line;
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || cells.length > 0) {
    cells.push(cell);
    out.push({ line: rowLine, cells });
  }
  return out;
}

export type CsvRecord = { line: number; values: Record<CsvField, string> };

export type CsvParseResult =
  | { ok: true; records: CsvRecord[] }
  | { ok: false; error: string };

/**
 * Parses a sales CSV into raw records (strings; the row schema converts and
 * validates them). Delimiter: ";" (Polish Excel) or ",", or a tab -
 * whichever the header line uses. Empty lines are skipped. Columns may come
 * in any order; market and product are optional.
 */
export function parseSalesCsv(input: string): CsvParseResult {
  const text = input.replace(/^﻿/, "");
  const firstLine = /^.*\S.*$/m.exec(text)?.[0];
  if (!firstLine) return { ok: false, error: "Plik jest pusty." };
  const delimiter = firstLine.includes(";") ? ";" : firstLine.includes("\t") ? "\t" : ",";

  const rows = splitCsv(text, delimiter).filter((r) => r.cells.some((c) => c.trim() !== ""));
  const header = rows[0];
  const columns = header.cells.map((c) => HEADER_ALIASES[headerKey(c)] ?? null);
  const missing = REQUIRED_COLUMNS.filter((f) => !columns.includes(f));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Wiersz ${header.line}: brak kolumn ${missing
        .map((f) => `„${CSV_COLUMN_LABEL[f]}”`)
        .join(", ")}. Pierwszy wiersz to nagłówek: data;rynek;produkt;zamowienia;przychod_pln`,
    };
  }
  const dup = columns.find((c, i) => c !== null && columns.indexOf(c) !== i);
  if (dup) {
    return {
      ok: false,
      error: `Wiersz ${header.line}: kolumna „${CSV_COLUMN_LABEL[dup]}” występuje dwa razy.`,
    };
  }

  const records: CsvRecord[] = [];
  for (const row of rows.slice(1)) {
    if (row.cells.length > columns.length && row.cells.slice(columns.length).some((c) => c.trim())) {
      return {
        ok: false,
        error: `Wiersz ${row.line}: więcej pól niż kolumn w nagłówku - jeśli kwota ma przecinek, a separatorem jest przecinek, ujmij ją w cudzysłów albo użyj średnika.`,
      };
    }
    const values: Record<CsvField, string> = {
      date: "",
      market: "",
      product: "",
      orders: "",
      revenue_pln: "",
    };
    columns.forEach((field, i) => {
      if (field) values[field] = (row.cells[i] ?? "").trim();
    });
    records.push({ line: row.line, values });
  }
  if (records.length === 0) return { ok: false, error: "Plik ma tylko nagłówek - brak wierszy z danymi." };
  return { ok: true, records };
}

/**
 * CSV bytes -> text. UTF-8 first; Polish Excel still saves "CSV" as
 * Windows-1250, which would turn product names with ą/ł/ż into garbage
 * keys, so invalid UTF-8 falls back to that.
 */
export function decodeCsvBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1250").decode(bytes);
  }
}

/**
 * True when a Supabase/PostgREST error means the table (or a column) isn't
 * there yet - the migration hasn't been run. Postgres 42P01 = undefined
 * table; PGRST205 / PGRST204 = not in PostgREST's schema cache.
 */
export function isMissingTableError(error: { code?: string | null } | null | undefined): boolean {
  const code = error?.code ?? "";
  return code === "42P01" || code === "PGRST205" || code === "PGRST204";
}
