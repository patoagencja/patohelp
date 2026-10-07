import assert from "node:assert/strict";
import { test } from "node:test";

import { distinctAdsetName } from "./goal-names.ts";

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
