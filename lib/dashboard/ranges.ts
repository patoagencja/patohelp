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
