// Import-free: lib/export/csv.test.ts runs this file directly under Node's
// type stripping, which can't resolve "@/..." or extension-less imports.

/**
 * "Pobierz do Excela": a CSV a Polish Excel opens right with a double click.
 * Polish Excel splits columns on ";" (its list separator), reads numbers with
 * a decimal comma, and only decodes the file as UTF-8 when it starts with a
 * BOM - without one "Klikalność" turns into "KlikalnoĹ›Ä‡".
 */

/** How a column's values are written. Money is always grosze in, złoty out. */
export type CsvKind = "text" | "int" | "money" | "percent" | "decimal" | "date";

export interface CsvColumn {
  /** Exactly the label the table shows on screen. */
  header: string;
  kind: CsvKind;
  /** Fraction digits for "percent" and "decimal" (default 2). */
  digits?: number;
}

/** One cell. null/undefined (a "-" on screen) becomes an empty cell. */
export type CsvValue = string | number | null | undefined;

/** Who and which window a table export covers (for the file name). */
export interface ExportScope {
  /** Client slug ("dre"). */
  client: string;
  /** First and last day shown, yyyy-MM-dd; null when unknown. */
  from: string | null;
  to: string | null;
}

export const CSV_BOM = "﻿";
const SEPARATOR = ";";
// CRLF: what Excel writes itself, and what RFC 4180 asks for.
const EOL = "\r\n";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Excel treats a cell starting with one of these as a formula: a campaign
// named "-30% na drzwi" would open as #NAME?, and a crafted name could run
// one. A leading apostrophe makes Excel keep the cell as text.
const FORMULA_START = /^[=+\-@\t\r]/;

function toNumber(value: CsvValue): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Fixed digits with a decimal comma; never "-0,00" for a rounded-away minus. */
function fixed(n: number, digits: number): string {
  const s = n.toFixed(digits);
  return (/^-0(\.0*)?$/.test(s) ? s.slice(1) : s).replace(".", ",");
}

/**
 * Grosze to złoty with exactly two decimals, in integer maths so 0.1 + 0.2
 * style float noise can never show up as "12,34000001".
 */
function money(minorUnits: number): string {
  const minor = Math.round(minorUnits);
  const abs = Math.abs(minor);
  const zl = Math.floor(abs / 100);
  const gr = String(abs % 100).padStart(2, "0");
  return `${minor < 0 ? "-" : ""}${zl},${gr}`;
}

function textCell(s: string): string {
  return FORMULA_START.test(s) ? `'${s}` : s;
}

/**
 * One value as Excel should read it (before quoting). Numbers carry no
 * thousands separators or units, so Excel sees numbers, not text; percent
 * values stay in percent units (2.4 -> "2,40", as on screen without "%").
 */
export function formatCsvValue(value: CsvValue, column: CsvColumn): string {
  const digits = column.digits ?? 2;
  switch (column.kind) {
    case "int": {
      const n = toNumber(value);
      return n == null ? "" : fixed(Math.round(n), 0);
    }
    case "money": {
      const n = toNumber(value);
      return n == null ? "" : money(n);
    }
    case "percent":
    case "decimal": {
      const n = toNumber(value);
      return n == null ? "" : fixed(n, digits);
    }
    case "date": {
      if (value == null) return "";
      const s = String(value);
      // Days only: a UTC timestamp's date can be a different Warsaw day, so
      // callers convert first; anything else is written as plain text.
      return ISO_DATE.test(s) ? s : textCell(s);
    }
    default:
      return value == null ? "" : textCell(String(value));
  }
}

/** Quote a field when it holds the separator, a quote or a line break. */
export function escapeCsvField(text: string): string {
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The whole file: BOM, the header row, then one line per row, values in
 * column order. An empty table still gets its header row.
 */
export function buildCsv(
  columns: readonly CsvColumn[],
  rows: ReadonlyArray<readonly CsvValue[]>
): string {
  const lines = [columns.map((c) => escapeCsvField(textCell(c.header))).join(SEPARATOR)];
  for (const row of rows) {
    lines.push(columns.map((c, i) => escapeCsvField(formatCsvValue(row[i], c))).join(SEPARATOR));
  }
  return CSV_BOM + lines.join(EOL) + EOL;
}

/** File-name safe: lower case, no Polish letters, words joined by "-". */
function slugPart(s: string): string {
  return s
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "kaleido-dre-kampanie-2026-10-01_2026-10-31.csv" (dates left out when unknown). */
export function csvFileName(scope: ExportScope, table: string): string {
  const parts = ["kaleido", slugPart(scope.client), slugPart(table)].filter(Boolean);
  const from = scope.from && ISO_DATE.test(scope.from) ? scope.from : null;
  const to = scope.to && ISO_DATE.test(scope.to) ? scope.to : null;
  const window = from && to ? `-${from}_${to}` : "";
  return `${parts.join("-")}${window}.csv`;
}
