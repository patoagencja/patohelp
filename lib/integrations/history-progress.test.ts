import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bootstrapProgress,
  clearRedo,
  closableDays,
  compactDays,
  daysIn,
  decodeProgress,
  encodeProgress,
  expandDays,
  leastServedFirst,
  markFetched,
  markRedone,
  markServed,
  pendingDays,
  plannedDays,
  sameProgress,
  settleUndelivered,
  type DeliveryAnswer,
  type FlaggedDays,
  type HistoryWindow,
  type ProgressView,
} from "./history-progress.ts";

const fresh = (accounts: string[] = []): ProgressView => bootstrapProgress({
  start: "2026-11-07",
  accounts,
  present: [],
  recheckFrom: "2026-11-07",
});
const answer = (from: string, to: string, active: string[]): DeliveryAnswer => ({ from, to, active: compactDays(active) });
/** Stored and read back, as between two runs. */
const roundTrip = (view: ProgressView, keep: { from?: string; accounts?: string[] } = {}): ProgressView =>
  decodeProgress(JSON.parse(JSON.stringify(encodeProgress(view, keep))))!;

const WINDOW: HistoryWindow = { from: "2026-10-01", to: "2026-10-31" };
const OCTOBER = daysIn("2026-10-01", "2026-10-31");

test("runs of days encode compactly and read back", () => {
  assert.deepEqual(compactDays(["2026-10-03", "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-02"]), [
    "2026-10-01..2026-10-03",
    "2026-10-05",
  ]);
  // Month and year boundaries are just consecutive days.
  assert.deepEqual(compactDays(daysIn("2025-12-30", "2026-01-02")), ["2025-12-30..2026-01-02"]);
  assert.deepEqual([...expandDays(["2025-12-30..2026-01-02", "2026-01-05"])], [
    "2025-12-30",
    "2025-12-31",
    "2026-01-01",
    "2026-01-02",
    "2026-01-05",
  ]);
  assert.deepEqual(compactDays(daysIn("2025-08-01", "2026-11-05")).length, 1);
});

test("a corrupt stored record is skipped piece by piece, not trusted", () => {
  assert.deepEqual(
    [...expandDays(["junk", 7, "2026-10-01..x", "2026-10-05..2026-10-01", "1990-01-01..2030-01-01", "2026-10-09"])],
    ["2026-10-09"]
  );
  assert.equal(decodeProgress(null), null);
  assert.equal(decodeProgress({ start: "x" }), null);
  assert.equal(decodeProgress([]), null);
  const view = decodeProgress({ done: { a: "nope", b: ["2026-10-01"] }, redo: { clicks: 5 }, order: ["b", 3, "b"] });
  assert.ok(view);
  assert.equal(view.done.get("a")?.size, 0);
  assert.deepEqual([...(view.done.get("b") ?? [])], ["2026-10-01"]);
  assert.equal(view.redo.size, 0);
  assert.deepEqual(view.order, ["b"]);
});

test("A fills day D, the run ends: B and C still fetch D on the next run", () => {
  const accounts = ["A", "B", "C"];
  let view = fresh(accounts);
  const everyDay = answer("2026-10-01", "2026-10-31", OCTOBER);
  const D = "2026-10-20";

  // Run 1: A goes first and fetches D; the budget ends before B and C start.
  for (const a of accounts) settleUndelivered(view, a, everyDay, WINDOW);
  assert.ok(plannedDays(view, "A", everyDay, WINDOW, [], { includeUnknown: false, cap: 150 }).includes(D));
  markFetched(view, "A", [D], "2026-11-07");
  markServed(view, ["A"]);
  view = roundTrip(view);

  // The client now has rows for D. Before, that made D "present" and B and C
  // never fetched it. Per account it is still theirs to fetch.
  for (const a of ["B", "C"]) {
    assert.ok(plannedDays(view, a, everyDay, WINDOW, [], { includeUnknown: false, cap: 150 }).includes(D), a);
  }
  assert.ok(!plannedDays(view, "A", everyDay, WINDOW, [], { includeUnknown: false, cap: 150 }).includes(D));
  // And B (never served) leads the next run's history, A goes last.
  assert.deepEqual(leastServedFirst(accounts.map((id) => ({ id })), view.order).map((a) => a.id), ["B", "C", "A"]);
});

