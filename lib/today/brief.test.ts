import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  addDays,
  buildBrief,
  dateLine,
  daysFromShop,
  daysFromTrend,
  eachDay,
  greeting,
  pickActions,
  pickAttention,
  pickBriefSource,
  plural,
  topBy,
  weekdayBaseline,
  weekdayOf,
  zl,
  type BriefDay,
  type TrendDay,
} from "./brief.ts";

const NBSP = " ";
// Saturday 2026-11-07: yesterday is a Friday.
const TODAY = "2026-11-07";
const YESTERDAY = "2026-11-06";

/** 30 days ending today, every figure from `f(date)`. */
function trendOf(f: (date: string, i: number) => Partial<TrendDay>): TrendDay[] {
  return eachDay(addDays(TODAY, -29), TODAY).map((date, i) => ({
    date,
    revenueMinorUnits: 0,
    transactions: 0,
    clicks: 0,
    sessions: 0,
    ...f(date, i),
  }));
}

describe("dates and words", () => {
  test("weekday and date line in Polish", () => {
    assert.equal(weekdayOf(TODAY), 6);
    assert.equal(dateLine(TODAY), "Sobota, 7 listopada");
    assert.equal(dateLine("2026-03-02"), "Poniedziałek, 2 marca");
  });

  test("greeting follows the Warsaw hour", () => {
    assert.equal(greeting(7), "Dzień dobry");
    assert.equal(greeting(17), "Dzień dobry");
    assert.equal(greeting(18), "Dobry wieczór");
    assert.equal(greeting(1), "Dobry wieczór");
  });

  test("plural and money", () => {
    assert.equal(plural(1, "a", "b", "c"), "a");
    assert.equal(plural(3, "a", "b", "c"), "b");
    assert.equal(plural(12, "a", "b", "c"), "c");
    assert.equal(plural(22, "a", "b", "c"), "b");
    assert.equal(zl(1_240_049), `12${NBSP}400${NBSP}zł`);
  });
});

describe("daily series", () => {
  test("days before the first figure are no data, not zero", () => {
    const days = daysFromTrend(
      trendOf((_, i) => ({ revenueMinorUnits: i >= 10 ? 1000 : 0 })),
      (d) => d.revenueMinorUnits,
      (d) => d.transactions
    );
    assert.equal(days[9].primary, null);
    assert.equal(days[10].primary, 1000);
    assert.equal(days[10].secondary, 0);
  });

  test("shop days keep unsent dates empty", () => {
    const days = daysFromShop([{ date: "2026-11-02", revenue: 500, orders: 2 }], "2026-11-01", "2026-11-03");
    assert.deepEqual(days, [
      { date: "2026-11-01", primary: null, secondary: null },
      { date: "2026-11-02", primary: 500, secondary: 2 },
      { date: "2026-11-03", primary: null, secondary: null },
    ]);
  });

  test("a shop's own sales win over GA4", () => {
    const trend = trendOf(() => ({ revenueMinorUnits: 100, transactions: 1, clicks: 10 }));
    const picked = pickBriefSource({
      isShop: true,
      trend,
      shopDays: [{ date: YESTERDAY, revenue: 9000, orders: 3 }],
      start: trend[0].date,
      end: TODAY,
    });
    assert.equal(picked?.kind, "sales");
    assert.equal(picked?.source, "shop");
  });

  test("an old shop upload gives way to GA4 that has the recent days", () => {
    const trend = trendOf(() => ({ revenueMinorUnits: 100, transactions: 1 }));
    const picked = pickBriefSource({
      isShop: true,
      trend,
      shopDays: [{ date: "2026-10-20", revenue: 9000, orders: 3 }],
      start: trend[0].date,
      end: TODAY,
    });
    assert.equal(picked?.source, "ga4");
  });

  test("GA4 sales, then clicks, then visits, then nothing", () => {
    const base = { isShop: true, shopDays: null, start: addDays(TODAY, -29), end: TODAY };
    assert.equal(pickBriefSource({ ...base, trend: trendOf(() => ({ transactions: 1 })) })?.source, "ga4");
    // A shop with no sales tracked yet speaks in clicks - never in empty sales.
    assert.equal(pickBriefSource({ ...base, trend: trendOf(() => ({ clicks: 5, sessions: 9 })) })?.kind, "clicks");
    // Engagement clients never get sales, even when GA4 reports revenue.
    assert.equal(
      pickBriefSource({ ...base, isShop: false, trend: trendOf(() => ({ revenueMinorUnits: 100, clicks: 5 })) })?.kind,
      "clicks"
    );
    assert.equal(pickBriefSource({ ...base, isShop: false, trend: trendOf(() => ({ sessions: 9 })) })?.kind, "visits");
    assert.equal(pickBriefSource({ ...base, trend: trendOf(() => ({})) }), null);
  });

  test("clicks without any visits leave the visits out", () => {
    const picked = pickBriefSource({
      isShop: false,
      trend: trendOf(() => ({ clicks: 5 })),
      shopDays: null,
      start: addDays(TODAY, -29),
      end: TODAY,
    });
    assert.equal(picked?.days[5].secondary, null);
  });
});

