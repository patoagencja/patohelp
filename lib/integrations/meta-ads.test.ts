import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AD_ACCOUNT_TOO_MANY_CALLS,
  describeThrottle,
  MetaThrottledError,
  throttleScope,
} from "./meta-ads.ts";

test("code 4 is the app-wide limit", () => {
  assert.equal(throttleScope(4, 400), "app");
});

test("code 17 without the per-account subcode is the token's limit", () => {
  assert.equal(throttleScope(17, 400), "user");
  assert.equal(throttleScope(17, 400, null), "user");
  assert.equal(throttleScope(17, 400, 1234), "user");
});

test("code 17 / 2446079 (ad account has too many calls) skips only that account", () => {
  assert.equal(AD_ACCOUNT_TOO_MANY_CALLS, 2446079);
  assert.equal(throttleScope(17, 400, 2446079), "account");
  // The subcode means one account whatever code carries it.
  assert.equal(throttleScope(80004, 400, 2446079), "account");
});

test("business use case, call-type and page limits are per account", () => {
  for (const code of [32, 613, 80000, 80004, 80014]) {
    assert.equal(throttleScope(code, 400), "account", `code ${code}`);
  }
  assert.equal(throttleScope(80015, 400), null);
});

test("a bare HTTP 429 is treated as one account's limit", () => {
  assert.equal(throttleScope(0, 429), "account");
});

test("other errors are not throttles", () => {
  assert.equal(throttleScope(190, 400), null); // expired token
  assert.equal(throttleScope(100, 400, 33), null); // bad id
  assert.equal(throttleScope(0, 500), null);
});

test("the throttle note carries the subcode and the wait", () => {
  const err = new MetaThrottledError("too many calls", 17, "account", 5 * 60_000, 2446079);
  assert.equal(err.subcode, 2446079);
  assert.match(describeThrottle(err), /kod 17\/2446079, dostęp za ~5 min/);
  assert.match(describeThrottle(new MetaThrottledError("x", 4, "app", null)), /kod 4\)/);
});
