import { createAdminClient } from "@/lib/supabase/admin";

/** One stored campaign row, as the cron wrote it (shares are 0-1 fractions). */
export interface ImpressionShareInput {
  customerId: string;
  campaignId: string;
  campaignName: string;
  impressionShare: number | null;
  budgetLost: number | null;
  rankLost: number | null;
  impressions: number;
  clicks: number;
  costMinorUnits: number;
}

export interface ImpressionShareCampaign {
  key: string;
  name: string;
  impressions: number;
  clicks: number;
  costMinorUnits: number;
  /** shown + budgetLost + rankLost = 1 (normalized, see normalize()). */
  shown: number;
  budgetLost: number;
  rankLost: number;
  /** Google reported "<10%" visibility / ">90%" lost - shown as such. */
  shownBelow10: boolean;
  budgetAbove90: boolean;
  rankAbove90: boolean;
  /** Estimates for the 30-day period - never exact figures. */
  missedImpressionsBudget: number;
  missedClicksBudget: number;
  missedImpressionsRank: number;
}

export interface ImpressionShareSummary {
  periodEnd: string;
  /** Overall split of all eligible searches; sums to 1. */
  shown: number;
  budgetLost: number;
  rankLost: number;
  impressions: number;
  clicks: number;
  costMinorUnits: number;
  missedImpressionsBudget: number;
  missedClicksBudget: number;
  missedCostBudgetMinorUnits: number;
  missedImpressionsRank: number;
  /** Any input value was one of Google's capped "<10%" / ">90%" figures. */
  approximate: boolean;
  /** Sorted by impressions, biggest first. */
  campaigns: ImpressionShareCampaign[];
  /** Search campaigns Google returned no share for (too little data). */
  campaignsWithoutData: number;
}

// Google never reports exact values at the extremes: below 10% comes back as
// 0.0999 and above 90% as 0.9001. Compare with a tolerance because numeric
// round-trips through Postgres/JSON can add noise.
const isBelow10 = (v: number | null) => v != null && Math.abs(v - 0.0999) < 1e-6;
const isAbove90 = (v: number | null) => v != null && Math.abs(v - 0.9001) < 1e-6;

/**
 * Turn Google's three shares into a split that sums to exactly 1. By
 * definition shown + lost(budget) + lost(rank) = 100%, but capped values and
 * a missing lost share break that, and a bar that doesn't add up confuses
 * people more than a rounding nudge does. Returns null when the campaign
 * can't be placed honestly.
 */
function normalize(
  is: number | null,
  budget: number | null,
  rank: number | null
): { shown: number; budget: number; rank: number } | null {
  if (is == null || is <= 0) return null;
  let b = budget;
  let r = rank;
  // One lost share missing: the other one plus visibility pins it down.
  if (b == null && r != null) b = Math.max(0, 1 - is - r);
  if (r == null && b != null) r = Math.max(0, 1 - is - b);
  // Both missing: we'd be guessing why visibility was lost - skip it.
  if (b == null || r == null) return null;
  const sum = is + b + r;
  if (sum <= 0) return null;
  return { shown: is / sum, budget: b / sum, rank: r / sum };
}

/**
 * Pure aggregation, shared by the real page and the demo so both tell the
 * same story from the same math.
 *
 * Overall shares are weighted by ELIGIBLE impressions (impressions / IS),
 * which reduces to the impressions-weighted view Google itself uses: total
 * shown / total eligible. A plain average of percentages would let a tiny
 * campaign swing the headline.
 *
 * Missed clicks assume the campaign's current CTR on the missed impressions.
 * That is optimistic (extra exposure tends to be at worse hours / pricier
 * auctions), which is why the UI always labels it an estimate.
 */
