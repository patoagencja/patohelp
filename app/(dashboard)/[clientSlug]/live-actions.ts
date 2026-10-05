"use server";

import { getClientBySlug, getLastSyncAt } from "@/lib/dashboard/context";

/**
 * Cheap "has anything new landed?" probe for the live indicator: one indexed
 * row instead of re-rendering the whole dashboard on a timer. RLS scopes the
 * client lookup, so a slug the user can't see just returns null.
 */
export async function getSyncStamp(clientSlug: string): Promise<string | null> {
  const client = await getClientBySlug(clientSlug);
  if (!client) return null;
  return getLastSyncAt(client.id);
}
