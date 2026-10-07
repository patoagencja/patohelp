"use server";

import { getSyncStampForSlug } from "@/lib/dashboard/context";

/**
 * Cheap "has anything new landed?" probe for the live indicator: one indexed
 * row instead of re-rendering the whole dashboard on a timer. RLS scopes the
 * client lookup, so a slug the user can't see just returns null.
 */
export async function getSyncStamp(clientSlug: string): Promise<string | null> {
  // Callable as a raw POST with any payload; TS types don't hold at runtime.
  if (typeof clientSlug !== "string" || clientSlug.length > 64) return null;
  return getSyncStampForSlug(clientSlug);
}
