import type { SupabaseClient } from "@supabase/supabase-js";

import { parseSeason, type SeasonConfig } from "@/lib/season/config";

/**
 * Who gets ad-level daily data (ads_ad_daily) and creative test alerts:
 * shops (client_type 'ecommerce'). Pulling every ad x day costs many Meta
 * calls; an engagement client with a huge media account has no purchases to
 * test on and must not pay for it.
 */
export interface AbClient {
  id: string;
  season: SeasonConfig | null;
  ecommerce: boolean;
}

// season arrives with 0037, client_type with 0016: either may be missing on
// an older database, so fall back to narrower selects instead of failing.
const SELECTS = ["id, client_type, season", "id, client_type", "id, season"] as const;

/** Every client among `ids` (all clients when omitted), unfiltered. */
async function loadClients(admin: SupabaseClient, ids?: string[]): Promise<AbClient[]> {
  if (ids && ids.length === 0) return [];
  for (const columns of SELECTS) {
    let q = admin.from("clients").select(columns);
    if (ids) q = q.in("id", ids);
    const { data, error } = await q;
    if (error) continue;
    // The select list is dynamic, so the typed parser can't infer the row.
    return ((data ?? []) as unknown as Array<{ id: string; client_type?: string | null; season?: unknown }>).map(
      (r) => ({
        id: String(r.id),
        season: parseSeason(r.season),
        ecommerce: r.client_type === "ecommerce",
      })
    );
  }
  return [];
}

/** The eligible clients among `ids` (all clients when omitted). */
export async function listAbClients(admin: SupabaseClient, ids?: string[]): Promise<AbClient[]> {
  // Shops only: tests are judged on purchases and sales value, and an
  // engagement client must never see ROAS (CLAUDE.md) - not even when it
  // also runs in seasons.
  return (await loadClients(admin, ids)).filter((c) => c.ecommerce);
}

/** This client if eligible, else null. */
export async function getAbClient(admin: SupabaseClient, clientId: string): Promise<AbClient | null> {
  const [client] = await listAbClients(admin, [clientId]);
  return client ?? null;
}

/**
 * Seasonal clients (clients.season set) and shops among `ids`: the clients
 * whose campaign rows must carry mature purchase values (the season page
 * compares this season's sales from ads with the last one's), so the
 * campaign syncs spend extra calls on them - later-attributed purchases,
 * purchase values, deeper paging. Engagement clients never pay for that.
 * A failed read means "none": the old, cheaper behaviour.
 */
export async function seasonalOrShopIds(admin: SupabaseClient, ids?: string[]): Promise<Set<string>> {
  const clients = await loadClients(admin, ids);
  return new Set(clients.filter((c) => c.ecommerce || c.season !== null).map((c) => c.id));
}

export async function isSeasonalOrShop(admin: SupabaseClient, clientId: string): Promise<boolean> {
  return (await seasonalOrShopIds(admin, [clientId])).has(clientId);
}
