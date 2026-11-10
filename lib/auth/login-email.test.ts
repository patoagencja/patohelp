import assert from "node:assert/strict";
import { test } from "node:test";

import { buildLoginEmail } from "./login-email.ts";

test("a requested login link keeps its wording", () => {
  const mail = buildLoginEmail({ link: "https://app.example/auth/callback?token_hash=x&type=magiclink", email: "a@b.pl" });
  assert.equal(mail.subject, "Twój link do panelu Kaleido");
  assert.match(mail.html, /Zaloguj się jednym kliknięciem/);
  assert.doesNotMatch(mail.text, /Link wygasł\?/);
});

test("an invitation names the client and says where a fresh link comes from", () => {
  const mail = buildLoginEmail({
    link: "https://app.example/auth/callback?token_hash=x&type=invite",
    email: "jan@dre.pl",
    invite: { clientName: "Okna <Łódź> & Co", loginUrl: "https://app.example/login" },
  });
  assert.equal(mail.subject, "Zaproszenie do panelu Kaleido - Okna <Łódź> & Co");
  // Escaped in HTML (title, intro), plain in the text part.
  assert.match(mail.html, /Okna &lt;Łódź&gt; &amp; Co/);
  assert.doesNotMatch(mail.html, /Okna <Łódź>/);
  assert.match(mail.text, /panelu Okna <Łódź> & Co/);
  assert.match(mail.text, /https:\/\/app\.example\/login/);
  assert.match(mail.html, /type=invite/);
});
