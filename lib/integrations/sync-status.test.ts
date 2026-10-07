import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveSyncOutcome } from "./sync-status.ts";

test("nothing selected fails, whatever else happened", () => {
  const outcome = resolveSyncOutcome({
    accountsSelected: 0,
    rowsWritten: 0,
    accountErrors: [],
  });

  assert.equal(outcome.status, "failed");
  assert.match(outcome.error_message ?? "", /Brak wybranych kont/);
});

test("every selected account errored and no rows -> failed with the errors", () => {
  const outcome = resolveSyncOutcome({
    accountsSelected: 2,
    rowsWritten: 0,
    accountErrors: ["act_1: token expired", "act_2: token expired"],
  });

  assert.deepEqual(outcome, {
    status: "failed",
    error_message: "act_1: token expired | act_2: token expired",
  });
});

test("some accounts errored and no rows -> success with a partial-failure note", () => {
  // DRE: one disabled account among 46 while nothing is running must not
  // read as "Meta is broken".
  const outcome = resolveSyncOutcome({
    accountsSelected: 46,
    rowsWritten: 0,
    accountErrors: ["act_9: account disabled"],
  });

  assert.deepEqual(outcome, {
    status: "success",
    error_message: "act_9: account disabled",
  });
});

test("rows written -> success, errors kept as a note", () => {
  const outcome = resolveSyncOutcome({
    accountsSelected: 3,
    rowsWritten: 120,
    accountErrors: ["act_2: rate limited"],
  });

  assert.deepEqual(outcome, {
    status: "success",
    error_message: "act_2: rate limited",
  });
});

test("rows written and no errors -> clean success", () => {
  assert.deepEqual(
    resolveSyncOutcome({ accountsSelected: 1, rowsWritten: 10, accountErrors: [] }),
    { status: "success", error_message: null }
  );
});

test("no rows and no errors -> success (legitimately no spend)", () => {
  assert.deepEqual(
    resolveSyncOutcome({ accountsSelected: 1, rowsWritten: 0, accountErrors: [] }),
    { status: "success", error_message: null }
  );
});

test("the note keeps at most five errors", () => {
  const errors = Array.from({ length: 8 }, (_, i) => `act_${i}: boom`);
  const outcome = resolveSyncOutcome({
    accountsSelected: 10,
    rowsWritten: 5,
    accountErrors: errors,
  });

  assert.equal(outcome.error_message?.split(" | ").length, 5);
});

test("the note says how many errors it left out", () => {
  const errors = Array.from({ length: 40 }, (_, i) => `act_${i}: limit zapytań Meta (kod 17)`);
  const outcome = resolveSyncOutcome({
    accountsSelected: 46,
    rowsWritten: 300,
    accountErrors: errors,
  });

  assert.equal(outcome.status, "success");
  assert.match(outcome.error_message ?? "", /\(\+35 więcej\)$/);
});
