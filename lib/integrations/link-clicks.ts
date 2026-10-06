import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Meta "clicks" across the panel are LINK clicks (insights field
 * `inline_link_clicks`, Ads Manager's "Kliknięcia linku"). Meta's own
 * `clicks` field - clicks (all): likes, comments, profile, "see more", link -
 * is kept next to it in `clicks_all` (migration 0034). Google clicks are ad
 * clicks, already link-like, so Google rows carry clicks_all = clicks.
 *
 * Until 0034 runs the column does not exist: PostgREST rejects any write or
 * select naming it, so every sync and read probes first and keeps the old
 * behaviour (all clicks in `clicks`) without it.
 */

type AdminClient = ReturnType<typeof createAdminClient>;

export type ClicksAllTable = "ads_daily" | "ads_adset_daily" | "creatives";

/** False until migration 0034 has added `clicks_all` to `table`. */
export async function hasClicksAllColumn(
  admin: AdminClient,
  table: ClicksAllTable
): Promise<boolean> {
  const { error } = await admin.from(table).select("clicks_all").limit(1);
  return !error;
}

/** Meta numeric strings -> integer counts; missing/garbage -> 0. */
export function intOrZero(v: string | null | undefined): number {
  if (v == null || v === "") return 0;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The click columns for one Meta row. With the column: link clicks in
 * `clicks`, all clicks in `clicks_all`, CTR/CPC as the link-click variants.
 * Without it: exactly what was written before 0034 (all clicks, "(all)"
 * CTR/CPC), so nothing changes until the owner runs the migration.
 */
export function metaClickColumns(
  insight: {
    clicks: string;
    link_clicks?: string;
    ctr?: string;
    cpc?: string;
    link_ctr?: string;
    link_cpc?: string;
  },
  withClicksAll: boolean
): {
  clicks: number;
  clicks_all?: number;
  ctr: number | null;
  cpc_minor_units: number | null;
} {
  const pct = (v?: string) => (v != null && v !== "" ? parseFloat(v) : null);
  const money = (v?: string) =>
    v != null && v !== "" ? Math.round(parseFloat(v) * 100) : null;

  if (!withClicksAll) {
    return {
      clicks: intOrZero(insight.clicks),
      ctr: pct(insight.ctr),
      cpc_minor_units: money(insight.cpc),
    };
  }
  return {
    // Meta omits inline_link_clicks on rows with none (e.g. pure video views).
    clicks: intOrZero(insight.link_clicks),
    clicks_all: intOrZero(insight.clicks),
    ctr: pct(insight.link_ctr),
    // No link clicks -> Meta sends no cost per link click; keep it null.
    cpc_minor_units: money(insight.link_cpc),
  };
}
