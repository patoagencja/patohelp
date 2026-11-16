import assert from "node:assert/strict";
import { test } from "node:test";

import { isSessionAllowed, isShareViewerEmail, mayRequestLoginLink } from "./login-policy.ts";
import {
  hashSharePassword,
  newSharePassword,
  newShareSecret,
  parseShareToken,
  sha256Hex,
  shareMetaOf,
  shareSecretMatches,
  shareTokenOf,
  verifySharePassword,
} from "./share-link.ts";

const USER = "3f2b8c1e-9a4d-4e7b-8c21-5d6f7a8b9c0d";

test("password: typed back with any dashes or capitals, wrong ones fail", () => {
  const pw = newSharePassword();
  assert.match(pw, /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
  const stored = hashSharePassword(pw);
  assert.equal(verifySharePassword(pw, stored), true);
  assert.equal(verifySharePassword(pw.replace(/-/g, "").toUpperCase(), stored), true);
  assert.equal(verifySharePassword(` ${pw} `, stored), true);
  assert.equal(verifySharePassword("aaaa-bbbb-cccc", stored), false);
  assert.equal(verifySharePassword(pw, "plain"), false);
  // Same password, new salt: hashes differ.
  assert.notEqual(hashSharePassword(pw), stored);
});

test("token: account id + secret, anything else is refused", () => {
  const secret = newShareSecret();
  assert.deepEqual(parseShareToken(shareTokenOf(USER, secret)), { userId: USER, secret });
  assert.equal(parseShareToken(USER), null);
  assert.equal(parseShareToken(`${USER}.short`), null);
  assert.equal(parseShareToken(`not-a-uuid.${secret}`), null);
  assert.equal(parseShareToken(`${USER}.${secret}/../x`), null);
});

test("secret is compared by hash, the stored meta must be complete", () => {
  const secret = newShareSecret();
  const meta = shareMetaOf({
    share: { client_id: "c1", secret_sha256: sha256Hex(secret), password_hash: "scrypt$a$b", created_at: "x" },
  });
  assert.ok(meta);
  assert.equal(shareSecretMatches(secret, meta), true);
  assert.equal(shareSecretMatches(newShareSecret(), meta), false);
  assert.equal(shareMetaOf({ share: { client_id: "c1" } }), null);
  assert.equal(shareMetaOf(null), null);
});

test("link account: a session only for the one client it was made for, never an e-mail link", () => {
  const email = "elf-1a2b3c4d@link.patoagencja.com";
  assert.equal(isShareViewerEmail(email), true);
  assert.equal(isShareViewerEmail("daniel@patoagencja.com"), false);
  const user = { email, app_metadata: { share: { client_id: "c1" } } };
  // Works with client logins switched off ("" = CLIENT_LOGIN_ENABLED unset).
  assert.equal(isSessionAllowed(user, { role: "client", client_id: "c1" }, "", ""), true);
  // Seat moved elsewhere or taken away: no session.
  assert.equal(isSessionAllowed(user, { role: "client", client_id: "c2" }, "", ""), false);
  assert.equal(isSessionAllowed(user, { role: "client", client_id: null }, "", ""), false);
  // No share record (someone else's account on that domain): no session.
  assert.equal(isSessionAllowed({ email }, { role: "client", client_id: "c1" }, "", "1"), false);
  // The login form never mails it, even with client logins on.
  assert.equal(
    mayRequestLoginLink(email, { profiles: [{ email, role: "client", client_id: "c1" }] }, "", "1"),
    false
  );
});
