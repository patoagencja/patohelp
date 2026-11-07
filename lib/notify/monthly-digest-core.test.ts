import assert from "node:assert/strict";
import { test } from "node:test";

import {
  compareMonths,
  historyCovers,
  inMonthPl,
  isMonthlyDigestDue,
  monthNamePl,
  monthRangePl,
  monthRatio,
  overlapDays,
  phraseMonthChange,
  pickBestAd,
  pickBestCampaign,
  previousMonth,
  shortRangePl,
  tidyName,
  warsawClock,
  type AdMonth,
  type CampaignMonth,
  type MonthTotals,
} from "./monthly-digest-core.ts";

// ---- month range ----

test("on 1 November the digest covers October, compared with September", () => {
  const m = previousMonth("2026-11-01");
  assert.equal(m.start, "2026-10-01");
  assert.equal(m.end, "2026-10-31");
  assert.equal(m.days, 31);
  assert.equal(m.prevStart, "2026-09-01");
  assert.equal(m.prevEnd, "2026-09-30");
  assert.equal(m.prevDays, 30);
  assert.equal(m.key, "monthly-digest-2026-10");
  assert.equal(m.claimDate, "2026-11-01");
});

test("the whole send window (and any later day) points at the same month and claim", () => {
  for (const day of ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-30"]) {
    const m = previousMonth(day);
    assert.equal(m.key, "monthly-digest-2026-10");
    assert.equal(m.claimDate, "2026-11-01");
  }
});

test("January reports December of the previous year, compared with November", () => {
  const m = previousMonth("2027-01-02");
  assert.equal(m.year, 2026);
  assert.equal(m.month, 12);
  assert.equal(m.start, "2026-12-01");
  assert.equal(m.end, "2026-12-31");
  assert.equal(m.prevStart, "2026-11-01");
  assert.equal(m.prevEnd, "2026-11-30");
  assert.equal(m.key, "monthly-digest-2026-12");
  assert.equal(m.claimDate, "2027-01-01");
});

test("February reports January and compares with December of the year before", () => {
  const m = previousMonth("2027-02-01");
  assert.equal(m.start, "2027-01-01");
  assert.equal(m.prevStart, "2026-12-01");
  assert.equal(m.prevEnd, "2026-12-31");
  assert.equal(m.prevYear, 2026);
});

test("leap years give February 29 days", () => {
  assert.equal(previousMonth("2028-03-01").end, "2028-02-29");
  assert.equal(previousMonth("2027-03-01").end, "2027-02-28");
  assert.equal(previousMonth("2028-03-01").prevDays, 31);
});

// ---- Warsaw clock ----

test("the Warsaw day starts an hour before UTC in winter", () => {
  // 31 Oct 23:30 UTC is already 1 November 00:30 in Warsaw (CET, UTC+1).
  const c = warsawClock(new Date("2026-10-31T23:30:00Z"));
  assert.deepEqual(c, { date: "2026-11-01", day: 1, hour: 0 });
  assert.equal(previousMonth(c.date).key, "monthly-digest-2026-10");
});

test("in summer Warsaw is two hours ahead of UTC", () => {
  // 31 Jul 22:15 UTC = 1 August 00:15 CEST.
  assert.deepEqual(warsawClock(new Date("2026-07-31T22:15:00Z")), {
    date: "2026-08-01",
    day: 1,
    hour: 0,
  });
  assert.equal(warsawClock(new Date("2026-08-01T06:00:00Z")).hour, 8);
});

test("New Year in Warsaw rolls the year back for the report", () => {
  const c = warsawClock(new Date("2026-12-31T23:05:00Z"));
  assert.equal(c.date, "2027-01-01");
  const m = previousMonth(c.date);
  assert.equal(m.start, "2026-12-01");
  assert.equal(m.prevStart, "2026-11-01");
});

test("midnight reads as hour 0, not 24", () => {
  assert.equal(warsawClock(new Date("2026-11-30T23:00:00Z")).hour, 0);
});

