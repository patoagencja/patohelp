import assert from "node:assert/strict";
import { test } from "node:test";

import {
  allowedLoginDomains,
  hasClientInvitation,
  hasClientSeat,
  isLoginAllowed,
  isSessionAllowed,
  mayRequestLoginLink,
} from "./login-policy.ts";

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

test("a client seat needs the client role and an assigned client", () => {
  assert.equal(hasClientSeat({ role: "client", client_id: "c1" }), true);
  assert.equal(hasClientSeat({ role: "client", client_id: null }), false);
  assert.equal(hasClientSeat({ role: "client", client_id: "" }), false);
  // Agency roles are governed by the domain rule, not by a seat.
  assert.equal(hasClientSeat({ role: "admin", client_id: "c1" }), false);
  assert.equal(hasClientSeat(null), false);
});

test("only an exact CLIENT invitation counts", () => {
  const rows = [
    { email: "Jan@Dre.pl", role: "client" },
    { email: "boss@dre.pl", role: "member" },
  ];
  assert.equal(hasClientInvitation(rows, "jan@dre.pl"), true);
  assert.equal(hasClientInvitation(rows, " JAN@dre.pl "), true);
  // ilike can still return near matches: the comparison is exact.
  assert.equal(hasClientInvitation([{ email: "jan@dre.pl", role: "client" }], "jan@dre.p"), false);
  // A hand-made agency-role invitation does not open the login to a foreign domain.
  assert.equal(hasClientInvitation(rows, "boss@dre.pl"), false);
  assert.equal(hasClientInvitation(null, "jan@dre.pl"), false);
});

test("login link: agency domains or invited addresses, no open sign-up", () => {
  const none = { invitations: [], profiles: [] };
  assert.equal(mayRequestLoginLink("daniel@patoagencja.com", none, ""), true);
  assert.equal(mayRequestLoginLink("stranger@gmail.com", none, ""), false);
  // Pending invitation (first login).
  assert.equal(
    mayRequestLoginLink("jan@dre.pl", { invitations: [{ email: "jan@dre.pl", role: "client" }] }, ""),
    true
  );
  // Accepted: the account holds a seat.
  assert.equal(
    mayRequestLoginLink(
      "jan@dre.pl",
      { profiles: [{ email: "jan@dre.pl", role: "client", client_id: "c1" }] },
      ""
    ),
    true
  );
  // Access taken away ("Odbierz dostęp" clears the seat and the invitation).
  assert.equal(
    mayRequestLoginLink(
      "jan@dre.pl",
      { invitations: [], profiles: [{ email: "jan@dre.pl", role: "client", client_id: null }] },
      ""
    ),
    false
  );
  // Someone else's seat does not count for this address.
  assert.equal(
    mayRequestLoginLink(
      "eve@dre.pl",
      { profiles: [{ email: "jan@dre.pl", role: "client", client_id: "c1" }] },
      ""
    ),
    false
  );
});

test("session: agency domains, or a verified client user with a seat", () => {
  const seat = { role: "client", client_id: "c1" };
  const verified = { email: "jan@dre.pl", email_confirmed_at: "2026-11-01T10:00:00Z" };
  assert.equal(isSessionAllowed({ email: "daniel@patoagencja.com" }, null, ""), true);
  assert.equal(isSessionAllowed(verified, seat, ""), true);
  // Unverified address: the seat may sit on an account someone else
  // registered with that e-mail - no session until the link is clicked.
  assert.equal(isSessionAllowed({ email: "jan@dre.pl", email_confirmed_at: null }, seat, ""), false);
  assert.equal(isSessionAllowed(verified, { role: "client", client_id: null }, ""), false);
  assert.equal(isSessionAllowed(verified, null, ""), false);
  // An agency role on a foreign domain still needs LOGIN_ALLOWED_DOMAINS.
  assert.equal(isSessionAllowed(verified, { role: "admin", client_id: null }, ""), false);
  assert.equal(
    isSessionAllowed(verified, { role: "admin", client_id: null }, "patoagencja.com,dre.pl"),
    true
  );
});
