import { test } from "node:test";
import assert from "node:assert/strict";

import {
  markAccountsProcessed,
  oldestAccountsFirst,
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
