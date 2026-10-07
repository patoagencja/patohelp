import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createFxConverter,
  nbpRangeFor,
  normalizeCurrency,
  resolveRateDay,
  toGrosze,
  type FxFetch,
} from "./fx.ts";

const DAY_MS = 86_400_000;
const span = (start: string, end: string) =>
  (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS + 1;

// Tables of 2026-04-02 (Thu) .. 2026-04-08 (Wed): Good Friday is a normal
// NBP day, Easter Monday (04-06) is not, the weekend has no tables.
const APRIL = ["2026-04-01", "2026-04-02", "2026-04-03", "2026-04-07", "2026-04-08"];

test("a business day uses its own table", () => {
  assert.equal(resolveRateDay("2026-04-07", APRIL), "2026-04-07");
});

test("weekend and holiday days use the last business day before them", () => {
  assert.equal(resolveRateDay("2026-04-04", APRIL), "2026-04-03"); // Saturday
  assert.equal(resolveRateDay("2026-04-05", APRIL), "2026-04-03"); // Easter Sunday
  assert.equal(resolveRateDay("2026-04-06", APRIL), "2026-04-03"); // Easter Monday
});

test("today before the ~12:00 publication falls back to the previous table", () => {
  assert.equal(resolveRateDay("2026-04-09", APRIL), "2026-04-08");
});

test("no table on or before the day, or only a stale one, is unknown", () => {
  assert.equal(resolveRateDay("2026-03-31", APRIL), null);
  assert.equal(resolveRateDay("2026-04-30", APRIL), null); // 22 days after the last table
  assert.equal(resolveRateDay("2026-04-10", []), null);
});

test("every NBP request stays within the 93-day limit and covers the day plus its look-back", () => {
  for (const day of ["2026-01-01", "2026-02-14", "2026-06-30", "2025-12-24", "2026-10-07"]) {
    const r = nbpRangeFor(day, "2026-10-07");
    assert.ok(span(r.start, r.end) <= 93, `${day}: ${r.start}..${r.end}`);
    assert.ok(r.start <= day && day <= r.end, `${day} inside ${r.start}..${r.end}`);
    // At least 7 days before the day are in the range (a long holiday break).
    assert.ok(span(r.start, day) >= 8, `${day} look-back from ${r.start}`);
  }
  // Never past today.
  assert.equal(nbpRangeFor("2026-10-07", "2026-10-07").end, "2026-10-07");
});

test("currency codes are normalised; junk is rejected", () => {
  assert.equal(normalizeCurrency(" usd "), "USD");
  assert.equal(normalizeCurrency(""), null);
  assert.equal(normalizeCurrency("US DOLLAR"), null);
  assert.equal(normalizeCurrency(undefined), null);
});

function fakeNbp(rates: Record<string, number>, calls: string[], status = 200): FxFetch {
  return async (url) => {
    calls.push(url);
    const m = /\/a\/([a-z]+)\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})\//.exec(url);
    assert.ok(m, `unexpected url ${url}`);
    const [, , start, end] = m;
    assert.ok(span(start, end) <= 93, `range too long: ${url}`);
    if (status !== 200) return { ok: false, status, json: async () => ({}) };
    const inRange = Object.entries(rates)
      .filter(([d]) => d >= start && d <= end)
      .map(([effectiveDate, mid]) => ({ effectiveDate, mid }));
    if (!inRange.length) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ code: "USD", rates: inRange }) };
  };
}

test("converter: PLN needs no request; Saturday converts at Friday's rate; one request per block", async () => {
  const calls: string[] = [];
  const fx = createFxConverter({
    fetch: fakeNbp({ "2026-04-02": 3.9, "2026-04-03": 3.8, "2026-04-07": 3.7 }, calls),
    today: "2026-10-07",
  });
  assert.equal(await fx.rate("PLN", "2026-04-04"), 1);
  assert.equal(calls.length, 0);
  assert.equal(await fx.rate("usd", "2026-04-04"), 3.8);
  assert.equal(await fx.rate("USD", "2026-04-06"), 3.8);
  assert.equal(await fx.rate("USD", "2026-04-07"), 3.7);
  assert.equal(calls.length, 1, "same block is cached for the run");
  assert.equal(toGrosze(10, 3.8), 3800);
});

test("converter: NBP down or no table means no rate (never a silent 1:1)", async () => {
  const failing = createFxConverter({ fetch: fakeNbp({}, [], 503), today: "2026-10-07" });
  assert.equal(await failing.rate("USD", "2026-04-07"), null);
  const missing = createFxConverter({ fetch: fakeNbp({}, []), today: "2026-10-07" });
  assert.equal(await missing.rate("XYZ", "2026-04-07"), null);
  assert.equal(await missing.rate("not-a-code", "2026-04-07"), null);
});

test("converter: average over a period resolves every calendar day", async () => {
  const fx = createFxConverter({
    fetch: fakeNbp({ "2026-04-02": 4, "2026-04-03": 3, "2026-04-07": 3 }, []),
    today: "2026-10-07",
  });
  // Thu 4, Fri 3, Sat 3, Sun 3 -> 13 / 4
  assert.equal(await fx.averageRate("USD", "2026-04-02", "2026-04-05"), 13 / 4);
  assert.equal(await fx.averageRate("PLN", "2026-04-02", "2026-04-05"), 1);
});