test("only days the account delivered on are planned, newest first, capped", () => {
  const view = fresh(["A"]);
  const delivered = ["2026-10-02", "2026-10-03", "2026-10-10", "2026-10-30"];
  const ans = answer("2026-10-01", "2026-10-31", delivered);
  settleUndelivered(view, "A", ans, WINDOW);
  assert.deepEqual(plannedDays(view, "A", ans, WINDOW, [], { includeUnknown: false, cap: 150 }), [
    "2026-10-30",
    "2026-10-10",
    "2026-10-03",
    "2026-10-02",
  ]);
  assert.deepEqual(plannedDays(view, "A", ans, WINDOW, [], { includeUnknown: false, cap: 2 }), ["2026-10-30", "2026-10-10"]);
  // Settled: the days without delivery are done and no longer pending.
  assert.deepEqual(pendingDays(view, "A", WINDOW), delivered);
});

test("days the answer doesn't cover wait for a probe, unless the probe failed", () => {
  const view = fresh(["A"]);
  const partial = answer("2026-10-20", "2026-10-31", ["2026-10-25"]);
  assert.deepEqual(plannedDays(view, "A", partial, WINDOW, [], { includeUnknown: false, cap: 150 }), ["2026-10-25"]);
  const unknownToo = plannedDays(view, "A", partial, WINDOW, [], { includeUnknown: true, cap: 150 });
  // Known-quiet days in the covered part stay out even then.
  assert.ok(!unknownToo.includes("2026-10-24"));
  assert.ok(unknownToo.includes("2026-10-19") && unknownToo.includes("2026-10-01"));
  assert.equal(unknownToo[0], "2026-10-25");
  // No answer at all.
  assert.deepEqual(plannedDays(view, "A", undefined, WINDOW, [], { includeUnknown: false, cap: 150 }), []);
});

test("today is never marked done; yesterday from the fresh pass is", () => {
  const view = fresh(["A"]);
  markFetched(view, "A", ["2026-11-06", "2026-11-07"], "2026-11-07");
  assert.deepEqual([...(view.done.get("A") ?? [])], ["2026-11-06"]);
  // Tomorrow it is D-2: already done, not fetched again.
  const ans = answer("2026-11-01", "2026-11-06", daysIn("2026-11-01", "2026-11-06"));
  assert.ok(!plannedDays(view, "A", ans, { from: "2026-11-01", to: "2026-11-06" }, [], { includeUnknown: false, cap: 150 }).includes("2026-11-06"));
});

test("bootstrap: old rows count for every account, the recent window and recent fills are re-checked", () => {
  const present = daysIn("2025-11-08", "2026-11-05");
  const view = bootstrapProgress({
    start: "2026-11-07",
    accounts: ["A", "B"],
    present,
    recheckFrom: "2026-09-23",
    suspect: ["2026-08-10", "2026-08-11"],
    known: { B: ["2026-10-01"] },
  });
  const window = { from: "2025-11-08", to: "2026-11-05" };
  const pendingA = pendingDays(view, "A", window);
  // 2026-09-23..2026-11-05 (44 days) plus the two recently filled days.
  assert.equal(pendingA.length, 44 + 2);
  assert.deepEqual(pendingA.slice(0, 3), ["2026-08-10", "2026-08-11", "2026-09-23"]);
  assert.equal(pendingA[pendingA.length - 1], "2026-11-05");
  // Days already known for one account (fetched, no rows) are done for it.
  assert.ok(!pendingDays(view, "B", window).includes("2026-10-01"));
  // An account selected later has nothing done: it fetches its whole window.
  assert.equal(pendingDays(view, "NEW", window).length, present.length);
  // Days without rows were never assumed: every account asks about them.
  const holes = bootstrapProgress({ start: "2026-11-07", accounts: ["A"], present: ["2026-01-01"], recheckFrom: "2026-09-23" });
  assert.equal(pendingDays(holes, "A", { from: "2026-01-01", to: "2026-01-03" }).length, 2);
  // Stored, it is one run per account (two around the suspect days).
  const stored = encodeProgress(view, { from: window.from, accounts: ["A", "B"] });
  assert.deepEqual(stored.done.A, ["2025-11-08..2026-08-09", "2026-08-12..2026-09-22"]);
});

