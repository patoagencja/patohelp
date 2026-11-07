import { test } from "node:test";
import assert from "node:assert/strict";

import { bootstrapProgress, closableDays, markRedone } from "./history-progress.ts";
import { purchaseCreditedDays, removedPurchasePatches, type PurchaseNumbers } from "./removed-purchases.ts";

const D = "2026-03-10";
const E = "2026-03-11";
const p = (campaign_id: string, date: string, purchases: number, value: number): PurchaseNumbers => ({
  campaign_id,
  date,
  purchases,
  value,
});

test("only campaigns the metrics query left out, on flagged days, are patched - converted to PLN", () => {
  const { byDay, unpatchable } = removedPurchasePatches(
    [p("live", D, 1, 10), p("removed", D, 2, 33.335), p("removed", "2026-03-20", 1, 5)],
    new Set([`live|${D}`]),
    new Set([D]),
    () => 4.2
  );
  assert.deepEqual([...byDay.keys()], [D]);
  assert.deepEqual(Object.fromEntries(byDay.get(D)!), {
    removed: { purchases: 2, purchase_value: 140.01, purchase_source: "purchase" },
  });
  assert.equal(unpatchable.size, 0);
});

test("a day whose removed campaign can't be converted is not counted as re-pulled", () => {
  const { byDay, unpatchable } = removedPurchasePatches(
    [p("removed", D, 1, 10), p("removed", E, 1, 10)],
    new Set(),
    new Set([D, E]),
    (d) => (d === D ? null : 1)
  );
  assert.deepEqual([...unpatchable], [D]);
  assert.deepEqual([...byDay.keys()], [E]);
  assert.deepEqual(
    purchaseCreditedDays([D, E], { purchasesAnswered: true, skipped: new Set(), unpatched: unpatchable }),
    [E]
  );
  // No purchase answer, or a day skipped for its rate: nothing counts.
  assert.deepEqual(purchaseCreditedDays([D, E], { purchasesAnswered: false, skipped: new Set(), unpatched: new Set() }), []);
  assert.deepEqual(purchaseCreditedDays([D, E], { purchasesAnswered: true, skipped: new Set([E]), unpatched: new Set() }), [D]);
});

/**
 * Two accounts re-pull flagged day D in different runs; A's removed campaign
 * had sales on D. Rows live in `db` (campaign -> raw_data); a patch writes
 * them, the close gives every still unlabelled row 0.
 */
test("a removed campaign's sales survive a day closed in a later run, even after a failed patch", () => {
  const db = new Map<string, Record<string, unknown>>([
    ["A-removed", { purchase_value: 999 }], // all conversions, pre-label
    ["A-quiet-removed", { purchase_value: 7 }],
    ["B-live", { purchase_value: 50 }],
  ]);
  const flagged = new Set([D]);
  const view = bootstrapProgress({ start: "2026-11-07", accounts: ["A", "B"], present: [D], recheckFrom: "2026-11-07" });
  const close = () => {
    for (const day of closableDays(view, "purchase", flagged, ["A", "B"])) {
      assert.equal(day, D);
      for (const [id, raw] of db) {
        if (raw.purchase_source === undefined) db.set(id, { ...raw, purchases: 0, purchase_value: 0, purchase_source: "purchase" });
      }
    }
  };
  /** One account's re-pull of D (syncRange): write, patch, then count it. */
  const repull = (account: "A" | "B", patchWorks: boolean) => {
    const purchases = account === "A" ? [p("A-removed", D, 3, 120)] : [p("B-live", D, 1, 60)];
    const written = account === "B" ? new Set([`B-live|${D}`]) : new Set<string>();
    if (account === "B") db.set("B-live", { purchases: 1, purchase_value: 60, purchase_source: "purchase" });
    const { byDay, unpatchable } = removedPurchasePatches(purchases, written, flagged, () => 1);
    const unpatched = new Set(unpatchable);
    for (const [day, byCampaign] of byDay) {
      if (!patchWorks) {
        unpatched.add(day);
        continue;
      }
      for (const [id, extra] of byCampaign) db.set(id, { ...db.get(id), ...extra });
    }
    const credited = purchaseCreditedDays([D], { purchasesAnswered: true, skipped: new Set(), unpatched });
    markRedone(view, "purchase", account, credited, flagged);
  };

  // Run 1: A re-pulls D but its patch fails (or the function dies): A is not counted.
  repull("A", false);
  // Run 2: B re-pulls D. Not every account has it: no close, no 0 for A's sales.
  repull("B", true);
  close();
  assert.equal(db.get("A-removed")?.purchase_value, 999);
  // Run 3: A re-pulls again, the patch goes through; now the day closes.
  repull("A", true);
  close();
  assert.deepEqual(db.get("A-removed"), { purchase_value: 120, purchases: 3, purchase_source: "purchase" });
  // Only the campaign that truly had no sales got 0.
  assert.deepEqual(db.get("A-quiet-removed"), { purchase_value: 0, purchases: 0, purchase_source: "purchase" });
  assert.equal(db.get("B-live")?.purchase_value, 60);
});
