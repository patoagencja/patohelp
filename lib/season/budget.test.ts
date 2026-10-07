import assert from "node:assert/strict";
import { test } from "node:test";

import { computeSeasonBudget, spendCurve } from "./budget.ts";

const dates = (n: number, start = "2026-10-01") =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });

test("no history spreads the budget evenly", () => {
  const c = spendCurve([], 4);
  assert.equal(c.source, "even");
  assert.deepEqual(c.weights, [0.25, 0.25, 0.25, 0.25]);
});

test("the curve follows last season and never plans a day at zero", () => {
  const c = spendCurve([0, 0, 0, 100, 100, 0, 0, 0], 8);
  assert.equal(c.source, "prev");
  assert.ok(Math.abs(c.weights.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(c.weights[3] > c.weights[0]);
  assert.ok(c.weights[0] > 0);
});

test("plan, pace and what is left for today", () => {
  const d = dates(10);
  const b = computeSeasonBudget({
    total: 10_000,
    dates: d,
    todayIdx: 5,
    asOfIdx: 4,
    spend: [1000, 1000, 1000, 1000, 1000, null, null, null, null, null],
    todaySpend: 200,
    prevSpend: [],
    prevUnmappedSpend: 0,
    markets: [],
  });
  assert.equal(b.planToDate, 5000);
  assert.equal(b.spentToDate, 5000);
  assert.equal(b.pace, 1);
  assert.equal(b.remaining, 5000);
  assert.equal(b.todayPlan, 1000);
  assert.equal(b.projected, 10_000);
  assert.equal(b.next.length, 5);
  assert.equal(b.cumulative[4].actual, 5000);
  assert.equal(b.cumulative[5].actual, null);
});

test("markets split by last season's spend, campaigns without a market keep their part", () => {
  const d = dates(4);
  const b = computeSeasonBudget({
    total: 1000,
    dates: d,
    todayIdx: 0,
    asOfIdx: -1,
    spend: [null, null, null, null],
    todaySpend: 0,
    prevSpend: [100, 100, 100, 100],
    prevUnmappedSpend: 100,
    markets: [
      { code: "PL", spend: [null, null, null, null], prevSpend: [75, 75, 75, 75] },
      { code: "DE", spend: [null, null, null, null], prevSpend: [25, 25, 25, 0] },
    ],
  });
  const pl = b.markets.find((m) => m.code === "PL")!;
  const de = b.markets.find((m) => m.code === "DE")!;
  assert.ok(pl.budget > de.budget);
  assert.equal(pl.budget + de.budget + b.unmappedBudget, 1000);
});
