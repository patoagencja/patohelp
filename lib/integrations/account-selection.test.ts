import { test } from "node:test";
import assert from "node:assert/strict";

import { mergeAccountSelection } from "./account-selection.ts";

type Account = Record<string, unknown>;

const selectedIds = (list: Account[]) =>
  list.filter((a) => a.selected === true).map((a) => String(a.id));

test("carries the selection over when the new list drops the act_ prefix", () => {
  const previous = [
    { id: "act_111", name: "DRE", selected: true },
    { id: "act_222", name: "DRE 2024", selected: false },
  ];
  const next = [
    { id: "111", name: "DRE" },
    { id: "222", name: "DRE 2024" },
  ];

  const merged = mergeAccountSelection(previous, next);

  assert.deepEqual(merged, [
    { id: "111", name: "DRE", selected: true },
    { id: "222", name: "DRE 2024", selected: false },
  ]);
});

test("carries the selection over when the new list adds the act_ prefix", () => {
  const merged = mergeAccountSelection(
    [{ id: "111", selected: true }],
    [{ id: "act_111", name: "DRE" }]
  );

  assert.deepEqual(merged, [{ id: "act_111", name: "DRE", selected: true }]);
});

test("matches Google customer ids with and without dashes, keeping video_only", () => {
  const merged = mergeAccountSelection(
    [{ id: "123-456-7890", selected: true, video_only: true }],
    [{ id: "1234567890", name: "dre 2025" }]
  );

  assert.deepEqual(merged, [
    { id: "1234567890", name: "dre 2025", selected: true, video_only: true },
  ]);
});

test("a selected account missing from the new list stays selected and is marked unlisted", () => {
  const previous = [
    { id: "act_111", name: "DRE", selected: true },
    { id: "act_999", name: "DRE stare", selected: true },
  ];
  const next = [{ id: "act_111", name: "DRE" }];

  const merged = mergeAccountSelection(previous, next);

  assert.deepEqual(merged, [
    { id: "act_111", name: "DRE", selected: true },
    { id: "act_999", name: "DRE stare", selected: true, unlisted: true },
  ]);
});

test("a non-empty selection never becomes empty through a merge", () => {
  const previous = [
    { id: "act_1", selected: true },
    { id: "act_2", selected: false },
    { id: "act_3", selected: true },
  ];
  // Token that sees none of the old accounts, one that sees some, and an
  // empty listing (no access at all).
  const listings: Account[][] = [
    [{ id: "act_7" }, { id: "act_8" }],
    [{ id: "act_2" }, { id: "act_8" }],
    [],
  ];

  for (const next of listings) {
    const merged = mergeAccountSelection(previous, next);
    assert.deepEqual(selectedIds(merged).sort(), ["act_1", "act_3"]);
  }
});

test("unselected accounts missing from the new list are dropped", () => {
  const previous = [
    { id: "act_1", selected: true },
    { id: "act_2", selected: false },
    { id: "act_3" },
  ];
  const next = [{ id: "act_1" }];

  const merged = mergeAccountSelection(previous, next);

  assert.deepEqual(
    merged.map((a) => a.id),
    ["act_1"]
  );
});

test("accounts new to the list come through untouched", () => {
  const merged = mergeAccountSelection([], [{ id: "act_5", name: "Nowe" }]);

  assert.deepEqual(merged, [{ id: "act_5", name: "Nowe" }]);
});