test("a stale day closes once every account re-pulled it, across runs", () => {
  const accounts = ["A", "B", "C"];
  let view = fresh(accounts);
  // The rows are there already (bootstrap assumed them done)...
  for (const a of accounts) markFetched(view, a, OCTOBER, "2026-11-07");
  const D = "2026-10-15";
  const stale: FlaggedDays = { kind: "clicks", days: new Set([D]) };
  const everyDay = answer("2026-10-01", "2026-10-31", OCTOBER);
  // ...yet a flagged day is pending for every account until it re-pulls it.
  for (const a of accounts) {
    assert.deepEqual(plannedDays(view, a, everyDay, WINDOW, [stale], { includeUnknown: false, cap: 150 }), [D]);
  }

  // Run 1: only A gets to it.
  markFetched(view, "A", [D], "2026-11-07");
  markRedone(view, "clicks", "A", [D], stale.days);
  assert.deepEqual(closableDays(view, "clicks", stale.days, accounts), []);
  view = roundTrip(view);
  // A does not re-pull it again.
  assert.deepEqual(plannedDays(view, "A", everyDay, WINDOW, [stale], { includeUnknown: false, cap: 150 }), []);

  // Run 2: B; run 3: C. Completion adds up across runs.
  markRedone(view, "clicks", "B", [D], stale.days);
  view = roundTrip(view);
  assert.deepEqual(closableDays(view, "clicks", stale.days, accounts), []);
  markRedone(view, "clicks", "C", [D], stale.days);
  view = roundTrip(view);
  assert.deepEqual(closableDays(view, "clicks", stale.days, accounts), [D]);
  // Kinds are counted apart: a click re-pull is not a purchase re-pull.
  assert.deepEqual(closableDays(view, "purchase", stale.days, accounts), []);
  // Nothing flagged any more: the record goes.
  clearRedo(view, "clicks");
  assert.equal(encodeProgress(view).redo, undefined);
});

test("a paused account (no delivery) never blocks closing a day", () => {
  const accounts = ["A", "PAUSED"];
  const view = fresh(accounts);
  const D = "2026-10-15";
  const flagged: FlaggedDays = { kind: "purchase", days: new Set([D]) };
  const quiet = answer("2026-10-01", "2026-10-31", []);
  settleUndelivered(view, "PAUSED", quiet, WINDOW, [flagged]);
  assert.deepEqual(plannedDays(view, "PAUSED", quiet, WINDOW, [flagged], { includeUnknown: false, cap: 150 }), []);
  markRedone(view, "purchase", "A", [D], flagged.days);
  assert.deepEqual(closableDays(view, "purchase", flagged.days, accounts), [D]);
  // But an account whose delivery is unknown (never probed, broken) does.
  assert.deepEqual(closableDays(view, "purchase", flagged.days, [...accounts, "BROKEN"]), []);
  assert.deepEqual(closableDays(view, "purchase", flagged.days, []), []);
});

test("an account that delivered on a flagged day must re-pull it, even if its rows were assumed", () => {
  const view = bootstrapProgress({ start: "2026-11-07", accounts: ["A"], present: OCTOBER, recheckFrom: "2026-11-01" });
  const flagged: FlaggedDays = { kind: "clicks", days: new Set(["2026-10-03", "2026-10-04"]) };
  const ans = answer("2026-10-01", "2026-10-31", ["2026-10-03"]);
  settleUndelivered(view, "A", ans, WINDOW, [flagged]);
  assert.deepEqual(plannedDays(view, "A", ans, WINDOW, [flagged], { includeUnknown: false, cap: 150 }), ["2026-10-03"]);
  // The quiet one is settled as re-pulled.
  assert.deepEqual(closableDays(view, "clicks", new Set(["2026-10-04"]), ["A"]), ["2026-10-04"]);
});

