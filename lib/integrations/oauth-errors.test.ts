import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isOAuthFailureReason,
  oauthDoneUrl,
  oauthFailureMessage,
  oauthFailureReason,
} from "./oauth-errors.ts";

test("provider errors map to a reason", () => {
  assert.equal(oauthFailureReason(null), null);
  assert.equal(oauthFailureReason(""), null);
  // Google: consent cancelled, or "Ta aplikacja jest zablokowana".
  assert.equal(oauthFailureReason("access_denied"), "denied");
  assert.equal(oauthFailureReason("admin_policy_enforced"), "blocked");
  assert.equal(oauthFailureReason("access_denied", "admin_policy_enforced"), "blocked");
  assert.equal(oauthFailureReason("org_internal"), "blocked");
  // Meta: error=access_denied&error_reason=user_denied.
  assert.equal(oauthFailureReason("access_denied", "user_denied"), "denied");
  assert.equal(oauthFailureReason("server_error"), "provider");
});

test("a failed flow never lands on another client's settings", () => {
  const origin = "https://app.example";
  // Unknown client (state lost): the agency list, not /dre/settings.
  assert.equal(
    oauthDoneUrl(origin, { returnTo: "settings", slug: null, provider: "ga4", ok: false, reason: "state" }),
    "https://app.example/clients?conn_error=ga4&conn_reason=state#polaczenia"
  );
  assert.equal(
    oauthDoneUrl(origin, { returnTo: "settings", slug: "okna-lodz", provider: "ga4", ok: false, reason: "blocked" }),
    "https://app.example/okna-lodz/settings?error=ga4&reason=blocked"
  );
  assert.equal(
    oauthDoneUrl(origin, { returnTo: "settings", slug: "okna-lodz", provider: "meta_ads", ok: false }),
    "https://app.example/okna-lodz/settings?error=meta_ads"
  );
  assert.equal(
    oauthDoneUrl(origin, { returnTo: "settings", slug: "okna-lodz", provider: "meta_ads", ok: true, fixed: 2 }),
    "https://app.example/okna-lodz/settings?connected=meta_ads&fixed=2"
  );
  assert.equal(
    oauthDoneUrl(origin, { returnTo: "clients", slug: "dre", provider: "google_ads", ok: true }),
    "https://app.example/clients?reconnected=google_ads#polaczenia"
  );
  assert.equal(
    oauthDoneUrl(origin, { returnTo: "clients", slug: "dre", provider: "google_ads", ok: false, reason: "denied" }),
    "https://app.example/clients?conn_error=google_ads&conn_reason=denied#polaczenia"
  );
});

test("a Workspace block explains the admin fix (and the service account for GA4)", () => {
  const ga4 = oauthFailureMessage("ga4", "blocked");
  assert.match(ga4.title, /zablokowana/);
  assert.match(ga4.description ?? "", /admin\.google\.com/);
  assert.match(ga4.description ?? "", /konto usługi/);
  const ads = oauthFailureMessage("google_ads", "blocked");
  assert.match(ads.description ?? "", /admin\.google\.com/);
  assert.doesNotMatch(ads.description ?? "", /konto usługi/);
  // access_denied can be either a cancel or the block: both are explained.
  const denied = oauthFailureMessage("ga4", "denied");
  assert.match(denied.description ?? "", /admin\.google\.com/);
  assert.match(denied.description ?? "", /jeszcze raz/);
});

test("other reasons get their own Polish message, unknown ones the generic one", () => {
  assert.match(oauthFailureMessage("meta_ads", "denied").title, /Meta Ads/);
  assert.doesNotMatch(oauthFailureMessage("meta_ads", "denied").description ?? "", /admin\.google/);
  assert.match(oauthFailureMessage("tiktok_ads", "state").title, /TikTok Ads/);
  assert.match(oauthFailureMessage("ga4", "no_access").title, /GA4/);
  assert.match(oauthFailureMessage("google_ads", "no_access").title, /Google Ads/);
  assert.deepEqual(oauthFailureMessage("ga4", null), {
    title: "Nie udało się połączyć z Google Analytics 4. Spróbuj ponownie.",
  });
  // A crafted ?reason= is not echoed.
  assert.deepEqual(oauthFailureMessage("ga4", "<script>"), oauthFailureMessage("ga4", null));
  assert.equal(isOAuthFailureReason("blocked"), true);
  assert.equal(isOAuthFailureReason("nope"), false);
});
