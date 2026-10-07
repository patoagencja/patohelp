"use server";

import { parseSeriesRequest } from "@/lib/ab/series";
import type { AbSeries } from "@/lib/ab/types";
import { getDemoAbSeries } from "@/lib/demo/ab";

const ISO_DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * The demo's stand-in for loadAbSeries (lib/ab/compare-actions.ts), with the
 * same shape: the page binds its pinned day ("" = today) the way the client
 * page binds its slug. Generated data only - nothing is read.
 */
export async function loadDemoAbSeries(day: unknown, raw: unknown): Promise<AbSeries[]> {
  const req = parseSeriesRequest(raw);
  if (!req) return [];
  const pinned = typeof day === "string" && ISO_DAY.test(day) ? day : undefined;
  return getDemoAbSeries(req, pinned);
}
