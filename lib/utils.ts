import { clsx, type ClassValue } from "clsx";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { pl } from "date-fns/locale";
import { extendTailwindMerge } from "tailwind-merge";

// bg-stripes / bg-dots are pattern overlays from globals.css, not colours.
// Stock tailwind-merge reads any bg-* as a background colour and silently
// dropped either the pattern or the fill when both went through cn().
const twMerge = extendTailwindMerge<"bg-pattern">({
  extend: { classGroups: { "bg-pattern": ["bg-stripes", "bg-dots"] } },
});

/** Merge Tailwind class names, resolving conflicts (shadcn convention). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const WARSAW_TZ = "Europe/Warsaw";

// pl-PL leaves 4-digit numbers ungrouped ("9868" next to "43 443"), which
// reads as inconsistent on one screen; group every thousand, with a
// non-breaking space so amounts never wrap mid-number.
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
}

/**
 * Format a money amount stored as bigint minor units (grosze) into a PLN
 * string. All money in the DB is minor units - divide by 100 for display only.
 */
export function formatMoneyPLN(minorUnits: number | bigint): string {
  const minor = Math.round(Number(minorUnits));
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const zl = Math.floor(abs / 100);
  const gr = String(abs % 100).padStart(2, "0");
  return `${sign}${groupThousands(String(zl))},${gr}\u00a0zł`;
}

/** Whole-złoty PLN for headline figures (grosze in, "272 800 zł" out). */
export function formatPlnWhole(minorUnits: number): string {
  return `${formatNumberPL(minorUnits / 100)}\u00a0zł`;
}

/** Ratio like ROAS/POAS with a Polish decimal comma: 4.256 -> "4,26×". */
export function formatMultiple(value: number, digits = 2): string {
  return `${value.toLocaleString("pl-PL", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}×`;
}

/** Signed change in percent from a 0-based ratio: 0.123 -> "+12%". */
export function formatSignedPct(ratio: number): string {
  const v = Math.round(ratio * 100);
  return `${v > 0 ? "+" : ""}${v}%`;
}

/** Format an integer-ish number with Polish grouping (e.g. 1 234, 12 345). */
export function formatNumberPL(value: number): string {
  const r = Math.round(value);
  return `${r < 0 ? "-" : ""}${groupThousands(String(Math.abs(r)))}`;
}

/** Format a percentage value (already in percent units), e.g. 2.4 -> "2,40%". */
export function formatPercent(value: number, fractionDigits = 2): string {
  return `${value.toLocaleString("pl-PL", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}%`;
}

/**
 * Format a UTC date/timestamp into an Europe/Warsaw string. Timestamps are
 * always UTC in the DB; formatting to Warsaw happens only in the UI.
 */
export function formatDateWarsaw(
  date: Date | string | number,
  fmt = "d MMM yyyy"
): string {
  return formatInTimeZone(date, WARSAW_TZ, fmt, { locale: pl });
}

/**
 * Interpret a wall-clock date/time as Europe/Warsaw local time and return the
 * corresponding UTC Date - the inverse of formatDateWarsaw, for writing to DB.
 */
export function parseWarsawToUTC(date: Date | string): Date {
  return fromZonedTime(date, WARSAW_TZ);
}
