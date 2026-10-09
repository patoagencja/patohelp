import { test } from "node:test";
import assert from "node:assert/strict";

import { deferredFirst, leastRecentFirst, splitRanges } from "./cron-runs.ts";

const client = (id: string) => ({ client_id: id });
const ids = (list: Array<{ client_id: string }>) => list.map((c) => c.client_id);

test("clients never served (or beyond what was read) go first, then the oldest success", () => {
  const newest = new Map([
    ["dre", Date.parse("2026-10-09T10:00:00Z")],
    ["olx", Date.parse("2026-10-09T09:00:00Z")],
  ]);
  const order = leastRecentFirst([client("dre"), client("olx"), client("new")], (c) => c.client_id, newest);
  assert.deepEqual(ids(order), ["new", "olx", "dre"]);
});

test("unreadable success times keep the input order", () => {
  const list = [client("a"), client("b"), client("c")];
  assert.deepEqual(ids(leastRecentFirst(list, (c) => c.client_id, null)), ["a", "b", "c"]);
  assert.deepEqual(ids(leastRecentFirst(list, (c) => c.client_id, new Map())), ["a", "b", "c"]);
});

test("a client a deadline left out leads the next run", () => {
  // Run 1 served a and b; c was never started, so it keeps its old success.
  const newest = new Map([
    ["a", Date.parse("2026-10-09T10:00:00Z")],
    ["b", Date.parse("2026-10-09T10:01:00Z")],
    ["c", Date.parse("2026-10-09T09:30:00Z")],
  ]);
  const order = leastRecentFirst([client("a"), client("b"), client("c")], (c) => c.client_id, newest);
  assert.deepEqual(ids(order), ["c", "a", "b"]);
});

const acc = (id: string) => ({ id });
const accIds = (list: Array<{ id: string }>) => list.map((a) => a.id);

test("accounts deferred last run go first, then the rest in input order", () => {
  const accounts = ["a1", "a2", "a3", "a4", "a5"].map(acc);
  assert.deepEqual(accIds(deferredFirst(accounts, ["a4", "a5"])), ["a4", "a5", "a1", "a2", "a3"]);
  assert.deepEqual(accIds(deferredFirst(accounts, undefined)), ["a1", "a2", "a3", "a4", "a5"]);
});

test("deferred ids of accounts no longer selected are ignored", () => {
  const accounts = ["a1", "a2"].map(acc);
  assert.deepEqual(accIds(deferredFirst(accounts, ["gone", "a2"])), ["a2", "a1"]);
});

test("a deadline of k accounts per run reaches every account within ceil(n / k) runs", () => {
  // DRE: 46 Meta accounts; say a run gets through 10 of them.
  const accounts = Array.from({ length: 46 }, (_, i) => acc(`act_${i}`));
  let deferred: string[] | undefined;
  const seen = new Set<string>();
  for (let run = 0; run < 5; run += 1) {
    const order = deferredFirst(accounts, deferred);
    order.slice(0, 10).forEach((a) => seen.add(a.id));
    deferred = order.slice(10).map((a) => a.id);
  }
  assert.equal(seen.size, 46);
});

test("long ranges are cut into pieces, newest first; short ones stay whole", () => {
  assert.deepEqual(splitRanges([{ since: "2026-01-01", until: "2026-01-10" }], 4), [
    { since: "2026-01-07", until: "2026-01-10" },
    { since: "2026-01-03", until: "2026-01-06" },
    { since: "2026-01-01", until: "2026-01-02" },
  ]);
  assert.deepEqual(splitRanges([{ since: "2026-03-01", until: "2026-03-01" }], 62), [
    { since: "2026-03-01", until: "2026-03-01" },
  ]);
});

test("pieces cover every day of the range exactly once, across month and year ends", () => {
  const pieces = splitRanges([{ since: "2025-07-01", until: "2026-10-07" }], 62);
  const days = new Set<string>();
  for (const p of pieces) {
    assert.ok(p.since <= p.until);
    for (let d = Date.parse(`${p.since}T00:00:00Z`); d <= Date.parse(`${p.until}T00:00:00Z`); d += 86_400_000) {
      const iso = new Date(d).toISOString().slice(0, 10);
      assert.ok(!days.has(iso), `${iso} twice`);
      days.add(iso);
    }
  }
  // 2025-07-01..2026-10-07 inclusive.
  assert.equal(days.size, 464);
  assert.equal(pieces[0].until, "2026-10-07");
});
