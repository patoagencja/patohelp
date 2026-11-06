import { test } from "node:test";
import assert from "node:assert/strict";

import {
  cachedActiveDays,
  markAccountsProcessed,
  oldestAccountsFirst,
  rememberActiveDays,
  unknownActiveRanges,
  type AccountRotationState,
} from "./sync-state.ts";

const item = (clientId: string, accountId: string) => ({ clientId, accountId });
const ids = (list: Array<{ clientId: string; accountId: string }>) =>
  list.map((i) => `${i.clientId}/${i.accountId}`);

test("never-processed accounts go first, then the least recently processed", () => {
  const states = new Map<string, AccountRotationState>([
    ["dre", { accounts: { a1: "2026-10-07T10:00:00Z", a2: "2026-10-07T09:00:00Z" } }],
    ["olx", { accounts: { o1: "2026-10-07T08:00:00Z" } }],
  ]);
  const order = oldestAccountsFirst(
    [item("dre", "a1"), item("dre", "a2"), item("dre", "a3"), item("olx", "o1")],
    states
  );
  assert.deepEqual(ids(order), ["dre/a3", "olx/o1", "dre/a2", "dre/a1"]);
});

test("ties keep the input order", () => {
  const order = oldestAccountsFirst([item("c", "x"), item("c", "y"), item("d", "z")], new Map());
  assert.deepEqual(ids(order), ["c/x", "c/y", "d/z"]);
});

test("unreadable state or a broken stamp falls back to input order", () => {
  const list = [item("c", "x"), item("c", "y")];
  assert.deepEqual(ids(oldestAccountsFirst(list, null)), ["c/x", "c/y"]);
  const broken = new Map<string, AccountRotationState>([["c", { accounts: { x: "not a date" } }]]);
  assert.deepEqual(ids(oldestAccountsFirst(list, broken)), ["c/x", "c/y"]);
});

test("the old client-level stamp does not pin a client's first account", () => {
  // Before per-account stamps every run restarted DRE at its first account.
  const states = new Map<string, AccountRotationState>([["dre", { at: "2026-10-07T10:00:00Z" }]]);
  const order = oldestAccountsFirst([item("olx", "o1"), item("dre", "a1")], states);
  assert.deepEqual(ids(order), ["olx/o1", "dre/a1"]);
});

test("a budget of k accounts per run reaches every account within ceil(n / k) runs", () => {
  // DRE: 46 accounts; say a run gets through 10 of them.
  const accounts = Array.from({ length: 46 }, (_, i) => item("dre", `act_${i}`));
  let state: AccountRotationState | undefined;
  const seen = new Set<string>();
  let clock = Date.parse("2026-10-07T00:00:00Z");
  for (let run = 0; run < 5; run += 1) {
    const order = oldestAccountsFirst(accounts, new Map(state ? [["dre", state]] : []));
    const stamps: Array<[string, string]> = order.slice(0, 10).map((a) => {
      clock += 1000;
      seen.add(a.accountId);
      return [a.accountId, new Date(clock).toISOString()];
    });
    state = markAccountsProcessed(state, stamps);
  }
  assert.equal(seen.size, 46);
  // Run five took act_40..act_45 and wrapped round to act_0..act_3, so the
  // sixth starts with the account processed longest ago: act_4.
  const next = oldestAccountsFirst(accounts, new Map([["dre", state!]]));
  assert.equal(next[0].accountId, "act_4");
});

test("stamps merge into the state without dropping other accounts", () => {
  const before: AccountRotationState = { at: "2026-10-01T00:00:00Z", accounts: { a: "2026-10-06T00:00:00Z" } };
  assert.deepEqual(markAccountsProcessed(before, [["b", "2026-10-07T00:00:00Z"]]), {
    accounts: { a: "2026-10-06T00:00:00Z", b: "2026-10-07T00:00:00Z" },
  });
  assert.deepEqual(markAccountsProcessed(null, [["a", "2026-10-07T00:00:00Z"]]), {
    accounts: { a: "2026-10-07T00:00:00Z" },
  });
});

test("active-day answers are kept across days and only new edges are asked", () => {
  const first = rememberActiveDays(null, "2026-11-01", "acc", "2026-09-01", "2026-10-30", new Set(["2026-09-02", "2026-10-29", "2026-10-30"]));
  // A later Warsaw day still uses the answer.
  assert.deepEqual([...(cachedActiveDays(first, "2026-11-04", "acc", "2026-10-01", "2026-10-30") ?? [])], ["2026-10-29", "2026-10-30"]);
  assert.deepEqual(unknownActiveRanges(first, "acc", "2026-09-01", "2026-10-30"), []);
  // Wider on both sides: only the two edges are asked.
  assert.deepEqual(unknownActiveRanges(first, "acc", "2026-08-25", "2026-11-02"), [
    { since: "2026-08-25", until: "2026-08-31" },
    { since: "2026-10-31", until: "2026-11-02" },
  ]);
  // Never asked, or an answer that doesn't touch the range: all of it.
  assert.deepEqual(unknownActiveRanges(first, "other", "2026-10-01", "2026-10-05"), [{ since: "2026-10-01", until: "2026-10-05" }]);
  assert.deepEqual(unknownActiveRanges(first, "acc", "2026-12-01", "2026-12-05"), [{ since: "2026-12-01", until: "2026-12-05" }]);
});

test("an edge answer extends the kept range, written compactly", () => {
  const days = new Set<string>();
  for (let d = 1; d <= 30; d++) days.add(`2026-09-${String(d).padStart(2, "0")}`);
  let cache = rememberActiveDays(null, "2026-11-01", "acc", "2026-09-01", "2026-09-30", days);
  // A full month of delivery is one entry.
  assert.deepEqual(cache.byAccount.acc.active, ["2026-09-01..2026-09-30"]);
  cache = rememberActiveDays(cache, "2026-11-02", "acc", "2026-10-01", "2026-10-03", new Set(["2026-10-02"]));
  assert.equal(cache.byAccount.acc.from, "2026-09-01");
  assert.equal(cache.byAccount.acc.to, "2026-10-03");
  const all = cachedActiveDays(cache, "2026-11-05", "acc", "2026-09-01", "2026-10-03");
  assert.equal(all?.size, 31);
  assert.ok(all?.has("2026-10-02") && !all.has("2026-10-01"));
  // Other accounts are left alone.
  cache = rememberActiveDays(cache, "2026-11-02", "b", "2026-10-01", "2026-10-01", new Set());
  assert.equal(cache.byAccount.acc.to, "2026-10-03");
  assert.deepEqual(cache.byAccount.b.active, []);
});

test("answers saved before this change (plain day lists) still read", () => {
  const old = { day: "2026-10-01", byAccount: { acc: { from: "2026-09-01", to: "2026-09-10", active: ["2026-09-03", "2026-09-04"] } } };
  assert.deepEqual([...(cachedActiveDays(old, "2026-11-01", "acc", "2026-09-01", "2026-09-10") ?? [])].sort(), ["2026-09-03", "2026-09-04"]);
});