describe("weekday baseline", () => {
  const day = (date: string, primary: number | null, secondary: number | null = null): BriefDay => ({
    date,
    primary,
    secondary,
  });

  test("averages the same weekday of the previous four weeks", () => {
    const days = [
      day(addDays(YESTERDAY, -28), 100, 1),
      day(addDays(YESTERDAY, -21), 200, 2),
      day(addDays(YESTERDAY, -14), 300, 3),
      day(addDays(YESTERDAY, -7), 400, 4),
      // Other weekdays never count.
      day(addDays(YESTERDAY, -1), 10_000, 100),
      day(YESTERDAY, 1, 1),
    ];
    assert.deepEqual(weekdayBaseline(days, YESTERDAY), { primary: 250, secondary: 2.5, weeks: 4 });
  });

  test("days without data are skipped; fewer than two weeks gives none", () => {
    const days = [day(addDays(YESTERDAY, -14), 300), day(addDays(YESTERDAY, -7), null), day(addDays(YESTERDAY, -21), 100)];
    assert.deepEqual(weekdayBaseline(days, YESTERDAY), { primary: 200, secondary: null, weeks: 2 });
    assert.equal(weekdayBaseline([day(addDays(YESTERDAY, -7), 400)], YESTERDAY), null);
  });
});

describe("the brief", () => {
  /** Fridays at 10 000 zł / 20 orders; yesterday and today as given. */
  function salesDays(yesterday: number | null, orders: number | null, today: number | null = null): BriefDay[] {
    const out: BriefDay[] = [];
    for (let k = 4; k >= 1; k--) out.push({ date: addDays(YESTERDAY, -7 * k), primary: 1_000_000, secondary: 20 });
    out.push({ date: YESTERDAY, primary: yesterday, secondary: orders });
    out.push({ date: TODAY, primary: today, secondary: today === null ? null : 3 });
    return out;
  }
  const sales = (days: BriefDay[], source: "shop" | "ga4" = "ga4") =>
    buildBrief({ picked: { kind: "sales", source, days }, today: TODAY, hour: 8 });

  test("more than usual on that weekday", () => {
    const b = sales(salesDays(1_180_000, 31));
    assert.equal(b.greeting, "Dzień dobry");
    assert.equal(b.dateLine, "Sobota, 7 listopada");
    assert.equal(b.text, `Wczoraj 11${NBSP}800${NBSP}zł sprzedaży z 31 zamówień - o 18% więcej niż zwykle w piątki.`);
    assert.equal(b.tone, "up");
    assert.ok(Math.abs((b.change ?? 0) - 0.18) < 1e-9);
    // The figures are the highlighted parts.
    assert.deepEqual(
      b.lead.filter((p) => typeof p !== "string"),
      [{ hl: `11${NBSP}800${NBSP}zł` }, { hl: "31 zamówień" }, { hl: "o 18% więcej" }]
    );
  });

  test("less, as usual, and far more", () => {
    assert.match(sales(salesDays(880_000, 1)).text, /z 1 zamówienia - o 12% mniej niż zwykle w piątki\.$/);
    const flat = sales(salesDays(1_030_000, 20));
    assert.match(flat.text, /- tyle, ile zwykle w piątki\.$/);
    assert.equal(flat.tone, "flat");
    // The band is on the percent the sentence would show.
    assert.equal(sales(salesDays(1_050_000, 20)).tone, "flat");
    assert.match(sales(salesDays(1_060_000, 20)).text, /- o 6% więcej niż zwykle w piątki\.$/);
    assert.match(sales(salesDays(2_500_000, 50)).text, /- 2,5 raza więcej niż zwykle w piątki\.$/);
    assert.match(sales(salesDays(3_000_000, 50)).text, /- 3 razy więcej niż zwykle w piątki\.$/);
  });

  test("today so far, without a comparison", () => {
    const b = sales(salesDays(1_000_000, 20, 310_000));
    assert.equal(b.todayLine && b.todayLine.map((p) => (typeof p === "string" ? p : p.hl)).join(""), `Dziś do tej pory 3${NBSP}100${NBSP}zł z 3 zamówień.`);
    assert.equal(sales(salesDays(1_000_000, 20, 0)).todayLine, null);
  });

  test("a missing or empty yesterday says so, with the usual figure", () => {
    assert.equal(
      sales(salesDays(null, null), "shop").text,
      `Sklep nie przesłał jeszcze sprzedaży za wczoraj. Zwykle w piątki to ok. 10${NBSP}000${NBSP}zł.`
    );
    assert.equal(
      sales(salesDays(0, 0)).text,
      `Za wczoraj nie widzimy jeszcze sprzedaży. Zwykle w piątki to ok. 10${NBSP}000${NBSP}zł.`
    );
    assert.equal(sales(salesDays(0, 0)).change, null);
  });

  test("no history: the figures without a comparison", () => {
    const b = buildBrief({
      picked: { kind: "sales", source: "ga4", days: [{ date: YESTERDAY, primary: 50_000, secondary: 0 }] },
      today: TODAY,
      hour: 20,
    });
    assert.equal(b.greeting, "Dobry wieczór");
    assert.equal(b.text, `Wczoraj 500${NBSP}zł sprzedaży.`);
    assert.equal(b.tone, null);
  });

  test("engagement wording: clicks and visits, never sales", () => {
    const days: BriefDay[] = [];
    for (let k = 4; k >= 1; k--) days.push({ date: addDays(YESTERDAY, -7 * k), primary: 1000, secondary: 1500 });
    days.push({ date: YESTERDAY, primary: 1080, secondary: 2310 });
    days.push({ date: TODAY, primary: 412, secondary: 600 });
    const b = buildBrief({ picked: { kind: "clicks", source: "ads", days }, today: TODAY, hour: 9 });
    assert.equal(
      b.text,
      `Wczoraj 1${NBSP}080 kliknięć w reklamy - o 8% więcej niż zwykle w piątki. Na stronie 2${NBSP}310 wizyt. Dziś do tej pory 412 kliknięć.`
    );
    assert.doesNotMatch(b.text, /sprzeda|zł|ROAS|przych/i);

    const visits = buildBrief({
      picked: { kind: "visits", source: "ga4", days: days.map((d) => ({ ...d, secondary: null })) },
      today: TODAY,
      hour: 9,
    });
    assert.match(visits.text, /^Wczoraj 1 080 wizyt na stronie - o 8% więcej niż zwykle w piątki\./);
  });

  test("nothing synced yet", () => {
    const b = buildBrief({ picked: null, today: TODAY, hour: 9 });
    assert.match(b.text, /po pierwszej synchronizacji/);
    assert.equal(b.todayLine, null);
  });

  test("Tuesday takes 'we'", () => {
    // 2026-11-11 is a Wednesday: yesterday a Tuesday.
    const days: BriefDay[] = [
      { date: "2026-10-27", primary: 100, secondary: null },
      { date: "2026-11-03", primary: 100, secondary: null },
      { date: "2026-11-10", primary: 150, secondary: null },
    ];
    const b = buildBrief({ picked: { kind: "visits", source: "ga4", days }, today: "2026-11-11", hour: 9 });
    assert.match(b.text, /niż zwykle we wtorki\.$/);
  });
});

