import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cellKey,
  diffManualCells,
  formatAmountInput,
  isBlock,
  parseAmount,
  planPaste,
  splitPastedBlock,
} from "./paste.ts";

test("Polish amounts: decimal comma, space groups, units ignored", () => {
  assert.equal(parseAmount("1 234,56"), 123_456);
  assert.equal(parseAmount("1 234,5 zł"), 123_450);
  assert.equal(parseAmount("12,5"), 1_250);
  assert.equal(parseAmount("850"), 85_000);
  assert.equal(parseAmount("850 PLN"), 85_000);
  assert.equal(parseAmount("1.234,56"), 123_456);
  assert.equal(parseAmount("1,234.56"), 123_456);
  assert.equal(parseAmount("12.50"), 1_250);
});

test("a lone separator before three digits is a thousands group in złoty, decimals in thousands", () => {
  assert.equal(parseAmount("1.234", "zl"), 123_400);
  assert.equal(parseAmount("1,234", "zl"), 123_400);
  assert.equal(parseAmount("0,125", "zl"), 13, "0,125 zł is a fraction, not 125 zł");
  assert.equal(parseAmount("1,234", "tys"), 123_400);
  assert.equal(parseAmount("12,5", "tys"), 1_250_000);
  assert.equal(parseAmount("0,8 tys.", "tys"), 80_000);
  assert.equal(parseAmount("3", "tys"), 300_000);
});

test("empty means nothing; text, negatives and absurd amounts are rejected", () => {
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("  "), null);
  assert.equal(parseAmount("-"), null);
  assert.equal(parseAmount("—"), null);
  assert.equal(parseAmount("ALL PIN"), undefined);
  assert.equal(parseAmount("-120"), undefined);
  assert.equal(parseAmount("01.10.2026"), undefined);
  assert.equal(parseAmount("20000000"), undefined);
  assert.equal(parseAmount("20 000", "tys"), undefined);
});

test("a block from Sheets/Excel: tabs and line breaks, trailing break dropped, quotes stripped", () => {
  assert.deepEqual(splitPastedBlock("1,5\t2\r\n3\t\"4,25\"\r\n"), [
    ["1,5", "2"],
    ["3", "4,25"],
  ]);
  assert.deepEqual(splitPastedBlock("7"), [["7"]]);
  assert.equal(isBlock("7\n"), false, "Excel's trailing line break alone is still one value");
  assert.equal(isBlock("7\t8"), true);
  assert.equal(isBlock("7\n8"), true);
});

test("a pasted block fills down and right from its cell; overflow and junk are counted", () => {
  const block = splitPastedBlock("1,2\t0,3\tx\n2\t\t1\n3\t4\t5\n");
  const plan = planPaste(block, 1, 1, 3, 3, "tys");
  assert.deepEqual(plan.cells, [
    { row: 1, col: 1, minor: 120_000 },
    { row: 1, col: 2, minor: 30_000 },
    { row: 2, col: 1, minor: 200_000 },
    { row: 2, col: 2, minor: null },
  ]);
  assert.equal(plan.invalid, 0, "the junk cell fell outside the grid");
  assert.equal(plan.outside, 5);
  const inside = planPaste(splitPastedBlock("x\t5"), 0, 0, 1, 2, "zl");
  assert.equal(inside.invalid, 1);
  assert.deepEqual(inside.cells, [{ row: 0, col: 1, minor: 500 }]);
});

test("grid text round-trips through the formatter", () => {
  assert.equal(formatAmountInput(1_250_000), "12 500");
  assert.equal(formatAmountInput(1_250_050), "12 500,50");
  assert.equal(formatAmountInput(5), "0,05");
  assert.equal(formatAmountInput(null), "");
  for (const v of [0, 1, 99, 100, 123_456, 98_765_432]) assert.equal(parseAmount(formatAmountInput(v)), v);
});

test("save plan: only changed cells; zero or empty deletes; bad text blocks", () => {
  const stored = { [cellKey("2026-11-27", "bing")]: 50_00, [cellKey("2026-11-27", "x")]: 10_00 };
  const { changes, invalid } = diffManualCells(stored, {
    [cellKey("2026-11-27", "bing")]: "50", // unchanged
    [cellKey("2026-11-27", "x")]: "0", // zero -> delete
    [cellKey("2026-11-28", "pinterest")]: "1 200,5",
    [cellKey("2026-11-28", "chatgpt")]: "", // never stored, still empty
    [cellKey("2026-11-29", "other")]: "abc",
  });
  assert.deepEqual(changes, [
    { date: "2026-11-27", channel: "x", minor: null },
    { date: "2026-11-28", channel: "pinterest", minor: 120_050 },
  ]);
  assert.deepEqual(invalid, ["2026-11-29|other"]);
});
