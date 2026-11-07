import { test } from "node:test";
import assert from "node:assert/strict";

import { MAX_PER_CATEGORY, normalizeItems, parseItemsJson } from "./items.ts";

const item = (n: number, published = "2026-11-06") => ({
  published,
  title: `Tytuł ${n}`,
  summary: `Podsumowanie ${n}.`,
  source_name: "Źródło",
  source_url: `https://example.com/${n}`,
});

test("a complete array is parsed as is", () => {
  const text = JSON.stringify([item(1), item(2)]);
  const { parsed, repaired } = parseItemsJson(text);
  assert.equal(parsed.length, 2);
  assert.equal(repaired, false);
});

test("narration with brackets before the array is skipped", () => {
  const text = `Wyniki [2 wyszukiwania] poniżej.\n${JSON.stringify([item(1)])}`;
  assert.equal(parseItemsJson(text).parsed.length, 1);
});

test("an answer cut mid-item keeps the complete items before it", () => {
  const full = JSON.stringify([item(1), item(2), item(3)]);
  const cut = full.slice(0, full.indexOf("Podsumowanie 3") + 5);
  const { parsed, repaired } = parseItemsJson(cut);
  assert.equal(repaired, true);
  assert.deepEqual(
    parsed.map((p) => p.title),
    ["Tytuł 1", "Tytuł 2"]
  );
});

test("a closing brace inside a half-written string doesn't break the repair", () => {
  const full = JSON.stringify([item(1), { ...item(2), summary: "Nowy format {beta} w Ads Managerze i więcej" }]);
  const cut = full.slice(0, full.indexOf("{beta}") + 6);
  const { parsed, repaired } = parseItemsJson(cut);
  assert.equal(repaired, true);
  assert.deepEqual(
    parsed.map((p) => p.title),
    ["Tytuł 1"]
  );
});

test("no array at all, or one cut before the first item closes, gives nothing", () => {
  assert.deepEqual(parseItemsJson("Nie znalazłem nic nowego.").parsed, []);
  assert.deepEqual(parseItemsJson('[{"published":"2026-11-06","title":"Tyt').parsed, []);
});

test("fresh items are kept, stale ones dropped, fields cleaned and capped", () => {
  const parsed = [
    item(1),
    item(2, "2026-10-01"),
    { ...item(3), title: "Meta – nowość — test", source_url: "javascript:alert(1)" },
    { title: "bez podsumowania" },
  ];
  const { items, dropped_stale, date_gate_bypassed } = normalizeItems(parsed, "meta", "2026-11-07", "2026-10-24");
  assert.deepEqual(
    items.map((i) => i.title),
    ["Tytuł 1", "Meta - nowość - test"]
  );
  assert.equal(items[1].source_url, null);
  assert.equal(items[0].category, "meta");
  assert.equal(dropped_stale, 1);
  assert.equal(date_gate_bypassed, false);
});

test("when every item fails the date gate they are kept rather than leaving the category empty", () => {
  const { items, date_gate_bypassed } = normalizeItems([item(1, "2026-09-01"), item(2, "")], "ai", "2026-11-07", "2026-10-24");
  assert.equal(items.length, 2);
  assert.equal(date_gate_bypassed, true);
});

test("at most MAX_PER_CATEGORY items per category", () => {
  const parsed = Array.from({ length: MAX_PER_CATEGORY + 3 }, (_, i) => item(i));
  assert.equal(normalizeItems(parsed, "google", "2026-11-07", "2026-10-24").items.length, MAX_PER_CATEGORY);
});
