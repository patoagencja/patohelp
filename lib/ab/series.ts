import { z } from "zod";

import type { AbSeriesRequest } from "./types";

// The compare chart's request, shared by the live server action
// (lib/ab/compare-actions.ts) and the demo's (lib/demo/ab-actions.ts):
// server actions are plain POST endpoints, so their input is untrusted.

/** Longest period the chart may ask for (a season is ~85 days). */
const MAX_DAYS = 400;
export const MAX_SERIES_ADS = 4;

const IsoDay = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);

const SeriesRequest = z
  .object({
    adIds: z.array(z.string().min(1).max(64)).min(1).max(MAX_SERIES_ADS),
    start: IsoDay,
    end: IsoDay,
  })
  .strict()
  .refine(
    (r) =>
      r.start <= r.end &&
      (Date.parse(`${r.end}T00:00:00Z`) - Date.parse(`${r.start}T00:00:00Z`)) / 86_400_000 < MAX_DAYS,
    { message: "Nieprawidłowy okres" }
  );

/** The request with duplicate ids dropped, or null when it is malformed. */
export function parseSeriesRequest(raw: unknown): AbSeriesRequest | null {
  const parsed = SeriesRequest.safeParse(raw);
  if (!parsed.success) return null;
  return { ...parsed.data, adIds: Array.from(new Set(parsed.data.adIds)) };
}
