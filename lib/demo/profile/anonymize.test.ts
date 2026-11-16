import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { channelOf } from "../../ecom/channel.ts";
import { marketOf } from "../../season/markets.ts";
import {
  assertDemoProfileClean,
  buildDemoProfile,
  campaignTypeOf,
  DEMO_BANDS,
  findForeignValues,
  parseDemoProfile,
  profileKpis,
  PROFILE_DAYS,
  type DemoProfile,
  type RawSource,
} from "./anonymize.ts";
import { fakeRawSource } from "./fixture.ts";

// The same random source the snapshot action uses.
const random = () => randomInt(0, 2 ** 40) / 2 ** 40;
const deps = { marketOf, channelOf, random };

/** Every string anywhere in a value (object keys included). */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      strings(v, out);
    }
  }
  return out;
}

/** Rows stuffed with identifying text in every field that takes text. */
function leakyRaw(): RawSource {
  const raw = fakeRawSource("2026-11-15");
  const secret = "SEKRETNA-MARKA";
  raw.ads = raw.ads.map((r, i) => ({
    ...r,
    campaignId: `${secret}-id-${r.campaignId}`,
    campaignName: `${r.campaignName} | ${secret} | https://${secret.toLowerCase()}.example/promo?id=${i % 7}`,
  }));
  raw.ga4Sources = [
    ...raw.ga4Sources,
    { sourceMedium: `${secret.toLowerCase()}.example / referral`, sessions: 900, revenue: 120_000, transactions: 7 },
    { sourceMedium: "partner-site.example / affiliate", sessions: 400, revenue: 50_000, transactions: 3 },
  ];
  raw.ga4Devices = [...raw.ga4Devices, { device: `${secret} smart fridge`, sessions: 5 }];
  raw.ga4Pages = raw.ga4Pages.map((p) => ({ ...p, path: `/${secret.toLowerCase()}${p.path}` }));
  raw.items = raw.items.map((it) => ({ ...it, itemId: `${secret}-${it.itemId}`, itemName: `${it.itemName} ${secret}` }));
  raw.shopSales = raw.shopSales.map((s, i) => ({
    ...s,
    market: i % 11 === 0 ? `${secret}-land` : s.market,
    product: i % 5 === 0 ? `Produkt ${secret} https://${secret.toLowerCase()}.example/p/${i}` : s.product,
  }));
  return raw;
}

const window30 = (p: DemoProfile) => p.days.slice(-30);
const sumOf = (days: DemoProfile["days"], pick: (d: DemoProfile["days"][number]) => number) =>
  days.reduce((s, d) => s + pick(d), 0);

