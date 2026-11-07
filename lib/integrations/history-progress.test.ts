import { test } from "node:test";
import assert from "node:assert/strict";

import { accountKey } from "./account-selection.ts";
import {
  bootstrapProgress,
  clearRedo,
  closableDays,
  compactDays,
  daysIn,
  decodeProgress,
  encodeProgress,
  expandDays,
  findSuspectDays,
  leastServedFirst,
  markFetched,
  markRedone,
  markServed,
  pendingDays,
  plannedDays,
  probeRanges,
  progressKey,
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
    assert.deepEqual(stored.done[progressKey(acc)], [`${window.from}..${window.to}`]);
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

test("stored days before the window are dropped; a deselected account keeps its progress", () => {
  const view = fresh(["A", "B"]);
  markFetched(view, "A", ["2026-09-29", "2026-09-30", "2026-10-01"], "2026-11-07");
  markFetched(view, "B", ["2026-10-01"], "2026-11-07");
  markRedone(view, "clicks", "B", ["2026-10-01"], new Set(["2026-10-01"]));
  markServed(view, ["B", "A"]);
  // B deselected for a run: nothing of it is lost.
  const stored = encodeProgress(view, { from: "2026-10-01", accounts: ["A"] });
  assert.deepEqual(stored.done, { A: ["2026-10-01"], B: ["2026-10-01"] });
  assert.deepEqual(stored.redo, { clicks: { B: ["2026-10-01"] } });
  assert.deepEqual(stored.order, ["B", "A"]);
  // Reselected, it does not fetch that day again.
  const back = decodeProgress(JSON.parse(JSON.stringify(stored)))!;
  const all = answer("2026-10-01", "2026-10-01", ["2026-10-01"]);
  assert.deepEqual(plannedDays(back, "B", all, { from: "2026-10-01", to: "2026-10-01" }, [], { includeUnknown: false, cap: 9 }), []);
});

test("an account left unselected ages out with the window, not before", () => {
  const view = fresh(["A", "GONE"]);
  markFetched(view, "GONE", ["2026-10-01", "2026-10-02"], "2026-11-07");
  markServed(view, ["GONE"]);
  // Still inside the window: kept.
  assert.deepEqual(encodeProgress(view, { from: "2026-10-02", accounts: ["A"] }).done.GONE, ["2026-10-02"]);
  // Every day of it left the window: gone, from `order` too.
  const later = encodeProgress(view, { from: "2026-10-03", accounts: ["A"] });
  assert.equal(later.done.GONE, undefined);
  assert.equal(later.order, undefined);
});

test("no account selected for a run (\"0 of 46\") wipes nothing", () => {
  const accounts = Array.from({ length: 46 }, (_, i) => `act_${100 + i}`);
  const view = bootstrapProgress({ start: "2026-11-07", accounts, present: OCTOBER, recheckFrom: "2026-11-01" });
  markServed(view, accounts.slice(0, 5));
  const stored = encodeProgress(view, { from: WINDOW.from, accounts: [] });
  assert.equal(Object.keys(stored.done).length, 46);
  assert.equal(stored.order?.length, 5);
});

test("record keys follow account-selection: act_ prefix and Google dashes don't matter", () => {
  for (const id of ["act_123", "123", "123-456-7890", "1234567890", 42]) assert.equal(progressKey(id), accountKey(id));
  // Recorded under "act_123", the account comes back listed as "123".
  const view = fresh(["act_123", "111-222-3333"]);
  markFetched(view, "act_123", ["2026-10-05"], "2026-11-07");
  markFetched(view, "111-222-3333", ["2026-10-06"], "2026-11-07");
  markRedone(view, "clicks", "act_123", ["2026-10-05"], new Set(["2026-10-05"]));
  markServed(view, ["act_123"]);
  const back = roundTrip(view, { accounts: ["123", "1112223333"] });
  const w = { from: "2026-10-05", to: "2026-10-06" };
  const ans = answer(w.from, w.to, ["2026-10-05", "2026-10-06"]);
  assert.deepEqual(plannedDays(back, "123", ans, w, [], { includeUnknown: false, cap: 9 }), ["2026-10-06"]);
  assert.deepEqual(plannedDays(back, "1112223333", ans, w, [], { includeUnknown: false, cap: 9 }), ["2026-10-05"]);
  assert.deepEqual(closableDays(back, "clicks", new Set(["2026-10-05"]), ["123"]), ["2026-10-05"]);
  assert.deepEqual(leastServedFirst([{ id: "123" }, { id: "1112223333" }], back.order).map((a) => a.id), ["1112223333", "123"]);
  // A record holding both spellings (written before keys were normalised) merges them.
  const merged = decodeProgress({ start: "x", done: { act_9: ["2026-10-01"], "9": ["2026-10-02"] }, order: ["act_9", "9"] })!;
  assert.deepEqual([...(merged.done.get("9") ?? [])].sort(), ["2026-10-01", "2026-10-02"]);
  assert.deepEqual(merged.order, ["9"]);
});

test("probe ranges grow the answer from its edges: at most two, the older one a span long", () => {
  // No answer yet: the span ending at the newest pending day.
  assert.deepEqual(probeRanges(["2026-01-05", "2026-10-30"], null, 92), [{ since: "2026-07-31", until: "2026-10-30" }]);
  assert.deepEqual(probeRanges(["2026-10-20", "2026-10-30"], undefined, 92), [{ since: "2026-10-20", until: "2026-10-30" }]);
  // Known 2026-08-01..2026-10-20: the days since, and one span of older ones,
  // however sparse the pending days are (a year back takes a few runs).
  const known = answer("2026-08-01", "2026-10-20", ["2026-09-01"]);
  assert.deepEqual(probeRanges(["2025-11-10", "2026-02-03", "2026-09-01", "2026-10-30"], known, 92), [
    { since: "2026-10-21", until: "2026-10-30" },
    { since: "2026-05-01", until: "2026-07-31" },
  ]);
  // Close to the known range: no further back than needed.
  assert.deepEqual(probeRanges(["2026-07-25"], known, 92), [{ since: "2026-07-25", until: "2026-07-31" }]);
  // Everything pending is covered: nothing to ask.
  assert.deepEqual(probeRanges(["2026-09-01", "2026-10-01"], known, 92), []);
  assert.deepEqual(probeRanges([], known, 92), []);
});

test("sparse pending days are all reached, a span per run, and each run asks little", () => {
  const window = { from: "2025-11-08", to: "2026-11-05" };
  const view = bootstrapProgress({ start: "2026-11-07", accounts: ["A"], present: daysIn(window.from, window.to), recheckFrom: "2026-11-07", suspect: ["2025-11-20", "2026-03-03", "2026-10-01"] });
  const truth = new Set(["2025-11-20", "2026-10-01"]); // delivered on these
  let cache: DeliveryAnswer | null = null;
  const fetched: string[] = [];
  for (let run = 0; run < 6; run += 1) {
    settleUndelivered(view, "A", cache, window);
    const ranges = probeRanges(pendingDays(view, "A", window), cache, 92);
    assert.ok(ranges.length <= 2);
    for (const r of ranges) {
      const lo = cache && cache.from < r.since ? cache.from : r.since;
      const hi = cache && cache.to > r.until ? cache.to : r.until;
      cache = answer(lo, hi, [...truth].filter((d) => d >= lo && d <= hi));
    }
    settleUndelivered(view, "A", cache, window);
    const plan = plannedDays(view, "A", cache, window, [], { includeUnknown: false, cap: 150 });
    fetched.push(...plan);
    markFetched(view, "A", plan, "2026-11-07");
  }
  assert.deepEqual(fetched.sort(), [...truth].sort());
  assert.equal(pendingDays(view, "A", window).length, 0);
});

/** A fake ads_daily: day -> [old rows, rows written lately]. */
function counter(rows: Record<string, [number, number]>) {
  let calls = 0;
  const count = async (from: string, to: string) => {
    calls += 1;
    return Object.entries(rows)
      .filter(([d]) => d >= from && d <= to)
      .reduce((n, [, [, recent]]) => n + recent, 0);
  };
  const totals = new Map(Object.entries(rows).map(([d, [old, recent]]) => [d, old + recent]));
  return { count, totals, calls: () => calls };
}

test("lately filled old days are found by counts, however many rows a day has", async () => {
  // A year of history; an outage gap (60 days) filled lately, hundreds of
  // rows a day, plus one older day where one account's campaigns were added.
  const rows: Record<string, [number, number]> = {};
  for (const d of daysIn("2025-11-08", "2026-09-22")) rows[d] = [400, 0];
  for (const d of daysIn("2026-03-01", "2026-04-29")) rows[d] = [0, 450];
  rows["2025-12-24"] = [300, 40];
  const fake = counter(rows);
  const found = await findSuspectDays({ days: Object.keys(rows), rowsOnDay: fake.totals, countWrittenSince: fake.count, maxRequests: 80 });
  assert.ok(found && !found.capped);
  assert.deepEqual([...found.suspect].sort(), [...daysIn("2026-03-01", "2026-04-29"), "2025-12-24"].sort());
  // A fully filled block settles in a few counts, not a page per day
  // (paging DRE's hundreds of rows a day reached ~60 days in 20 pages).
  assert.ok(fake.calls() <= 25, `${fake.calls()} counts`);
  assert.equal(found.requests, fake.calls());
});

test("past the count cap the unsettled days are taken as lately filled, not as done", async () => {
  const rows: Record<string, [number, number]> = {};
  // Every other day has one lately written row: the worst case for halving.
  for (const [i, d] of daysIn("2025-11-08", "2026-09-22").entries()) rows[d] = [100, i % 2];
  const fake = counter(rows);
  const found = await findSuspectDays({ days: Object.keys(rows), rowsOnDay: fake.totals, countWrittenSince: fake.count, maxRequests: 30 });
  assert.ok(found?.capped);
  assert.equal(fake.calls(), 30);
  // Conservative: every truly suspect day is in, whatever the cap left open.
  for (const [d, [, recent]] of Object.entries(rows)) if (recent) assert.ok(found.suspect.has(d), d);
});

test("without per-day totals the search is still exact; an unreadable count assumes nothing", async () => {
  const rows: Record<string, [number, number]> = {};
  for (const d of daysIn("2026-01-01", "2026-01-31")) rows[d] = [10, d === "2026-01-17" ? 3 : 0];
  const fake = counter(rows);
  const found = await findSuspectDays({ days: Object.keys(rows), rowsOnDay: null, countWrittenSince: fake.count, maxRequests: 80 });
  assert.deepEqual([...(found?.suspect ?? [])], ["2026-01-17"]);
  assert.equal(await findSuspectDays({ days: Object.keys(rows), countWrittenSince: async () => null, maxRequests: 80 }), null);
  const none = await findSuspectDays({ days: [], countWrittenSince: async () => 0, maxRequests: 80 });
  assert.deepEqual(none, { suspect: new Set(), capped: false, requests: 0 });
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
