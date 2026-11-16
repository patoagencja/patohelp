// GA4 source / medium -> the sales channel the Sprzedaż tab groups by.
// Import-free on purpose: the demo profile's anonymizer (lib/demo/profile)
// runs it under Node's type stripping in unit tests, and lib/ecom/insights.ts
// re-exports it for everything else.

export type ChannelKey =
  | "meta"
  | "google_ads"
  | "tiktok"
  | "organic_search"
  | "social_organic"
  | "direct"
  | "email"
  | "other";

const PAID_MEDIUM = /(cpc|ppc|paid|cpm|cpv|cpa|ads|display|retargeting|remarketing)/;

export function channelOf(sourceMedium: string): ChannelKey {
  const sm = sourceMedium.toLowerCase();
  const [source = "", medium = ""] = sm.split("/").map((s) => s.trim());
  const paid = PAID_MEDIUM.test(medium);

  if (/(facebook|instagram|^fb$|^ig$|meta|^an$|messenger)/.test(source)) {
    return paid ? "meta" : "social_organic";
  }
  if (source.includes("tiktok")) return paid ? "tiktok" : "social_organic";
  if (/(google|youtube)/.test(source) && (paid || medium === "pmax")) {
    return "google_ads";
  }
  if (medium === "organic") return "organic_search";
  if (source === "(direct)") return "direct";
  if (/(email|newsletter|mail)/.test(medium) || /(klaviyo|mailchimp|getresponse|freshmail|newsletter)/.test(source)) {
    return "email";
  }
  if (/(social|linkedin|pinterest|twitter|x\.com|youtube)/.test(sm)) {
    return "social_organic";
  }
  return "other";
}
