import assert from "node:assert/strict";
import { test } from "node:test";

import { clientSlugProblem, MAX_SLUG_LENGTH, normalizeClientSlug } from "./slug.ts";

test("plain slugs pass through", () => {
  assert.equal(normalizeClientSlug("dre"), "dre");
  assert.equal(normalizeClientSlug("  DRE 2025 "), "dre-2025");
  assert.equal(normalizeClientSlug("olx-sm"), "olx-sm");
});

test("a pasted website becomes its name", () => {
  assert.equal(normalizeClientSlug("https://www.olx.pl"), "olx");
  assert.equal(normalizeClientSlug("https://www.olx.pl/oferty?x=1"), "olx");
  assert.equal(normalizeClientSlug("dre.pl"), "dre");
  assert.equal(normalizeClientSlug("firma.com.pl"), "firma");
  assert.equal(normalizeClientSlug("http://sklep.elfi.de/"), "sklep");
});

test("Polish letters are transliterated, not dropped", () => {
  assert.equal(normalizeClientSlug("Łódź Okna"), "lodz-okna");
  assert.equal(normalizeClientSlug("Żółta Kawa"), "zolta-kawa");
  assert.equal(normalizeClientSlug("Zażółć gęślą jaźń"), "zazolc-gesla-jazn");
  assert.equal(normalizeClientSlug("ĄĆĘŁŃÓŚŹŻ"), "acelnoszz");
});

test("a company name with dots keeps its words", () => {
  assert.equal(normalizeClientSlug("Kowalski i S.A."), "kowalski-i-s-a");
  assert.equal(normalizeClientSlug("Firma Sp.zoo"), "firma-sp-zoo");
});

test("nothing usable, reserved routes and length", () => {
  assert.equal(normalizeClientSlug("!!!"), "");
  assert.equal(clientSlugProblem(""), "empty");
  assert.equal(clientSlugProblem(normalizeClientSlug("Clients")), "reserved");
  assert.equal(clientSlugProblem(normalizeClientSlug("login")), "reserved");
  assert.equal(clientSlugProblem("demo-full"), "reserved");
  assert.equal(clientSlugProblem("dre"), null);
  const long = normalizeClientSlug("a".repeat(30) + " " + "b".repeat(30));
  assert.ok(long.length <= MAX_SLUG_LENGTH);
  assert.ok(!long.endsWith("-"));
});
