import { clsx, type ClassValue } from "clsx";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { pl } from "date-fns/locale";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind class names, resolving conflicts (shadcn convention). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const WARSAW_TZ = "Europe/Warsaw";

const PLN_FORMATTER = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "PLN",
});

/**
 * Format a money amount stored as bigint minor units (grosze) into a PLN
 * string. All money in the DB is minor units — divide by 100 for display only.
 */
export function formatMoneyPLN(minorUnits: number | bigint): string {
  const major = Number(minorUnits) / 100;
  return PLN_FORMATTER.format(major);
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
 * corresponding UTC Date — the inverse of formatDateWarsaw, for writing to DB.
 */
export function parseWarsawToUTC(date: Date | string): Date {
  return fromZonedTime(date, WARSAW_TZ);
}
