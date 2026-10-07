import assert from "node:assert/strict";
import { test } from "node:test";

import { mergeRows, selectedGa4Properties } from "./ga4-merge.ts";

test("several picked properties win while they include the single property", () => {
  assert.deepEqual(selectedGa4Properties({ propertyId: "1", propertyIds: ["1", "2", "2"] }), ["1", "2"]);
  assert.deepEqual(selectedGa4Properties({ propertyId: "1" }), ["1"]);
  assert.deepEqual(selectedGa4Properties({ propertyId: null, propertyIds: [] }), []);
});

test("a single property set later (service account) beats a stale list", () => {
  assert.deepEqual(selectedGa4Properties({ propertyId: "9", propertyIds: ["1", "2"] }), ["9"]);
});

test("rows of several properties add up, rates are weighted by sessions", () => {
  const merged = mergeRows(
    [
      { date: "2026-10-01", sessions: 100, engagementRate: 0.5, revenue: 10 },
      { date: "2026-10-01", sessions: 300, engagementRate: 0.7, revenue: 5 },
      { date: "2026-10-02", sessions: 0, engagementRate: 0, revenue: 0 },
    ],
    (r) => r.date,
    { sums: ["sessions", "revenue"], rates: ["engagementRate"], weight: "sessions" }
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0].sessions, 400);
  assert.equal(merged[0].revenue, 15);
  assert.ok(Math.abs(merged[0].engagementRate - 0.65) < 1e-9);
  assert.equal(merged[1].engagementRate, 0);
});
