import assert from "node:assert/strict";
import { test } from "node:test";

import { extractConversions, extractPurchases } from "./meta-ads.ts";

const a = (action_type: string, value: number) => ({ action_type, value: String(value) });

test("a lead counted under three types is one lead, page views are not conversions", () => {
  assert.equal(
    extractConversions([
      a("lead", 12),
      a("onsite_conversion.lead_grouped", 12),
      a("onsite_conversion.post_save", 3),
      a("offsite_conversion.fb_pixel_view_content", 400),
      a("link_click", 900),
    ]),
    12
  );
});

test("different kinds of conversions add up", () => {
  assert.equal(
    extractConversions([
      a("lead", 5),
      a("onsite_conversion.messaging_conversation_started_7d", 20),
      a("onsite_conversion.total_messaging_connection", 33),
      a("offsite_conversion.fb_pixel_purchase", 2),
      a("omni_purchase", 3),
    ]),
    28
  );
});

test("purchases take the broadest type", () => {
  assert.deepEqual(
    extractPurchases([a("omni_purchase", 3), a("offsite_conversion.fb_pixel_purchase", 2)], [a("omni_purchase", 300)]),
    { purchases: 3, value: 300 }
  );
});