describe("picking the lists", () => {
  test("attention: urgent first, informational left out, at most three", () => {
    const alerts = [
      { id: "a", severity: "high" },
      { id: "b", severity: "medium" },
      { id: "c", severity: "critical" },
      { id: "d", severity: "high" },
      { id: "e", severity: "high" },
    ];
    const { shown, rest } = pickAttention(alerts);
    assert.deepEqual(
      shown.map((a) => a.id),
      ["c", "a", "d"]
    );
    assert.equal(rest, 1);
    assert.deepEqual(pickAttention([{ severity: "medium" }]), { shown: [], rest: 0 });
  });

  test("actions: one of each kind first, in priority order", () => {
    const picked = pickActions({ test: ["t1", "t2", "t3"], goal: ["g1"], budget: ["b1"] });
    assert.deepEqual(
      picked.map((p) => p.item),
      ["g1", "t1", "b1"]
    );
  });

  test("actions: the next round fills what is left", () => {
    assert.deepEqual(
      pickActions({ test: ["t1", "t2", "t3"], goal: ["g1"] }).map((p) => p.item),
      ["g1", "t1", "t2"]
    );
    assert.deepEqual(
      pickActions({ test: ["t1"] }).map((p) => `${p.source}:${p.item}`),
      ["test:t1"]
    );
    assert.deepEqual(pickActions({}), []);
    assert.equal(pickActions({ test: ["t1", "t2", "t3", "t4"] }, 2).length, 2);
  });

  test("topBy ignores zero and keeps the first of a tie", () => {
    const rows = [
      { n: "a", v: 0 },
      { n: "b", v: 5 },
      { n: "c", v: 5 },
    ];
    assert.equal(topBy(rows, (r) => r.v)?.n, "b");
    assert.equal(topBy([{ v: 0 }], (r) => r.v), null);
  });
});