describe("demo profile anonymizer", () => {
  const raw = leakyRaw();
  const profile = buildDemoProfile(raw, deps);
  const json = JSON.stringify(profile);

  test("keeps no string outside the whitelist", () => {
    assert.deepEqual(findForeignValues(profile), []);
    assert.doesNotThrow(() => assertDemoProfileClean(profile));
  });

  test("no source text survives: names, ids, paths, URLs, products, markets", () => {
    const lower = json.toLowerCase();
    for (const bad of ["sekretna", "http", "example", "fikcyjn", "/", "kowalski", "@", "sku", "fk-", "1840021", "23850001", "utm", "koszyk", "weihnacht"]) {
      assert.ok(!lower.includes(bad), `profile contains "${bad}"`);
    }
    // Strings are dates, timestamps or whitelisted enums - nothing longer.
    for (const s of strings(profile)) {
      assert.ok(/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/.test(s) || /^[A-Za-z0-9_]{2,16}$/.test(s), `unexpected string ${s}`);
    }
  });

  test("the demo's own KPIs land in the electronics bands", () => {
    for (let i = 0; i < 25; i++) {
      const k = profileKpis(buildDemoProfile(fakeRawSource(), deps));
      assert.ok(k.aov !== null && k.aov >= DEMO_BANDS.aov[0] && k.aov <= DEMO_BANDS.aov[1], `AOV ${k.aov}`);
      assert.ok(k.cpc !== null && k.cpc >= DEMO_BANDS.cpc[0] && k.cpc <= DEMO_BANDS.cpc[1], `CPC ${k.cpc}`);
      assert.ok(k.cr !== null && k.cr >= DEMO_BANDS.cr[0] && k.cr <= DEMO_BANDS.cr[1], `CR ${k.cr}`);
      assert.ok(k.roas !== null && k.roas > 1, `ROAS ${k.roas}`);
    }
  });

  test("two snapshots of the same input scale differently", () => {
    const a = buildDemoProfile(fakeRawSource(), deps);
    const b = buildDemoProfile(fakeRawSource(), deps);
    const revenue = (p: DemoProfile) => sumOf(window30(p), (d) => d.revenue ?? 0);
    const spend = (p: DemoProfile) => sumOf(window30(p), (d) => d.meta.spend + d.google.spend);
    const sessions = (p: DemoProfile) => sumOf(window30(p), (d) => d.sessions ?? 0);
    assert.notEqual(revenue(a), revenue(b));
    assert.notEqual(spend(a), spend(b));
    assert.notEqual(sessions(a), sessions(b));
  });

  test("one factor per kind, so the days keep their shape", () => {
    const rawDays = new Map(raw.ga4Days.map((d) => [d.date, d]));
    const factor = (date: string, pick: (r: RawSource["ga4Days"][number]) => number, stored: (d: DemoProfile["days"][number]) => number) =>
      stored(profile.days.find((d) => d.date === date)!) / pick(rawDays.get(date)!);
    for (const [pick, stored] of [
      [(r: RawSource["ga4Days"][number]) => r.revenue ?? 0, (d: DemoProfile["days"][number]) => d.revenue ?? 0],
      [(r: RawSource["ga4Days"][number]) => r.sessions, (d: DemoProfile["days"][number]) => d.sessions ?? 0],
    ] as const) {
      const a = factor("2026-10-02", pick, stored);
      const b = factor("2026-11-14", pick, stored);
      assert.ok(Math.abs(a / b - 1) < 0.01, `factor drifts: ${a} vs ${b}`);
      assert.ok(Math.abs(a - 1) > 0.05, "values must not be stored as they are");
    }
  });

  test("the stored profile holds no factor or raw-total field", () => {
    const keys = new Set(strings(profile).filter((s) => /^[a-z][A-Za-z]+$/.test(s)));
    for (const k of keys) assert.ok(!/factor|scale|raw|real|total|money|traffic|multiplier/i.test(k), `field ${k}`);
    assert.deepEqual(Object.keys(profile).sort(), [
      "campaigns", "channels", "countries", "countriesBasis", "createdAt", "days", "devices", "lastYear",
      "pages", "products", "productsCoverage", "revenueSource", "snapshotDate", "version",
    ]);
  });

  test("provider totals are the sums of the stored campaigns, long tail folded", () => {
    assert.equal(profile.days.length, PROFILE_DAYS);
    profile.days.forEach((d, i) => {
      for (const [provider, key] of [["meta_ads", "meta"], ["google_ads", "google"]] as const) {
        const own = profile.campaigns.filter((c) => c.provider === provider);
        assert.equal(d[key].spend, own.reduce((s, c) => s + c.spend[i], 0));
        assert.equal(d[key].clicks, own.reduce((s, c) => s + c.clicks[i], 0));
      }
    });
    assert.ok(profile.campaigns.filter((c) => c.provider === "google_ads").length <= 9);
    assert.ok(profile.campaigns.some((c) => c.type === "OTHER" && c.market === null));
  });

  test("enums come from the classifiers, checked against the whitelists", () => {
    assert.ok(profile.campaigns.some((c) => c.type === "PMAX" && c.market === "DE"));
    assert.ok(profile.campaigns.some((c) => c.type === "RETARGETING"));
    assert.ok(profile.countries.every((c) => /^[A-Z]{2}$/.test(c.country)));
    assert.equal(profile.countriesBasis, "shop");
    assert.ok(profile.devices.every((d) => ["desktop", "mobile", "tablet"].includes(d.device)));
    assert.ok(profile.channels.some((c) => c.channel === "other"));
    assert.equal(campaignTypeOf("google_ads", "PL | Performance Max | x"), "PMAX");
    assert.equal(campaignTypeOf("meta_ads", "Remarketing koszyk"), "RETARGETING");
  });

  test("last year covers the same weeks plus the season ahead", () => {
    assert.ok(profile.lastYear.length > 100);
    assert.equal(profile.lastYear[0].date, "2025-09-15");
    assert.ok(profile.lastYear.some((d) => d.date === "2025-11-28"));
  });

  test("a bad classifier answer cannot smuggle text in", () => {
    const evil = buildDemoProfile(fakeRawSource(), {
      marketOf: () => "Sekretna Marka sp. z o.o.",
      channelOf: () => "https://evil.example",
      random,
    });
    assert.deepEqual(findForeignValues(evil), []);
    assert.ok(evil.campaigns.every((c) => c.market === null));
    assert.ok(evil.channels.every((c) => c.channel === "other"));
  });

  test("parseDemoProfile accepts the profile and rejects tampered ones", () => {
    assert.ok(parseDemoProfile(JSON.parse(json)));
    const tampered = JSON.parse(json);
    tampered.days[3].note = "nazwa kampanii";
    assert.equal(parseDemoProfile(tampered), null);
    const renamed = JSON.parse(json);
    renamed.campaigns[0].type = "Kampania Sekretna";
    assert.equal(parseDemoProfile(renamed), null);
    assert.equal(parseDemoProfile({ ...JSON.parse(json), version: 2 }), null);
  });

  test("the committed dev profile is clean, readable and in the bands", () => {
    const dev = JSON.parse(readFileSync(new URL("./dev-profile.json", import.meta.url), "utf8"));
    assert.ok(parseDemoProfile(dev));
    assert.deepEqual(findForeignValues(dev), []);
    const k = profileKpis(dev);
    assert.ok(k.aov! >= DEMO_BANDS.aov[0] && k.aov! <= DEMO_BANDS.aov[1]);
  });
});
