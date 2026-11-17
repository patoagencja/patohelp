import assert from "node:assert/strict";
import { test } from "node:test";

import {
  alignedDate,
  blackWeekOf,
  buildRows,
  compareRows,
  cumulativeNet,
  datesBetween,
  type DayInputs,
  mergeDayInputs,
  mergeDaySpend,
  momentOf,
  netChange,
  readWindows,
  resolveNetRange,
  shiftYears,
  showTwoYearsBack,
  totalChange,
  totalsOf,
} from "./calc.ts";

// Black Friday 2026 = 27 Nov, 2025 = 28 Nov, 2024 = 29 Nov.
const BF = ["2024-11-29", "2025-11-28", "2026-11-27"];

test("same date a year back keeps the calendar day; 29 Feb falls on 28 Feb", () => {
  assert.equal(alignedDate("2026-11-27", "date"), "2025-11-27");
  assert.equal(alignedDate("2026-11-27", "date", 2), "2024-11-27");
  assert.equal(shiftYears("2024-02-29", -1), "2023-02-28");
  assert.equal(shiftYears("2024-02-29", -4), "2020-02-29");
});

test("same weekday is 364 days back, so Black Friday meets Black Friday", () => {
  assert.equal(alignedDate("2026-11-27", "weekday"), "2025-11-28");
  assert.equal(alignedDate("2026-11-27", "weekday", 2), "2024-11-29");
  const d = new Date("2026-11-27T00:00:00Z").getUTCDay();
  assert.equal(new Date(`${alignedDate("2026-11-27", "weekday")}T00:00:00Z`).getUTCDay(), d);
});

