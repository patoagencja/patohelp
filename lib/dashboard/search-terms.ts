import { fetchAll } from "@/lib/supabase/fetch-all";
import { createAdminClient } from "@/lib/supabase/admin";

export interface SearchTermRow {
  term: string;
  impressions: number;
  clicks: number;
  costMinorUnits: number;
  conversions: number;
}

/**
 * Latest search-terms snapshot for a client, one row per phrase (summed
 * across Google Ads accounts and campaigns - the client cares what people
 * typed, not which of our campaigns caught it). Uses the admin client: the
 * caller has already resolved an authorized client id.
 *
 * Returns [] on any error, including the table not existing yet (migration
 * 0023 not run) - this section is a nice-to-have and must never break the
 * page.
 */
export async function getSearchTerms(clientId: string): Promise<SearchTermRow[]> {
  try {
    const admin = createAdminClient();
    const latest = await admin
      .from("google_search_terms")
      .select("period_end")
      .eq("client_id", clientId)
      .order("period_end", { ascending: false })
      .limit(1);
    if (latest.error || !latest.data?.length) return [];
    const periodEnd = latest.data[0].period_end as string;

    // Up to 500 rows per account x several accounts - can exceed the
    // PostgREST page cap.
    const rows = await fetchAll<Record<string, unknown>>((from, to) =>
      admin
        .from("google_search_terms")
        .select("id, search_term, impressions, clicks, cost_minor_units, conversions")
        .eq("client_id", clientId)
        .eq("period_end", periodEnd)
        // Skip the "nothing found today" marker row.
        .neq("search_term", "")
        .order("id", { ascending: true })
        .range(from, to)
    );

    const byTerm = new Map<string, SearchTermRow>();
    for (const r of rows) {
      // Google already lowercases terms, but accounts can differ in spacing.
      const term = String(r.search_term ?? "").trim().replace(/\s+/g, " ").toLowerCase();
      if (!term) continue;
      const cur =
        byTerm.get(term) ??
        ({ term, impressions: 0, clicks: 0, costMinorUnits: 0, conversions: 0 } satisfies SearchTermRow);
      cur.impressions += Number(r.impressions ?? 0);
      cur.clicks += Number(r.clicks ?? 0);
      cur.costMinorUnits += Number(r.cost_minor_units ?? 0);
      cur.conversions += Number(r.conversions ?? 0);
      byTerm.set(term, cur);
    }

    return Array.from(byTerm.values()).sort(
      (a, b) => b.clicks - a.clicks || b.impressions - a.impressions
    );
  } catch (err) {
    console.error("[search-terms] read failed", (err as Error)?.message ?? err);
    return [];
  }
}