// ---- when to send ----

test("sends on days 1-3 from 8:00 until 19:59 only", () => {
  assert.equal(isMonthlyDigestDue({ day: 1, hour: 8 }), true);
  assert.equal(isMonthlyDigestDue({ day: 1, hour: 19 }), true);
  assert.equal(isMonthlyDigestDue({ day: 2, hour: 10 }), true);
  assert.equal(isMonthlyDigestDue({ day: 3, hour: 12 }), true);
  assert.equal(isMonthlyDigestDue({ day: 1, hour: 7 }), false);
  assert.equal(isMonthlyDigestDue({ day: 1, hour: 0 }), false);
  assert.equal(isMonthlyDigestDue({ day: 1, hour: 20 }), false);
  assert.equal(isMonthlyDigestDue({ day: 4, hour: 9 }), false);
  assert.equal(isMonthlyDigestDue({ day: 15, hour: 9 }), false);
  assert.equal(isMonthlyDigestDue({ day: 31, hour: 9 }), false);
});

test("a run missed on the 1st still sends on the 2nd (Warsaw time)", () => {
  // 2 Nov 07:00 UTC = 08:00 CET.
  assert.equal(isMonthlyDigestDue(warsawClock(new Date("2026-11-02T07:00:00Z"))), true);
  // 1 Nov 06:30 UTC = 07:30 CET - too early.
  assert.equal(isMonthlyDigestDue(warsawClock(new Date("2026-11-01T06:30:00Z"))), false);
});

// ---- Polish ----

test("month names in the forms the e-mail uses", () => {
  assert.equal(monthNamePl(10), "październik");
  assert.equal(monthNamePl(1), "styczeń");
  assert.equal(inMonthPl(10), "w październiku");
  assert.equal(inMonthPl(9), "we wrześniu");
  assert.equal(inMonthPl(2), "w lutym");
  assert.equal(inMonthPl(11), "w listopadzie");
  assert.equal(monthRangePl(previousMonth("2026-11-01")), "1–31 października 2026");
  assert.equal(monthRangePl(previousMonth("2028-03-01")), "1–29 lutego 2028");
  assert.equal(shortRangePl("2026-10-03", "2026-11-01"), "3.10–1.11");
});

// ---- deltas ----

test("months of equal length compare totals", () => {
  const r = monthRatio(1100, 1000, { kind: "count", days: 30, prevDays: 30 });
  assert.ok(r !== null && Math.abs(r - 0.1) < 1e-12);
});

test("months of different length compare daily averages", () => {
  // March 31 days vs February 28: the same 100 a day is no change.
  assert.equal(monthRatio(3100, 2800, { kind: "count", days: 31, prevDays: 28 }), 0);
  // October 31 vs September 30: 3100 vs 3000 is flat per day.
  assert.equal(monthRatio(3100, 3000, { kind: "count", days: 31, prevDays: 30 }), 0);
  // Ratios (CTR) don't depend on days.
  const ctr = monthRatio(2.2, 2, { kind: "ratio", days: 31, prevDays: 28 });
  assert.ok(ctr !== null && Math.abs(ctr - 0.1) < 1e-12);
});

test("no % from a thin or missing base, and zero this month is not -100%", () => {
  assert.equal(monthRatio(100, 0, { kind: "count" }), null);
  assert.equal(monthRatio(100, 40, { kind: "count", minPrev: 50 }), null);
  assert.equal(monthRatio(0, 400, { kind: "count" }), null);
  assert.equal(monthRatio(Number.NaN, 400, { kind: "count" }), null);
});