test("flagged days marked ignoreDelivery are re-pulled by every account, once", () => {
  // Google video-only accounts: the probe doesn't see REMOVED campaigns.
  const view = fresh(["V"]);
  const D = "2026-10-15";
  const flagged: FlaggedDays = { kind: "purchase", days: new Set([D]), ignoreDelivery: true };
  const quiet = answer("2026-10-01", "2026-10-31", []);
  settleUndelivered(view, "V", quiet, WINDOW, [flagged]);
  // Quiet days are done for the backfill, but the flagged one still goes out.
  assert.deepEqual(plannedDays(view, "V", quiet, WINDOW, [flagged], { includeUnknown: false, cap: 150 }), [D]);
  assert.deepEqual(closableDays(view, "purchase", flagged.days, ["V"]), []);
  markRedone(view, "purchase", "V", [D], flagged.days);
  assert.deepEqual(plannedDays(view, "V", quiet, WINDOW, [flagged], { includeUnknown: false, cap: 150 }), []);
  assert.deepEqual(closableDays(view, "purchase", flagged.days, ["V"]), [D]);
});

test("accounts served this run go to the back; the rest keep their turn", () => {
  const accounts = ["a", "b", "c", "d"].map((id) => ({ id }));
  const view = fresh();
  assert.deepEqual(leastServedFirst(accounts, view.order).map((a) => a.id), ["a", "b", "c", "d"]);
  markServed(view, ["a", "b"]); // budget ran out during b
  assert.deepEqual(leastServedFirst(accounts, view.order).map((a) => a.id), ["c", "d", "a", "b"]);
  markServed(view, ["c"]);
  markServed(view, ["c"]); // idempotent
  assert.deepEqual(leastServedFirst(accounts, view.order).map((a) => a.id), ["d", "a", "b", "c"]);
  // A newly selected account goes first; a deselected one is dropped when stored.
  const next = roundTrip(view, { accounts: ["a", "c", "d", "e"] });
  assert.deepEqual(next.order, ["a", "c"]);
  assert.deepEqual(
    leastServedFirst([{ id: "a" }, { id: "c" }, { id: "d" }, { id: "e" }], next.order).map((a) => a.id),
    ["d", "e", "a", "c"]
  );
});

test("one account's long backlog no longer starves the others", () => {
  // BIG has a year to fetch, the others a few days each; a run's budget
  // covers 8 days. With a fixed order BIG took every run.
  const window = { from: "2025-11-08", to: "2026-11-05" };
  const all = daysIn(window.from, window.to);
  const accounts = ["BIG", "s1", "s2", "s3"];
  let view = bootstrapProgress({ start: "2026-11-07", accounts, present: all, recheckFrom: "2026-11-02" });
  view.done.set("BIG", new Set());
  const ans = answer(window.from, window.to, all);
  const finished = new Map<string, number>();
  for (let run = 1; run <= 6; run += 1) {
    let budget = 8;
    const served: string[] = [];
    for (const acc of leastServedFirst(accounts.map((id) => ({ id })), view.order)) {
      if (budget <= 0) break;
      const plan = plannedDays(view, acc.id, ans, window, [], { includeUnknown: false, cap: 150 });
      if (!plan.length) continue;
      served.push(acc.id);
      const take = plan.slice(0, budget);
      budget -= take.length;
      markFetched(view, acc.id, take, "2026-11-07");
      if (take.length === plan.length && !finished.has(acc.id)) finished.set(acc.id, run);
    }
    markServed(view, served);
    view = roundTrip(view, { from: window.from, accounts });
  }
  // Every small account was caught up within the first few runs.
  for (const s of ["s1", "s2", "s3"]) assert.ok((finished.get(s) ?? 99) <= 3, `${s} ${finished.get(s)}`);
});