test("datesBetween is inclusive and empty when reversed", () => {
  assert.deepEqual(datesBetween("2026-12-30", "2027-01-02"), ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  assert.deepEqual(datesBetween("2026-01-02", "2026-01-01"), []);
});

test("API wins over a hand entry for the same channel and day; hand entries fill the rest", () => {
  const both = mergeDaySpend({ api: { meta: 100_00, tiktok: 30_00 }, manual: { tiktok: 99_00, pinterest: 12_00 } });
  assert.equal(both.meta, 100_00);
  assert.equal(both.tiktok, 30_00, "the integration's TikTok number, not the typed one");
  assert.equal(both.source.tiktok, "api");
  assert.deepEqual(both.overridden, ["tiktok"]);
  assert.equal(both.othersTotal, 12_00);
  assert.equal(both.total, 142_00, "nothing counted twice");

  const handOnly = mergeDaySpend({ api: { meta: 100_00 }, manual: { tiktok: 99_00, bing: 1_00, x: 2_00 } });
  assert.equal(handOnly.tiktok, 99_00);
  assert.equal(handOnly.source.tiktok, "manual");
  assert.deepEqual(handOnly.overridden, []);
  assert.deepEqual(handOnly.others, { bing: 1_00, x: 2_00 });
  assert.equal(handOnly.total, 102_00 + 100_00);
});

test("an integration row with zero spend still wins (it has data that day)", () => {
  const s = mergeDaySpend({ api: { tiktok: 0 }, manual: { tiktok: 50_00 } });
  assert.equal(s.tiktok, 0);
  assert.equal(s.total, 0);
  assert.equal(s.hasData, true);
  assert.equal(mergeDaySpend(undefined).hasData, false);
});

test("Black Week runs Monday to Cyber Monday; rows from it on are emphasised", () => {
  assert.deepEqual(blackWeekOf("2026-11-27"), { start: "2026-11-23", blackFriday: "2026-11-27", cyberMonday: "2026-11-30" });
  assert.deepEqual(momentOf("2026-11-27", BF), { moment: "black-friday", fromBlackWeek: true });
  assert.deepEqual(momentOf("2026-11-30", BF), { moment: "cyber-monday", fromBlackWeek: true });
  assert.deepEqual(momentOf("2026-11-24", BF), { moment: "black-week", fromBlackWeek: true });
  assert.deepEqual(momentOf("2026-12-10", BF), { moment: null, fromBlackWeek: true });
  assert.deepEqual(momentOf("2026-11-22", BF), { moment: null, fromBlackWeek: false });
  assert.deepEqual(momentOf("2023-11-24", BF), { moment: null, fromBlackWeek: false }, "unknown year: no tag");
});

test("R and R%: % only against a positive base", () => {
  assert.deepEqual(netChange(150, 100), { diff: 50, pct: 0.5 });
  assert.deepEqual(netChange(-50, 100), { diff: -150, pct: -1.5 });
  assert.deepEqual(netChange(50, -100), { diff: 150, pct: null });
  assert.deepEqual(netChange(null, 100), { diff: null, pct: null });
});

const days: DayInputs = {
  // This year
  "2026-11-26": { revenue: 1000_00, api: { meta: 100_00, google: 50_00 }, manual: { pinterest: 10_00 } },
  "2026-11-27": { revenue: 3000_00, api: { meta: 300_00, google: 100_00, tiktok: 20_00 }, manual: { tiktok: 999_00 } },
  "2026-11-28": { revenue: null, api: { meta: 80_00 } }, // shop hasn't sent this day
  "2026-11-29": { revenue: 500_00, api: { meta: 10_00 } }, // today, partial
  // Last year, same dates
  "2025-11-26": { revenue: 900_00, api: { meta: 90_00 } },
  "2025-11-27": { revenue: 1000_00, api: { meta: 100_00 } },
  "2025-11-28": { revenue: 2500_00, api: { meta: 200_00 } }, // last year's BF
  "2025-11-29": { revenue: 700_00, api: { meta: 70_00 } },
};

test("rows: net = revenue - all ads, R against the same date, today partial", () => {
  const rows = buildRows(datesBetween("2026-11-26", "2026-11-29"), "2026-11-29", "date", days, BF);
  assert.equal(rows.length, 4);
  const bf = rows[1];
  assert.equal(bf.moment, "black-friday");
  assert.equal(bf.spend.total, 420_00, "TikTok from the API, the typed 999 zł ignored");
  assert.equal(bf.net, 2580_00);
  assert.equal(bf.ly.date, "2025-11-27");
  assert.equal(bf.ly.net, 900_00);
  assert.equal(bf.diff, 1680_00);
  assert.equal(bf.diffPct, 1680 / 900);
  assert.equal(rows[2].net, null, "no shop data is not a zero");
  assert.equal(rows[2].diff, null);
  assert.equal(rows[3].partial, true);
});

test("weekday mode matches 364 days back", () => {
  const rows = buildRows(["2026-11-27"], "2026-12-01", "weekday", days, BF);
  assert.equal(rows[0].ly.date, "2025-11-28");
  assert.equal(rows[0].ly.net, 2300_00);
  assert.equal(rows[0].diff, 2580_00 - 2300_00);
});

test("totals skip today and count a day without sales neither as revenue nor as a loss", () => {
  const rows = buildRows(datesBetween("2026-11-26", "2026-11-29"), "2026-11-29", "date", days, BF);
  const cmp = compareRows(rows);
  assert.equal(cmp.cur.days, 3);
  assert.equal(cmp.cur.revenue, 4000_00);
  assert.equal(cmp.cur.ads, 160_00 + 420_00 + 80_00, "all ad costs of finished days");
  assert.equal(cmp.cur.adsOnRevenueDays, 580_00);
  assert.equal(cmp.cur.net, 3420_00);
  assert.equal(cmp.cur.others.pinterest, 10_00);
  assert.equal(cmp.cur.adShare, 580 / 4000);
  // Last year has sales on all three days, this year on two: compared on two.
  assert.equal(cmp.basis, "matched");
  assert.equal(cmp.matchedDays, 2);
  assert.equal(cmp.lyMatched.revenue, 1900_00);
  assert.equal(cmp.lyMatched.net, 1710_00);
  assert.deepEqual(cmp.adsMatched, { cur: 660_00, ly: 390_00, days: 3 });
  const t = totalChange(rows);
  assert.equal(t.days, 2);
  assert.equal(t.diff, cmp.curMatched.net - cmp.lyMatched.net);
});

test("full basis when every day with sales has its match", () => {
  const rows = buildRows(["2026-11-26", "2026-11-27"], "2026-12-01", "date", days, BF);
  assert.equal(compareRows(rows).basis, "full");
});

test("no last year in the panel: basis none, no chart line, no two-years column", () => {
  const only: DayInputs = { "2026-10-01": { revenue: 100_00, api: { meta: 10_00 } } };
  const rows = buildRows(["2026-10-01", "2026-10-02"], "2026-10-02", "date", only, BF);
  const cmp = compareRows(rows);
  assert.equal(cmp.basis, "none");
  assert.equal(cmp.adsMatched, null);
  assert.equal(cmp.y2, null);
  assert.equal(showTwoYearsBack(rows), false);
  const cum = cumulativeNet(rows, "2026-10-02");
  assert.deepEqual(
    cum.map((p) => [p.cur, p.ly]),
    [
      [90_00, null],
      [null, null],
    ]
  );
});

test("two years back shows only with both sales and ad costs from then", () => {
  const withSales: DayInputs = { "2024-10-01": { revenue: 100_00 } };
  assert.equal(showTwoYearsBack(buildRows(["2026-10-01"], "2026-12-01", "date", withSales, BF)), false);
  const withBoth: DayInputs = { "2024-10-01": { revenue: 100_00, manual: { bing: 5_00 } } };
  assert.equal(showTwoYearsBack(buildRows(["2026-10-01"], "2026-12-01", "date", withBoth, BF)), true);
});

test("cumulative net: this year stops before today, last year runs the whole axis", () => {
  const rows = buildRows(datesBetween("2026-11-26", "2026-11-30"), "2026-11-29", "date", days, BF);
  const cum = cumulativeNet(rows, "2026-11-29");
  assert.deepEqual(
    cum.map((p) => p.cur),
    [840_00, 3420_00, 3420_00, null, null]
  );
  assert.deepEqual(
    cum.map((p) => p.ly),
    [810_00, 1710_00, 4010_00, 4640_00, 4640_00]
  );
});

test("totalsOf sums the manual-only channels per channel", () => {
  const t = totalsOf([
    { date: "a", revenue: 10, spend: mergeDaySpend({ manual: { bing: 3, x: 1 } }), net: 6 },
    { date: "b", revenue: null, spend: mergeDaySpend({ manual: { bing: 2, other: 4 } }), net: null },
  ]);
  assert.deepEqual(t.others, { pinterest: 0, bing: 5, x: 1, chatgpt: 0, other: 4 });
  assert.equal(t.othersTotal, 10);
  assert.equal(t.ads, 10);
  assert.equal(t.adsOnRevenueDays, 4);
  assert.equal(t.net, 6);
  assert.equal(t.spendDays, 2);
});

const season = { start: "2026-10-01", end: "2026-12-24", year: 2026 };

test("range: a seasonal shop defaults to the season up to today; the axis runs to its end", () => {
  const r = resolveNetRange({ today: "2026-11-17", season });
  assert.equal(r.preset, "season");
  assert.equal(r.start, "2026-10-01");
  assert.equal(r.end, "2026-11-17");
  assert.equal(r.axisEnd, "2026-12-24");
  assert.match(r.label, /Sezon 2026/);
});

test("range: a finished season shows in full; others default to this month", () => {
  const post = resolveNetRange({ today: "2027-02-10", season: { ...season } });
  assert.equal(post.end, "2026-12-24");
  const month = resolveNetRange({ today: "2026-11-17", season: null });
  assert.deepEqual([month.preset, month.start, month.end, month.axisEnd, month.label], [
    "month",
    "2026-11-01",
    "2026-11-17",
    "2026-11-30",
    "Listopad 2026",
  ]);
  assert.equal(resolveNetRange({ range: "season", today: "2026-11-17", season: null }).preset, "month");
  const d30 = resolveNetRange({ range: "30d", today: "2026-11-17", season });
  assert.deepEqual([d30.start, d30.end], ["2026-10-18", "2026-11-17"]);
});

test("range: a custom range is cut at today and capped in length; bad dates fall back", () => {
  const r = resolveNetRange({ from: "2026-11-01", to: "2026-12-31", today: "2026-11-17", season });
  assert.deepEqual([r.preset, r.start, r.end, r.axisEnd], ["custom", "2026-11-01", "2026-11-17", "2026-11-17"]);
  const long = resolveNetRange({ from: "2020-01-01", to: "2026-11-17", today: "2026-11-17", season: null });
  assert.equal(long.clamped, true);
  assert.equal(datesBetween(long.start, long.end).length, 400);
  assert.equal(resolveNetRange({ from: "2026-02-31", to: "2026-03-05", today: "2026-11-17", season: null }).preset, "month");
  assert.equal(resolveNetRange({ from: "2026-03-05", to: "2026-03-01", today: "2026-11-17", season: null }).preset, "month");
});

test("read windows cover both comparison modes", () => {
  const [cur, ly, y2] = readWindows({ start: "2026-10-01", axisEnd: "2026-12-24" });
  assert.deepEqual(cur, { start: "2026-10-01", end: "2026-12-24" });
  // 364 days back starts a day later than the date in 2025 (non-leap gap).
  assert.deepEqual(ly, { start: "2025-10-01", end: "2025-12-25" });
  assert.equal(y2.start <= "2024-10-01", true);
  assert.equal(y2.end >= alignedDate("2026-12-24", "weekday", 2), true);
});

test("the three sources merge into one input per day", () => {
  const days = mergeDayInputs(
    { "2026-11-27": 3000_00 },
    { "2026-11-27": { meta: 300_00, tiktok: 20_00 }, "2026-11-28": { google: 5_00 } },
    { "2026-11-27|tiktok": 999_00, "2026-11-28|bing": 7_00, "2026-11-28|unknown": 1_00 }
  );
  assert.deepEqual(days, {
    "2026-11-27": { revenue: 3000_00, api: { meta: 300_00, tiktok: 20_00 }, manual: { tiktok: 999_00 } },
    "2026-11-28": { api: { google: 5_00 }, manual: { bing: 7_00 } },
  });
  assert.equal(mergeDaySpend(days["2026-11-27"]).total, 320_00);
});