test("changes are phrased against the previous month by name", () => {
  assert.deepEqual(phraseMonthChange(0.123, 9, "more_is_good"), {
    ratio: 0.123,
    text: "o 12% więcej niż we wrześniu",
    tone: "good",
    direction: "up",
  });
  assert.equal(phraseMonthChange(-0.2, 9, "more_is_good")?.text, "o 20% mniej niż we wrześniu");
  assert.equal(phraseMonthChange(-0.2, 9, "more_is_good")?.tone, "bad");
  // Spend is a decision, not a result: direction shown, never judged.
  assert.equal(phraseMonthChange(0.5, 9, "neutral")?.tone, "flat");
  assert.equal(phraseMonthChange(0.5, 9, "neutral")?.direction, "up");
  assert.equal(phraseMonthChange(0.08, 10, "rate")?.text, "o 8% lepiej niż w październiku");
  assert.equal(phraseMonthChange(-0.08, 10, "rate")?.text, "o 8% słabiej niż w październiku");
  assert.equal(phraseMonthChange(0.02, 9, "more_is_good")?.text, "podobnie jak we wrześniu");
  assert.equal(phraseMonthChange(0.02, 9, "more_is_good")?.direction, "flat");
  assert.equal(phraseMonthChange(null, 9, "more_is_good"), null);
});

const totals = (t: Partial<MonthTotals>): MonthTotals => ({
  spend: 0,
  clicks: 0,
  impressions: 0,
  sessions: 0,
  sales: 0,
  purchases: 0,
  ...t,
});

test("compareMonths: per-day counts, relative CTR, coverage and thin bases", () => {
  const month = previousMonth("2026-11-01"); // Oct 31 days vs Sep 30
  const cur = totals({ spend: 310_000, clicks: 6_200, impressions: 200_000, sessions: 9_300 });
  const prev = totals({ spend: 300_000, clicks: 5_000, impressions: 200_000, sessions: 9_000 });
  const c = compareMonths(cur, prev, month, { ads: true, ga4: true });
  // 10 000 zł a day both months.
  assert.equal(c.spend?.text, "podobnie jak we wrześniu");
  // 200 vs ~166.7 clicks a day = +20%.
  assert.equal(c.clicks?.text, "o 20% więcej niż we wrześniu");
  assert.equal(c.sessions?.text, "podobnie jak we wrześniu");
  // CTR 3.1% vs 2.5% = +24%, not per-day.
  assert.equal(c.ctr?.text, "o 24% lepiej niż we wrześniu");
  // Engagement client: no sales anywhere.
  assert.equal(c.sales, null);

  const uncovered = compareMonths(cur, prev, month, { ads: false, ga4: true });
  assert.equal(uncovered.spend, null);
  assert.equal(uncovered.clicks, null);
  assert.equal(uncovered.ctr, null);
  assert.ok(uncovered.sessions);

  const thin = compareMonths(cur, totals({ spend: 5_000, clicks: 20, impressions: 900, sessions: 30 }), month, {
    ads: true,
    ga4: true,
  });
  assert.equal(thin.spend, null);
  assert.equal(thin.clicks, null);
  assert.equal(thin.ctr, null);
  assert.equal(thin.sessions, null);
});

test("compareMonths: shop sales need enough orders last month", () => {
  const month = previousMonth("2026-10-01"); // Sep 30 vs Aug 31
  const cur = totals({ sales: 3_000_000, purchases: 40 });
  assert.equal(
    compareMonths(cur, totals({ sales: 3_100_000, purchases: 9 }), month, { ads: true, ga4: true }).sales,
    null
  );
  const c = compareMonths(cur, totals({ sales: 3_100_000, purchases: 50 }), month, { ads: true, ga4: true });
  // 100 000 zł a day both months.
  assert.equal(c.sales?.text, "podobnie jak w sierpniu");
});

test("history must reach the first week of last month", () => {
  assert.equal(historyCovers("2026-09-01", "2026-09-01"), true);
  assert.equal(historyCovers("2026-09-08", "2026-09-01"), true);
  assert.equal(historyCovers("2026-09-09", "2026-09-01"), false);
  assert.equal(historyCovers(null, "2026-09-01"), false);
});