export function summarizeImpressionShare(
  inputs: ImpressionShareInput[],
  periodEnd: string
): ImpressionShareSummary | null {
  const campaigns: ImpressionShareCampaign[] = [];
  let withoutData = 0;
  let approximate = false;
  let eligibleTotal = 0;
  let missedCost = 0;

  for (const row of inputs) {
    if (row.impressions <= 0) continue;
    const split = normalize(row.impressionShare, row.budgetLost, row.rankLost);
    if (!split) {
      withoutData += 1;
      continue;
    }
    const shownBelow10 = isBelow10(row.impressionShare);
    const budgetAbove90 = isAbove90(row.budgetLost);
    const rankAbove90 = isAbove90(row.rankLost);
    if (shownBelow10 || budgetAbove90 || rankAbove90) approximate = true;

    const eligible = row.impressions / split.shown;
    const ctr = row.clicks / row.impressions;
    const missedBudget = eligible * split.budget;
    const missedClicksBudget = missedBudget * ctr;
    const cpc = row.clicks > 0 ? row.costMinorUnits / row.clicks : 0;

    eligibleTotal += eligible;
    missedCost += missedClicksBudget * cpc;
    campaigns.push({
      key: `${row.customerId}:${row.campaignId}`,
      name: row.campaignName || row.campaignId,
      impressions: row.impressions,
      clicks: row.clicks,
      costMinorUnits: row.costMinorUnits,
      shown: split.shown,
      budgetLost: split.budget,
      rankLost: split.rank,
      shownBelow10,
      budgetAbove90,
      rankAbove90,
      missedImpressionsBudget: missedBudget,
      missedClicksBudget,
      missedImpressionsRank: eligible * split.rank,
    });
  }

  if (campaigns.length === 0 || eligibleTotal <= 0) return null;

  const sum = (f: (c: ImpressionShareCampaign) => number) =>
    campaigns.reduce((a, c) => a + f(c), 0);
  const impressions = sum((c) => c.impressions);
  const missedImpressionsBudget = sum((c) => c.missedImpressionsBudget);
  const missedImpressionsRank = sum((c) => c.missedImpressionsRank);

  return {
    periodEnd,
    shown: impressions / eligibleTotal,
    budgetLost: missedImpressionsBudget / eligibleTotal,
    rankLost: missedImpressionsRank / eligibleTotal,
    impressions,
    clicks: sum((c) => c.clicks),
    costMinorUnits: sum((c) => c.costMinorUnits),
    missedImpressionsBudget,
    missedClicksBudget: sum((c) => c.missedClicksBudget),
    missedCostBudgetMinorUnits: Math.round(missedCost),
    missedImpressionsRank,
    approximate,
    campaigns: campaigns.sort((a, b) => b.impressions - a.impressions),
    campaignsWithoutData: withoutData,
  };
}

/**
 * Split fractions into whole "out of 100" numbers that add up to exactly 100
 * (largest remainder), so "62 + 25 + 13" never reads as 99 or 101.
 */
export function toOutOf100(fractions: number[]): number[] {
  const raw = fractions.map((f) => Math.max(0, f) * 100);
  const floors = raw.map(Math.floor);
  let rest = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ i, rem: v - Math.floor(v) }))
    .sort((a, b) => b.rem - a.rem);
  for (const { i } of order) {
    if (rest <= 0) break;
    floors[i] += 1;
    rest -= 1;
  }
  return floors;
}

/**
 * Round an estimate so it doesn't look more precise than it is:
 * 1 873 -> 1 900, 87 -> 90, 7 -> 7.
 */
export function roughCount(n: number): number {
  if (n < 10) return Math.round(n);
  const magnitude = 10 ** Math.max(1, Math.floor(Math.log10(n)) - 1);
  return Math.round(n / magnitude) * magnitude;
}

/**
 * Latest impression-share snapshot for a client. Uses the admin client: the
 * caller has already resolved an authorized client id.
 *
 * Returns null on any error, including the table not existing yet (migration
 * 0027 not run), or when the latest snapshot has no usable Search campaigns -
 * this section is a nice-to-have and must never break the page.
 */
export async function getImpressionShare(
  clientId: string
): Promise<ImpressionShareSummary | null> {
  try {
    const admin = createAdminClient();
    const latest = await admin
      .from("google_impression_share")
      .select("period_end")
      .eq("client_id", clientId)
      .order("period_end", { ascending: false })
      .limit(1);
    if (latest.error || !latest.data?.length) return null;
    const periodEnd = latest.data[0].period_end as string;

    // One row per Search campaign - well under the PostgREST page cap.
    const { data, error } = await admin
      .from("google_impression_share")
      .select(
        "customer_id, campaign_id, campaign_name, impression_share, budget_lost, rank_lost, impressions, clicks, cost_minor_units"
      )
      .eq("client_id", clientId)
      .eq("period_end", periodEnd)
      // Skip the "no Search campaigns today" marker row.
      .neq("campaign_id", "");
    if (error) return null;

    const num = (v: unknown) => (v == null ? null : Number(v));
    const inputs: ImpressionShareInput[] = (data ?? []).map(
      (r: Record<string, unknown>) => ({
        customerId: String(r.customer_id ?? ""),
        campaignId: String(r.campaign_id ?? ""),
        campaignName: String(r.campaign_name ?? ""),
        impressionShare: num(r.impression_share),
        budgetLost: num(r.budget_lost),
        rankLost: num(r.rank_lost),
        impressions: Number(r.impressions ?? 0),
        clicks: Number(r.clicks ?? 0),
        costMinorUnits: Number(r.cost_minor_units ?? 0),
      })
    );
    return summarizeImpressionShare(inputs, periodEnd);
  } catch (err) {
    console.error("[impression-share] read failed", (err as Error)?.message ?? err);
    return null;
  }
}
