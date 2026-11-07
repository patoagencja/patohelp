/**
 * Google purchase-only re-pulls (refresh-ads-google) and REMOVED campaigns.
 *
 * Rows written before purchase-only values existed are "flagged" and pulled
 * again by every account. The metrics query leaves REMOVED campaigns out, so
 * their old rows are not rewritten; their purchase-only numbers come only
 * from the purchase query of that re-pull. They must be written to those rows
 * in the same step, before the account counts as having re-pulled the day:
 * once every account has, the day is closed and whatever rows are still
 * unlabelled get 0 purchases - which must only ever be campaigns that truly
 * had none. (Kept in memory to the end of the run instead, a later run or a
 * killed function closed the day with 0 for campaigns that had sales.)
 *
 * Keep runtime imports out of this file: its unit tests run it directly under
 * Node's type stripping, which can't resolve the "@/" alias.
 */

export interface PurchaseNumbers {
  campaign_id: string;
  date: string;
  purchases: number;
  /** Account currency, major units. */
  value: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Per flagged day, campaign id -> raw_data keys to merge into the rows of
 * campaigns the metrics query left out. `written` holds "campaign|date" of
 * the rows just written with metrics (they carry their own numbers);
 * `rateOf(date)` converts the account currency to PLN (null = no rate).
 * Days with a left-out campaign that can't be converted are `unpatchable`:
 * the account must not count them as re-pulled.
 */
export function removedPurchasePatches(
  purchases: Iterable<PurchaseNumbers>,
  written: ReadonlySet<string>,
  flagged: ReadonlySet<string>,
  rateOf: (date: string) => number | null
): { byDay: Map<string, Map<string, Record<string, unknown>>>; unpatchable: Set<string> } {
  const byDay = new Map<string, Map<string, Record<string, unknown>>>();
  const unpatchable = new Set<string>();
  for (const p of purchases) {
    if (!flagged.has(p.date) || written.has(`${p.campaign_id}|${p.date}`)) continue;
    const rate = rateOf(p.date);
    if (rate == null || !Number.isFinite(rate)) {
      unpatchable.add(p.date);
      continue;
    }
    let day = byDay.get(p.date);
    if (!day) {
      day = new Map();
      byDay.set(p.date, day);
    }
    day.set(p.campaign_id, {
      purchases: p.purchases,
      purchase_value: round2(p.value * rate),
      purchase_source: "purchase",
    });
  }
  return { byDay, unpatchable };
}

/**
 * The days of a fetched range that count as re-pulled with purchase-only
 * values: the purchase query answered, the day was written (no missing
 * rate) and every left-out campaign's row on it was patched.
 */
export function purchaseCreditedDays(
  rangeDays: readonly string[],
  opts: { purchasesAnswered: boolean; skipped: ReadonlySet<string>; unpatched: ReadonlySet<string> }
): string[] {
  if (!opts.purchasesAnswered) return [];
  return rangeDays.filter((d) => !opts.skipped.has(d) && !opts.unpatched.has(d));
}
