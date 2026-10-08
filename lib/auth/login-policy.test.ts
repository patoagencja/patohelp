import assert from "node:assert/strict";
import { test } from "node:test";

import { allowedLoginDomains, isLoginAllowed } from "./login-policy.ts";

test("only agency addresses by default", () => {
  assert.equal(isLoginAllowed("daniel@patoagencja.com", ""), true);
  assert.equal(isLoginAllowed("Piotr@PatoAgencja.com", ""), true);
  assert.equal(isLoginAllowed("jan@dre.pl", ""), false);
  assert.equal(isLoginAllowed("x@patoagencja.com.evil.pl", ""), false);
  assert.equal(isLoginAllowed("patoagencja.com", ""), false);
  assert.equal(isLoginAllowed(null, ""), false);
});

test("the env list widens it, * opens it", () => {
  assert.deepEqual(allowedLoginDomains("patoagencja.com, @dre.pl"), ["patoagencja.com", "dre.pl"]);
  assert.equal(isLoginAllowed("jan@dre.pl", "patoagencja.com,dre.pl"), true);
  assert.equal(isLoginAllowed("jan@dre.pl", "*"), true);
});
