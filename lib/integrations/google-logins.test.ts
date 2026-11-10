import assert from "node:assert/strict";
import { test } from "node:test";

import { candidateLoginIds, managerLoginsOf } from "./google-logins.ts";

test("accounts listed under a manager remember it", () => {
  assert.deepEqual(
    managerLoginsOf([
      { id: "123-456-7890", login_customer_id: "111-222-3333" },
      { id: "5555555555" }, // direct access
      { id: "777", login_customer_id: "777" }, // itself: nothing to add
      null,
    ]),
    [["1234567890", "1112223333"]]
  );
  assert.deepEqual(managerLoginsOf({ propertyId: "1" }), []);
  assert.deepEqual(managerLoginsOf(null), []);
});

test("the account first, then its manager, then the agency MCC", () => {
  assert.deepEqual(candidateLoginIds("1", undefined, undefined), ["1"]);
  assert.deepEqual(candidateLoginIds("1", undefined, "9"), ["1", "9"]);
  assert.deepEqual(candidateLoginIds("1", "5", "9"), ["1", "5", "9"]);
  // The manager IS the agency MCC: tried once.
  assert.deepEqual(candidateLoginIds("1", "9", "9"), ["1", "9"]);
  assert.deepEqual(candidateLoginIds("9", undefined, "9"), ["9"]);
});
