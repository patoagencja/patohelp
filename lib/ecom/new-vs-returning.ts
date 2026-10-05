import { addDays, getDailySpend } from "@/lib/ecom/insights";
import { createAdminClient } from "@/lib/supabase/admin";

// "Nowi czy stali klienci": how much of the shop's revenue comes from new vs
// returning buyers, plus a rough cost of winning one new buyer. Reads the
// daily GA4 snapshot (ga4_new_vs_returning, migration 0028) and ads_daily -
// never the GA4 API. Callers must have verified the user can see `clientId`;
// reads here use the admin client. Money is grosze throughout.

export interface NvrSegment {
  revenueMinorUnits: number;
  transactions: number;
  users: number;
  sessions: number;
  /** Share of new+returning revenue, 0-1. */
  revenueShare: number;
  /** Share of new+returning orders, 0-1. */
  transactionShare: number;
  /** Average order value; null without orders. */
  aovMinorUnits: number | null;
}

export interface NewVsReturning {
  /** Day the snapshot was taken; it covers the 30 full days before it. */
  snapshotDate: string;
  windowStart: string;
  windowEnd: string;
  newBuyers: NvrSegment;
  returning: NvrSegment;
  /** Revenue GA4 couldn't classify, as a share of ALL revenue (0-1). */
  notSetRevenueShare: number;
  /** All ad spend (every platform) in the same window. */
  spendMinorUnits: number;
  /**
   * Estimate: all ad spend / orders from new buyers. Ads also bring back
   * returning customers, so this overstates the true cost - shown as "ok.".
   * null when there was no spend or no new-buyer orders.
   */
  costPerNewOrderMinorUnits: number | null;
}

export interface NvrRawSegment {
  revenueMinorUnits: number;
  transactions: number;
  users: number;
  sessions: number;
}

const EMPTY: NvrRawSegment = { revenueMinorUnits: 0, transactions: 0, users: 0, sessions: 0 };

/**
 * Pure maths shared by the live read and the demo. Returns null when neither
 * segment has an order - nothing meaningful to split.
 */
export function buildNewVsReturning(
  snapshotDate: string,
  segments: Partial<Record<"new" | "returning" | "(not set)", NvrRawSegment>>,
  spendMinorUnits: number
): NewVsReturning | null {
  const n = segments.new ?? EMPTY;
  const r = segments.returning ?? EMPTY;
  const notSet = segments["(not set)"] ?? EMPTY;

  const knownTx = n.transactions + r.transactions;
  if (knownTx <= 0) return null;
  const knownRevenue = n.revenueMinorUnits + r.revenueMinorUnits;
  const allRevenue = knownRevenue + notSet.revenueMinorUnits;

  const seg = (s: NvrRawSegment): NvrSegment => ({
    ...s,
    revenueShare: knownRevenue > 0 ? s.revenueMinorUnits / knownRevenue : 0,
    transactionShare: s.transactions / knownTx,
    aovMinorUnits: s.transactions > 0 ? Math.round(s.revenueMinorUnits / s.transactions) : null,
  });

  return {
    snapshotDate,
    windowStart: addDays(snapshotDate, -30),
    windowEnd: addDays(snapshotDate, -1),
    newBuyers: seg(n),
    returning: seg(r),
    notSetRevenueShare: allRevenue > 0 ? notSet.revenueMinorUnits / allRevenue : 0,
    spendMinorUnits,
    costPerNewOrderMinorUnits:
      spendMinorUnits > 0 && n.transactions > 0
        ? Math.round(spendMinorUnits / n.transactions)
        : null,
  };
}

/**
 * Latest snapshot for a client. Returns null on any error, including the
 * table not existing yet (migration 0028 not run) - this card is a
 * nice-to-have and must never break the page.
 */
export async function getNewVsReturning(clientId: string): Promise<NewVsReturning | null> {
  try {
    const admin = createAdminClient();
    const latest = await admin
      .from("ga4_new_vs_returning")
      .select("snapshot_date")
      .eq("client_id", clientId)
      .order("snapshot_date", { ascending: false })
      .limit(1);
    if (latest.error || !latest.data?.length) return null;
    const snapshotDate = latest.data[0].snapshot_date as string;

    const { data, error } = await admin
      .from("ga4_new_vs_returning")
      .select("segment, revenue_minor_units, transactions, users, sessions")
      .eq("client_id", clientId)
      .eq("snapshot_date", snapshotDate);
    if (error || !data) return null;

    const segments: Partial<Record<"new" | "returning" | "(not set)", NvrRawSegment>> = {};
    for (const row of data as Array<Record<string, unknown>>) {
      const key = row.segment as "new" | "returning" | "(not set)";
      if (key !== "new" && key !== "returning" && key !== "(not set)") continue;
      segments[key] = {
        revenueMinorUnits: Number(row.revenue_minor_units ?? 0),
        transactions: Number(row.transactions ?? 0),
        users: Number(row.users ?? 0),
        sessions: Number(row.sessions ?? 0),
      };
    }

    // Same window as the GA4 report (30daysAgo..yesterday, seen from the
    // snapshot day) so spend and orders line up.
    const windowStart = addDays(snapshotDate, -30);
    const windowEnd = addDays(snapshotDate, -1);
    const spend = await getDailySpend(clientId, windowStart, windowEnd);
    let spendMinorUnits = 0;
    for (const v of spend.values()) spendMinorUnits += v.total;

    return buildNewVsReturning(snapshotDate, segments, spendMinorUnits);
  } catch (err) {
    console.error("[new-vs-returning] read failed", (err as Error)?.message ?? err);
    return null;
  }
}