test("overlap of two date windows, inclusive", () => {
  assert.equal(overlapDays("2026-10-01", "2026-10-31", "2026-10-03", "2026-11-01"), 29);
  assert.equal(overlapDays("2026-10-01", "2026-10-31", "2026-11-01", "2026-11-30"), 0);
  assert.equal(overlapDays("2026-10-01", "2026-10-31", "2026-10-31", "2026-11-29"), 1);
});

// ---- picks ----

const camp = (c: Partial<CampaignMonth> & { campaignId: string }): CampaignMonth => ({
  provider: "meta_ads",
  name: c.campaignId,
  spend: 0,
  clicks: 0,
  impressions: 0,
  purchases: 0,
  sales: 0,
  ...c,
});

test("engagement: the best campaign brought the most clicks, CTR breaks ties", () => {
  const best = pickBestCampaign(
    [
      camp({ campaignId: "a", clicks: 500, impressions: 50_000 }),
      camp({ campaignId: "b", clicks: 900, impressions: 90_000 }),
      camp({ campaignId: "c", clicks: 900, impressions: 30_000, sales: 99_999 }),
    ],
    false
  );
  assert.equal(best?.campaign.campaignId, "c");
  assert.equal(best?.by, "clicks");
  assert.equal(pickBestCampaign([camp({ campaignId: "z", spend: 100 })], false), null);
});

test("shop: the best campaign sold the most, falls back to clicks without sales", () => {
  const rows = [
    camp({ campaignId: "a", clicks: 2000, sales: 100_000 }),
    camp({ campaignId: "b", clicks: 300, sales: 900_000 }),
  ];
  assert.equal(pickBestCampaign(rows, true)?.campaign.campaignId, "b");
  assert.equal(pickBestCampaign(rows, true)?.by, "sales");
  const noSales = rows.map((r) => ({ ...r, sales: 0 }));
  assert.equal(pickBestCampaign(noSales, true)?.campaign.campaignId, "a");
  assert.equal(pickBestCampaign(noSales, true)?.by, "clicks");
});

const ad = (a: Partial<AdMonth> & { adId: string }): AdMonth => ({
  name: a.adId,
  campaignName: null,
  spend: 0,
  clicks: 0,
  impressions: 0,
  purchases: 0,
  sales: 0,
  ...a,
});

test("engagement: the best ad has the highest CTR among ads with enough data", () => {
  const best = pickBestAd(
    [
      // 10% CTR on 500 impressions is luck.
      ad({ adId: "lucky", impressions: 500, clicks: 50 }),
      // 5% but only 25 clicks.
      ad({ adId: "few", impressions: 1000, clicks: 25 }),
      ad({ adId: "big", impressions: 100_000, clicks: 2000 }),
      ad({ adId: "sharp", impressions: 10_000, clicks: 300 }),
    ],
    false
  );
  assert.equal(best?.ad.adId, "sharp");
  assert.equal(best?.by, "ctr");
  assert.equal(pickBestAd([ad({ adId: "x", impressions: 999, clicks: 99 })], false), null);
});

test("shop: the best ad sold the most, falls back to CTR", () => {
  const ads = [
    ad({ adId: "a", impressions: 10_000, clicks: 500, sales: 10_000 }),
    ad({ adId: "b", impressions: 10_000, clicks: 100, sales: 50_000 }),
  ];
  assert.equal(pickBestAd(ads, true)?.ad.adId, "b");
  assert.equal(pickBestAd(ads.map((a) => ({ ...a, sales: 0 })), true)?.ad.adId, "a");
  assert.equal(pickBestAd(ads.map((a) => ({ ...a, sales: 0 })), true)?.by, "ctr");
});

test("long dimension-stuffed names are tidied", () => {
  assert.equal(tidyName("OLX-PL | BRAND | GOODS"), "OLX-PL · BRAND · GOODS");
  const long = tidyName("x".repeat(100), 20);
  assert.equal(long.length, 20);
  assert.ok(long.endsWith("…"));
});
