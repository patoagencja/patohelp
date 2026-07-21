// Client-safe date-range constants (no server-only imports), so both the
// server data layer and the client picker can share them.

export const RANGE_KEYS = ["7d", "30d", "90d", "month", "prev_month"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

export const RANGE_LABELS: Record<RangeKey, string> = {
  "7d": "Ostatnie 7 dni",
  "30d": "Ostatnie 30 dni",
  "90d": "Ostatnie 90 dni",
  month: "Bieżący miesiąc",
  prev_month: "Poprzedni miesiąc",
};

/** Coerce an untrusted query-string value to a valid range key (default 30d). */
export function normalizeRange(value?: string | null): RangeKey {
  return RANGE_KEYS.includes(value as RangeKey) ? (value as RangeKey) : "30d";
}

export interface CustomRange {
  start: string; // yyyy-MM-dd
  end: string; // yyyy-MM-dd
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a custom from/to pair from the query string. Returns null unless both
 * are real yyyy-MM-dd dates with from <= to (so callers fall back to a preset).
 */
export function parseCustomRange(
  from?: string | null,
  to?: string | null
): CustomRange | null {
  if (!from || !to || !ISO_DATE.test(from) || !ISO_DATE.test(to)) return null;
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return null;
  if (from > to) return null;
  return { start: from, end: to };
}
