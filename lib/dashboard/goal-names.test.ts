import assert from "node:assert/strict";
import { test } from "node:test";

import { daysLeftText, distinctAdsetName } from "./goal-names.ts";

const CAMPAIGN = "OLX-PL | BRAND | SERVICES | LIST | TRAFF | Ogloszenia | v1 | 10.2026 | FB | PATO";

test("ad set names drop the campaign name they repeat", () => {
  assert.equal(
    distinctAdsetName(`${CAMPAIGN} | STATICS | B - Auto / Motoryzacja | EPA`, CAMPAIGN),
    "STATICS | B - Auto / Motoryzacja | EPA"
  );
});

test("unrelated or identical names stay as they are", () => {
  assert.equal(distinctAdsetName("Remarketing 30 dni", CAMPAIGN), "Remarketing 30 dni");
  assert.equal(distinctAdsetName(CAMPAIGN, CAMPAIGN), CAMPAIGN);
  assert.equal(distinctAdsetName("OLX-PL | Inne", CAMPAIGN), "OLX-PL | Inne");
});

test("days left: the verb agrees with the number (a goal's last day is \"został 1 dzień\")", () => {
  assert.equal(daysLeftText(1), "został 1 dzień");
  assert.equal(daysLeftText(2), "zostały 2 dni");
  assert.equal(daysLeftText(4), "zostały 4 dni");
  assert.equal(daysLeftText(5), "zostało 5 dni");
  assert.equal(daysLeftText(12), "zostało 12 dni");
  assert.equal(daysLeftText(22), "zostały 22 dni");
  assert.equal(daysLeftText(25), "zostało 25 dni");
});