test("state stays small for 46 accounts x 470 days", () => {
  const window = { from: "2025-07-24", to: "2026-11-05" }; // 470 days
  const all = daysIn(window.from, window.to);
  assert.equal(all.length, 470);
  const accounts = Array.from({ length: 46 }, (_, i) => `act_${String(1_000_000_000_000_000 + i * 7919)}`);
  // Bursty delivery: 2-6 weeks on, 1-3 weeks off, some accounts paused for good.
  let seed = 7;
  const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const answers = new Map<string, DeliveryAnswer>();
  for (const [i, acc] of accounts.entries()) {
    const active: string[] = [];
    if (i % 9 !== 0) {
      let on = rnd() < 0.5;
      for (let d = 0; d < all.length; ) {
        const len = on ? 14 + Math.floor(rnd() * 28) : 7 + Math.floor(rnd() * 14);
        if (on) active.push(...all.slice(d, d + len));
        d += len;
        on = !on;
      }
    }
    answers.set(acc, answer(window.from, window.to, active));
  }
  let view = bootstrapProgress({ start: "2026-11-07", accounts, present: all, recheckFrom: "2026-09-23" });
  view.done.set(accounts[3], new Set()); // one account added later: a full backfill
  let maxBytes = 0;
  for (let run = 0; run < 120; run += 1) {
    let budget = 40;
    const served: string[] = [];
    for (const { id } of leastServedFirst(accounts.map((id) => ({ id })), view.order)) {
      settleUndelivered(view, id, answers.get(id), window);
      if (budget <= 0) continue;
      const plan = plannedDays(view, id, answers.get(id), window, [], { includeUnknown: false, cap: 150 });
      if (!plan.length) continue;
      served.push(id);
      const take = plan.slice(0, budget);
      budget -= take.length;
      // Every 13th fetch fails (no fx rate, an error): a hole for a later run.
      markFetched(view, id, take.filter((_, k) => (run + k) % 13 !== 0), "2026-11-07");
    }
    markServed(view, served);
    const stored = encodeProgress(view, { from: window.from, accounts });
    maxBytes = Math.max(maxBytes, JSON.stringify(stored).length);
    view = decodeProgress(JSON.parse(JSON.stringify(stored)))!;
  }
  // Caught up: one run per account, ~3 KB in all.
  const stored = encodeProgress(view, { from: window.from, accounts });
  for (const acc of accounts) {
    assert.equal(pendingDays(view, acc, window).length, 0, acc);
    assert.deepEqual(stored.done[acc], [`${window.from}..${window.to}`]);
  }
  const bytes = JSON.stringify(stored).length;
  assert.ok(bytes < 4_000, `caught-up state ${bytes} B`);
  // Never more than a few KB on the way there either.
  assert.ok(maxBytes < 16_000, `largest state ${maxBytes} B`);

  // Worst case, every other day of every account still to fetch: runs are
  // bounded by the window (235 per account), never by how long it has run.
  const worst: ProgressView = fresh(accounts);
  for (const acc of accounts) worst.done.set(acc, new Set(all.filter((_, k) => k % 2 === 0)));
  const worstStored = encodeProgress(worst, { from: window.from, accounts });
  for (const acc of accounts) assert.equal(worstStored.done[acc].length, 235);
  assert.ok(JSON.stringify(worstStored).length < 46 * 235 * 14 + 46 * 40);
});

test("stored days before the window and deselected accounts are dropped", () => {
  const view = fresh(["A", "B"]);
  markFetched(view, "A", ["2026-09-29", "2026-09-30", "2026-10-01"], "2026-11-07");
  markFetched(view, "B", ["2026-10-01"], "2026-11-07");
  markRedone(view, "clicks", "B", ["2026-10-01"], new Set(["2026-10-01"]));
  const stored = encodeProgress(view, { from: "2026-10-01", accounts: ["A"] });
  assert.deepEqual(stored.done, { A: ["2026-10-01"] });
  assert.equal(stored.redo, undefined);
});

test("unchanged progress compares equal whatever the key order (no rewrite every run)", () => {
  const view = fresh(["A", "B"]);
  markFetched(view, "A", ["2026-10-01"], "2026-11-07");
  markFetched(view, "B", ["2026-10-02"], "2026-11-07");
  markServed(view, ["B"]);
  const stored = encodeProgress(view);
  // jsonb hands keys back in its own order.
  const reordered = { order: stored.order, done: { B: stored.done.B, A: stored.done.A }, start: stored.start };
  assert.ok(sameProgress(stored, reordered));
  markFetched(view, "A", ["2026-10-02"], "2026-11-07");
  assert.ok(!sameProgress(encodeProgress(view), reordered));
  assert.ok(!sameProgress(stored, undefined));
});
