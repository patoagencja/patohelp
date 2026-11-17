// Hand-entered ad costs: parsing what people type or paste into the grid
// (a block copied from Google Sheets / Excel), and turning the edited grid
// into one bulk save. Pure and import-free: lib/daily-net/paste.test.ts runs
// it directly under `node --test` with type stripping.

/** What a pasted number means: złoty, or thousands of złoty (the shop's sheet). */
export type PasteUnit = "zl" | "tys";

/** Most a single day's cost in one channel may be (zł): a typo guard. */
export const MAX_AMOUNT_ZL = 10_000_000;

/**
 * A clipboard block into rows of cells: rows split on line breaks, cells on
 * tabs (what both Sheets and Excel put on the clipboard). A trailing line
 * break (Excel always adds one) is not an extra row; a cell Sheets wrapped
 * in quotes loses them.
 */
export function splitPastedBlock(text: string): string[][] {
  const rows = text.replace(/\r\n?/g, "\n").split("\n");
  while (rows.length > 0 && rows[rows.length - 1].trim() === "") rows.pop();
  return rows.map((row) => row.split("\t").map((cell) => cell.trim().replace(/^"(.*)"$/, "$1").trim()));
}

/** True when the text is a block (more than one cell), not a single value. */
export function isBlock(text: string): boolean {
  return /[\t\n\r]/.test(text.replace(/[\r\n]+$/, ""));
}

/**
 * One cell to grosze. Polish first: a comma is the decimal point, spaces
 * group thousands ("1 234,56", "12,5"); a dot works as the decimal point
 * too. A lone separator before exactly three digits is a thousands group in
 * złoty ("1.234" = 1 234 zł - money has two decimals), while in thousands
 * three decimals are just whole złoty ("1,234" tys. = 1 234 zł). With both
 * separators the last one is the decimal point. "zł", "PLN" and "tys." are
 * ignored.
 *
 * Returns null for an empty cell ("", "-", "—": nothing that day, which the
 * save turns into a delete) and undefined for anything that isn't an
 * amount (text, a negative number, more than MAX_AMOUNT_ZL).
 */
export function parseAmount(input: string, unit: PasteUnit = "zl"): number | null | undefined {
  let s = input
    .trim()
    .toLowerCase()
    .replace(/(zł|zl|pln|tys\.?)/g, "")
    .replace(/[\s  ']/g, "");
  if (s === "" || s === "-" || s === "–" || s === "—") return null;
  // Thousands groups are 3 digits after the first: "01.10.2026" is a date,
  // not 1 102 026 zł.
  const groups = (parts: string[]) => /^\d{1,3}$/.test(parts[0]) && parts.slice(1).every((p) => /^\d{3}$/.test(p));
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    const decimal = lastComma > lastDot ? "," : ".";
    const grouping = decimal === "," ? "." : ",";
    const at = s.lastIndexOf(decimal);
    const intParts = s.slice(0, at).split(grouping);
    if (intParts.length > 1 && !groups(intParts)) return undefined;
    s = `${intParts.join("")}.${s.slice(at + 1)}`;
  } else if (lastComma !== -1 || lastDot !== -1) {
    const sep = lastComma !== -1 ? "," : ".";
    const parts = s.split(sep);
    if (parts.length > 2) {
      if (!groups(parts)) return undefined;
      s = parts.join("");
    } else {
      // "1.234" / "1,234" in złoty: a thousands group - money has two
      // decimals, and reading it as 1,23 zł would silently lose a thousand
      // (same rule as the shop CSV import, lib/shop/parse.ts parseDecimal).
      const grouped = unit === "zl" && parts[1].length === 3 && parts[0] !== "0";
      s = grouped ? parts.join("") : parts.join(".");
    }
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return undefined;
  const zl = Number(s) * (unit === "tys" ? 1000 : 1);
  if (!Number.isFinite(zl) || zl > MAX_AMOUNT_ZL) return undefined;
  return Math.round(zl * 100);
}

/** Grosze as the grid shows them: "12 500", "12 500,50"; "" for nothing. */
export function formatAmountInput(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return "";
  const zl = Math.floor(minor / 100);
  const gr = minor % 100;
  const whole = String(zl).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return gr === 0 ? whole : `${whole},${String(gr).padStart(2, "0")}`;
}

export interface PastedCell {
  row: number;
  col: number;
  /** Grosze; null = empty (clears the cell). */
  minor: number | null;
}

export interface PastePlan {
  cells: PastedCell[];
  /** Cells that weren't amounts (a header, a date, a typo) - left as they were. */
  invalid: number;
  /** Values that fell past the grid's last day or channel. */
  outside: number;
}

/**
 * Where a pasted block lands: from the cell it was pasted into, down the
 * days and right across the channels, like a spreadsheet.
 */
export function planPaste(
  block: string[][],
  anchorRow: number,
  anchorCol: number,
  rowCount: number,
  colCount: number,
  unit: PasteUnit
): PastePlan {
  const plan: PastePlan = { cells: [], invalid: 0, outside: 0 };
  block.forEach((cells, i) => {
    cells.forEach((text, j) => {
      const row = anchorRow + i;
      const col = anchorCol + j;
      if (row >= rowCount || col >= colCount) {
        if (text.trim() !== "") plan.outside += 1;
        return;
      }
      const minor = parseAmount(text, unit);
      if (minor === undefined) plan.invalid += 1;
      else plan.cells.push({ row, col, minor });
    });
  });
  return plan;
}

/** Grid key of a (day, channel) cell. */
export const cellKey = (date: string, channel: string) => `${date}|${channel}`;

export interface ManualChange {
  date: string;
  channel: string;
  /** Grosze; null = delete (the cell was cleared or set to zero). */
  minor: number | null;
}

/**
 * The edited grid (texts as typed, in złoty) against what is stored: only
 * the cells that change. Zero or empty means "nothing" and deletes the row.
 * Cells that don't parse are reported, never saved.
 */
export function diffManualCells(
  stored: Readonly<Record<string, number>>,
  texts: Readonly<Record<string, string>>
): { changes: ManualChange[]; invalid: string[] } {
  const changes: ManualChange[] = [];
  const invalid: string[] = [];
  for (const [key, text] of Object.entries(texts)) {
    const parsed = parseAmount(text, "zl");
    if (parsed === undefined) {
      invalid.push(key);
      continue;
    }
    const next = parsed === 0 ? null : parsed;
    const before = stored[key] ?? null;
    if (next === before) continue;
    const bar = key.indexOf("|");
    changes.push({ date: key.slice(0, bar), channel: key.slice(bar + 1), minor: next });
  }
  changes.sort((a, b) => a.date.localeCompare(b.date) || a.channel.localeCompare(b.channel));
  return { changes, invalid };
}
