import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  addDaysIso,
  buildStreakAlert,
  chooseHint,
  findStreaks,
  hintText,
  judgeDay,
  mergeStreak,
  plPlural,
  streakSeverity,
  streakTitle,
  streakWindowStart,
  weekdaysPhrase,
  whenPhrase,
  MAX_STREAK_DAYS,
  STREAK_WINDOW_DAYS,
  type DayTotals,
  type HintContext,
  type StreakHint,
  type StreakInput,
  type StreakMetric,
} from "./streaks.ts";

// 2026-11-05 is a Thursday: yesterday = Wednesday 4.11, before it Tuesday 3.11.
const THURSDAY = "2026-11-05";

const weekdayOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

/**
 * Every full day of the detection window before `today`. `shape(date, ago)`
 * returns the day's totals; `ago` = 1 for yesterday.
 */
function window(today: string, shape: (date: string, ago: number) => DayTotals): Record<string, DayTotals> {
  const days: Record<string, DayTotals> = {};
  for (let ago = 1; ago <= STREAK_WINDOW_DAYS; ago++) {
    const date = addDaysIso(today, -ago);
    days[date] = shape(date, ago);
  }
  return days;
}

/** Scale the listed fields of a day. */
const scaled = (d: DayTotals, by: Partial<Record<keyof DayTotals, number>>): DayTotals => {
  const out: DayTotals = { ...d };
  for (const [k, f] of Object.entries(by) as Array<[keyof DayTotals, number]>) {
    const v = out[k];
    if (typeof v === "number") out[k] = Math.round(v * f);
  }
  return out;
};

// A healthy engagement account (DRE-like) and a healthy shop.
const ENGAGEMENT: DayTotals = { spend: 100_000, clicks: 400, impressions: 20_000, sessions: 600 };
const SHOP: DayTotals = {
  spend: 200_000,
  clicks: 1_000,
  impressions: 60_000,
  sessions: 2_000,
  purchases: 60,
  orders: 80,
  sales: 1_000_000,
};

/** The last `n` full days changed by `by`, the rest as `base`. */
function lastDays(today: string, base: DayTotals, n: number, by: Partial<Record<keyof DayTotals, number>>) {
  return window(today, (_, ago) => (ago <= n ? scaled(base, by) : { ...base }));
}

// "przychód" (revenue) and its forms - not "przychodzą" (they come).
const SALES_WORDS = /sprzeda|zakup|zamówie|koszyk|przychód|przychod[uyó]|roas|konwersj|kupuj/i;

describe("dates", () => {
  test("day arithmetic crosses month, year and leap-day boundaries", () => {
    assert.equal(addDaysIso("2026-03-01", -1), "2026-02-28");
    assert.equal(addDaysIso("2028-03-01", -1), "2028-02-29");
    assert.equal(addDaysIso("2027-01-01", -1), "2026-12-31");
    assert.equal(addDaysIso("2026-12-31", 1), "2027-01-01");
    assert.equal(streakWindowStart("2026-11-05"), "2026-10-01");
    assert.equal(STREAK_WINDOW_DAYS, 35);
  });
});

describe("weekday baseline", () => {
  test("a quiet weekend compared with earlier weekends is not a drop", () => {
    // Monday: yesterday Sunday, before it Saturday - weekends run at half
    // the weekday level every week. Against the plain average of the last
    // weeks (~0.86x) they would read as -42%; against other weekends: 0%.
    const monday = "2026-11-09";
    const days = window(monday, (date) => {
      const wd = weekdayOf(date);
      return wd === 0 || wd === 6 ? scaled(ENGAGEMENT, { sessions: 0.5, clicks: 0.5, spend: 0.5 }) : { ...ENGAGEMENT };
    });
    const input: StreakInput = { today: monday, shop: false, days };
    assert.deepEqual(findStreaks(input), []);
    const sunday = judgeDay(input, "sessions", "2026-11-08");
    assert.ok(sunday);
    assert.equal(sunday.change, 0);
    assert.equal(sunday.bad, false);
    assert.equal(buildStreakAlert(input), null);
  });

  test("a weekend that IS below other weekends is a streak, in weekend words", () => {
    // 2026-03-02 is a Monday: Saturday 28.02 and Sunday 1.03 (month boundary).
    const monday = "2026-03-02";
    const days = window(monday, (date, ago) => {
      const wd = weekdayOf(date);
      const weekend = wd === 0 || wd === 6 ? scaled(ENGAGEMENT, { sessions: 0.5 }) : { ...ENGAGEMENT };
      return ago <= 2 ? scaled(weekend, { sessions: 0.6 }) : weekend;
    });
    const alert = buildStreakAlert({ today: monday, shop: false, days });
    assert.ok(alert);
    assert.equal(alert.metric, "sessions");
    assert.equal(alert.start, "2026-02-28");
    assert.equal(alert.end, "2026-03-01");
    assert.equal(alert.title, "Od 2 dni wizyt na stronie jest o 40% mniej niż zwykle w soboty i niedziele");
    assert.match(alert.description, /^W sobotę i niedzielę: 360 wizyt na stronie, a zwykle w te dni ok\. 600\./);
  });

  test("one Black Friday in the baseline doesn't make the next normal weeks a slump", () => {
    // Three weeks ago Wednesday and Thursday sold 3x. A plain 4-week mean
    // would set the usual at 1.5x and call this normal week -33%.
    const days = window(THURSDAY, (_, ago) =>
      ago === 15 || ago === 16 ? scaled(SHOP, { orders: 3, sales: 3, purchases: 3 }) : { ...SHOP }
    );
    assert.deepEqual(findStreaks({ today: THURSDAY, shop: true, days }), []);
  });

  test("a weekday with fewer than 3 of its 4 weeks of data isn't judged", () => {
    const days = lastDays(THURSDAY, ENGAGEMENT, 2, { sessions: 0.5 });
    // Wednesday's baseline: 28.10, 21.10, 14.10, 7.10 - drop two of them.
    delete days["2026-10-28"];
    delete days["2026-10-21"];
    const input: StreakInput = { today: THURSDAY, shop: false, days };
    assert.equal(judgeDay(input, "sessions", "2026-11-04"), null);
    assert.deepEqual(findStreaks(input), []);
  });
});

describe("streaks", () => {
  test("a 2-day streak: title, numbers, hint, id", () => {
    const days = lastDays(THURSDAY, SHOP, 2, { orders: 0.65 });
    const alert = buildStreakAlert({ today: THURSDAY, shop: true, days });
    assert.ok(alert);
    assert.equal(alert.metric, "orders");
    assert.equal(alert.id, "streak-orders-2026-11-03");
    assert.equal(alert.days, 2);
    assert.equal(alert.title, "Od 2 dni zamówień jest o 35% mniej niż zwykle we wtorki i środy");
    assert.equal(
      alert.description,
      "We wtorek i środę: 104 zamówienia, a zwykle w te dni ok. 160. W tych samych dniach także: konwersja sklepu -35%."
    );
    assert.equal(alert.action, "Ruch bez zmian, a zakupów mniej — sprawdźmy stronę i koszyk.");
    assert.equal(alert.hint, "site");
    assert.deepEqual(alert.covered, ["orders", "cr"]);
    assert.equal(alert.severity, "high");
    assert.equal(Math.round(alert.changePct), -35);
    assert.match(alert.why, /ten sam dzień tygodnia w poprzednich 4 tygodniach/);
  });

  test("a 1-day dip is no alert", () => {
    const days = lastDays(THURSDAY, SHOP, 1, { orders: 0.3, sales: 0.3 });
    assert.deepEqual(findStreaks({ today: THURSDAY, shop: true, days }), []);
    const eng = lastDays(THURSDAY, ENGAGEMENT, 1, { sessions: 0.3, clicks: 0.3 });
    assert.equal(buildStreakAlert({ today: THURSDAY, shop: false, days: eng }), null);
  });

  test("a day back inside the tolerance ends the streak", () => {
    const days = window(THURSDAY, (_, ago) =>
      ago === 1 || ago === 3 ? scaled(ENGAGEMENT, { sessions: 0.5 }) : ago === 2 ? scaled(ENGAGEMENT, { sessions: 0.8 }) : { ...ENGAGEMENT }
    );
    assert.deepEqual(findStreaks({ today: THURSDAY, shop: false, days }), []);
  });

  test("a missing day ends the streak instead of counting as zero", () => {
    const days = lastDays(THURSDAY, ENGAGEMENT, 3, { sessions: 0.5 });
    // GA4 didn't sync Tuesday: no sessions that day.
    days["2026-11-03"] = { ...days["2026-11-03"], sessions: undefined };
    assert.deepEqual(findStreaks({ today: THURSDAY, shop: false, days }), []);
    // Ads didn't sync yesterday at all.
    const ads = lastDays(THURSDAY, ENGAGEMENT, 3, { clicks: 0.5 });
    delete ads["2026-11-04"];
    assert.deepEqual(findStreaks({ today: THURSDAY, shop: false, days: ads }), []);
  });

  test("today is never judged", () => {
    const days = lastDays(THURSDAY, ENGAGEMENT, 1, { sessions: 0.4 });
    days[THURSDAY] = scaled(ENGAGEMENT, { sessions: 0.2 }); // partial day
    assert.deepEqual(findStreaks({ today: THURSDAY, shop: false, days }), []);
  });

  test("low volume never alerts", () => {
    // 20 clicks a day (under the 30 minimum) falling 60% for 3 days.
    const small: DayTotals = { spend: 20_000, clicks: 20, impressions: 2_000, sessions: 20 };
    const days = lastDays(THURSDAY, small, 3, { clicks: 0.4, sessions: 0.4 });
    assert.deepEqual(findStreaks({ today: THURSDAY, shop: false, days }), []);

    // 3 orders a day: even zero orders isn't judged.
    const tiny = lastDays(THURSDAY, { ...SHOP, orders: 3, sales: 300_000 }, 2, { orders: 0, sales: 0 });
    assert.equal(
      findStreaks({ today: THURSDAY, shop: true, days: tiny }).some((s) => s.metric === "orders"),
      false
    );
  });

  test("small counts must fall beyond their normal wobble", () => {
    // 10 orders a day: 10 -> 6 (-40%) happens by chance; 10 -> 2 doesn't.
    const base = { ...SHOP, orders: 10, sales: 1_000_000 };
    const wobble = lastDays(THURSDAY, base, 2, { orders: 0.6 });
    assert.equal(findStreaks({ today: THURSDAY, shop: true, days: wobble }).some((s) => s.metric === "orders"), false);
    const real = lastDays(THURSDAY, base, 2, { orders: 0.2 });
    assert.equal(findStreaks({ today: THURSDAY, shop: true, days: real })[0]?.metric, "orders");
  });

  test("across the new year", () => {
    // 2027-01-02 is a Saturday: the streak runs Thursday 31.12 - Friday 1.01
    // and its baseline reaches back into December.
    const today = "2027-01-02";
    const days = lastDays(today, ENGAGEMENT, 2, { sessions: 0.5 });
    const alert = buildStreakAlert({ today, shop: false, days });
    assert.ok(alert);
    assert.equal(alert.id, "streak-sessions-2026-12-31");
    assert.equal(alert.title, "Od 2 dni wizyt na stronie jest o 50% mniej niż zwykle w czwartki i piątki");
  });

  test("the id stays the same while the streak goes on", () => {
    const drop = (today: string, n: number) => lastDays(today, ENGAGEMENT, n, { sessions: 0.5 });
    const day1 = buildStreakAlert({ today: THURSDAY, shop: false, days: drop(THURSDAY, 2) });
    const day2 = buildStreakAlert({ today: "2026-11-06", shop: false, days: drop("2026-11-06", 3) });
    assert.ok(day1 && day2);
    assert.equal(day1.id, day2.id);
    assert.equal(day2.days, 3);
    assert.equal(day2.title, "Od 3 dni wizyt na stronie jest o 50% mniej niż zwykle we wtorki, środy i czwartki");
  });

  test("a streak longer than the scan is capped at a week", () => {
    const days = lastDays(THURSDAY, ENGAGEMENT, 10, { sessions: 0.5 });
    const [s] = findStreaks({ today: THURSDAY, shop: false, days });
    assert.equal(s.days, MAX_STREAK_DAYS);
    assert.equal(s.capped, true);
    const alert = buildStreakAlert({ today: THURSDAY, shop: false, days });
    assert.ok(alert);
    assert.equal(alert.title, "Od tygodnia wizyt na stronie jest o 50% mniej niż zwykle");
    assert.match(alert.description, /^W ostatnim tygodniu: /);
  });

  test("4 to 6 days speak of 'te dni tygodnia'", () => {
    const days = lastDays(THURSDAY, ENGAGEMENT, 5, { sessions: 0.6 });
    const alert = buildStreakAlert({ today: THURSDAY, shop: false, days });
    assert.ok(alert);
    assert.equal(alert.title, "Od 5 dni wizyt na stronie jest o 40% mniej niż zwykle w te dni tygodnia");
    assert.match(alert.description, /^W ostatnich 5 dniach: 1 800 wizyt na stronie/);
    assert.equal(alert.severity, "high");
  });

  test("ad purchases: yesterday's late attribution gets an allowance", () => {
    // -35% on both days: yesterday's purchases are still being attributed,
    // so that alone is no streak...
    const late = lastDays(THURSDAY, SHOP, 2, { purchases: 0.65 });
    assert.equal(findStreaks({ today: THURSDAY, shop: true, days: late }).some((s) => s.metric === "purchases"), false);
    // ...but the shop's own orders, final on the day, are.
    const orders = lastDays(THURSDAY, SHOP, 2, { orders: 0.65 });
    assert.equal(findStreaks({ today: THURSDAY, shop: true, days: orders })[0].metric, "orders");
    // Yesterday deep enough to clear the allowance: a streak.
    const deep = window(THURSDAY, (_, ago) =>
      ago === 1 ? scaled(SHOP, { purchases: 0.5 }) : ago === 2 ? scaled(SHOP, { purchases: 0.65 }) : { ...SHOP }
    );
    const alert = buildStreakAlert({ today: THURSDAY, shop: true, days: deep });
    assert.ok(alert);
    assert.equal(alert.metric, "purchases");
    assert.equal(alert.title, "Od 2 dni zakupów z reklam jest o 43% mniej niż zwykle we wtorki i środy");
    // Cost per purchase rose with it and is named, not a second card.
    assert.deepEqual(alert.covered, ["purchases", "cpa"]);
    assert.match(alert.description, /W tych samych dniach także: koszt zakupu z reklam \+\d+%\./);
  });

  test("the card leads with the most important metric", () => {
    const days = lastDays(THURSDAY, SHOP, 2, { orders: 0.4, sales: 0.4, purchases: 0.4 });
    const alert = buildStreakAlert({ today: THURSDAY, shop: true, days });
    assert.ok(alert);
    assert.equal(alert.metric, "sales");
    assert.deepEqual(alert.covered, ["sales", "orders", "purchases", "cr", "cpa"]);
    assert.equal(alert.title, "Od 2 dni sprzedaż jest o 60% niższa niż zwykle we wtorki i środy");
    assert.equal(alert.severity, "critical");
  });

  test("costs going up: CPC streak for an engagement client", () => {
    const days = lastDays(THURSDAY, ENGAGEMENT, 2, { clicks: 0.65 });
    const alert = buildStreakAlert({ today: THURSDAY, shop: false, days });
    assert.ok(alert);
    // Clicks -35% is the lead (traffic before cost); CTR and CPC come along.
    assert.equal(alert.metric, "clicks");
    assert.deepEqual(alert.covered, ["clicks", "ctr", "cpc"]);
    const cpcOnly = lastDays(THURSDAY, ENGAGEMENT, 2, { spend: 1.5 });
    const cpc = buildStreakAlert({ today: THURSDAY, shop: false, days: cpcOnly });
    assert.ok(cpc);
    assert.equal(cpc.metric, "cpc");
    assert.equal(cpc.direction, "up");
    assert.equal(cpc.title, "Od 2 dni kliknięcie w reklamę kosztuje o 50% więcej niż zwykle we wtorki i środy");
    assert.equal(
      cpc.description,
      "We wtorek i środę: kliknięcie kosztowało średnio 3,75 zł, a zwykle w te dni 2,50 zł."
    );
    assert.equal(cpc.action, hintText("spend-up", false));
  });
});

describe("hints", () => {
  const ctx = (c: Partial<HintContext>): HintContext => ({
    spend: 0,
    clicks: 0,
    sessions: 0,
    purchases: 0,
    ctr: 0,
    ...c,
  });

  const cases: Array<[StreakMetric, Partial<HintContext>, StreakHint]> = [
    // Shops: spend first, then traffic, then the website.
    ["purchases", { spend: -0.4, clicks: -0.4 }, "spend-down"],
    ["purchases", { clicks: -0.3 }, "traffic-down"],
    ["orders", { sessions: -0.25 }, "traffic-down"],
    ["orders", {}, "site"],
    ["sales", { sessions: 0.3 }, "traffic-up"],
    ["sales", { clicks: null, sessions: null }, "unclear"],
    ["cr", {}, "site"],
    ["cr", { sessions: 0.4 }, "traffic-up"],
    ["cpa", { spend: 0.5 }, "spend-up"],
    ["cpa", { purchases: -0.4 }, "site"],
    ["cpa", { purchases: -0.4, clicks: -0.3 }, "traffic-down"],
    ["cpa", {}, "costlier"],
    // Engagement.
    ["sessions", { spend: -0.5 }, "spend-down"],
    ["sessions", { clicks: -0.35 }, "traffic-down"],
    ["sessions", {}, "site"],
    ["sessions", { clicks: null }, "unclear"],
    ["clicks", { spend: -0.3 }, "spend-down"],
    ["clicks", {}, "ads-weaker"],
    ["ctr", { spend: -0.5 }, "ads-weaker"],
    ["cpc", { spend: 0.4 }, "spend-up"],
    ["cpc", { ctr: -0.3 }, "ads-weaker"],
    ["cpc", {}, "costlier"],
  ];
  for (const [metric, c, hint] of cases) {
    test(`${metric} ${JSON.stringify(c)} -> ${hint}`, () => {
      assert.equal(chooseHint(metric, ctx(c)), hint);
    });
  }

  test("small moves of the other metrics don't count", () => {
    assert.equal(chooseHint("orders", ctx({ spend: -0.15, clicks: -0.1, sessions: 0.15 })), "site");
  });

  test("the spec's three sentences", () => {
    assert.equal(hintText("site", true), "Ruch bez zmian, a zakupów mniej — sprawdźmy stronę i koszyk.");
    assert.equal(hintText("traffic-down", true), "Mniej ruchu z reklam — sprawdzamy kampanie.");
    assert.equal(hintText("spend-down", true), "Wydajemy mniej — sprawdzamy budżet albo zatrzymaną kampanię.");
  });

  test("end to end: traffic down / spend down / website", () => {
    const traffic = buildStreakAlert({
      today: THURSDAY,
      shop: true,
      days: lastDays(THURSDAY, SHOP, 2, { orders: 0.6, sales: 0.6, clicks: 0.6, sessions: 0.6 }),
    });
    assert.equal(traffic?.hint, "traffic-down");
    const spend = buildStreakAlert({
      today: THURSDAY,
      shop: true,
      days: lastDays(THURSDAY, SHOP, 2, { orders: 0.6, sales: 0.6, spend: 0.5, clicks: 0.6, sessions: 0.7 }),
    });
    assert.equal(spend?.hint, "spend-down");
    const site = buildStreakAlert({
      today: THURSDAY,
      shop: false,
      days: lastDays(THURSDAY, ENGAGEMENT, 2, { sessions: 0.5 }),
    });
    assert.equal(site?.hint, "site");
    assert.equal(
      site?.action,
      "Kliknięć w reklamy tyle co zwykle, a wizyt na stronie mniej — sprawdzamy stronę i pomiar ruchu."
    );
  });
});

describe("engagement clients never read sales words", () => {
  test("every engagement hint", () => {
    for (const hint of [
      "spend-down",
      "traffic-down",
      "site",
      "traffic-up",
      "ads-weaker",
      "spend-up",
      "costlier",
      "unclear",
    ] as StreakHint[]) {
      assert.doesNotMatch(hintText(hint, false), SALES_WORDS, hint);
    }
  });

  test("every engagement alert, even with shop data in the rows", () => {
    // An engagement account whose rows happen to carry purchases / orders
    // (Meta conversions, GA4 transactions): never judged, never named.
    const withSales: DayTotals = { ...ENGAGEMENT, purchases: 50, orders: 40, sales: 900_000 };
    const scenarios: Array<Partial<Record<keyof DayTotals, number>>> = [
      { purchases: 0.2, orders: 0.2, sales: 0.2 },
      { sessions: 0.5 },
      { sessions: 0.5, clicks: 0.5 },
      { sessions: 0.5, clicks: 0.5, spend: 0.5, purchases: 0.2 },
      { clicks: 0.6 },
      { clicks: 0.6, impressions: 0.6, spend: 0.6 },
      { spend: 1.6 },
      { clicks: 0.6, spend: 1.4 },
      { impressions: 1.8 },
    ];
    let alerts = 0;
    for (const by of scenarios) {
      for (const n of [2, 4, 9]) {
        const alert = buildStreakAlert({ today: THURSDAY, shop: false, days: lastDays(THURSDAY, withSales, n, by) });
        if (!alert) continue;
        alerts += 1;
        assert.ok(["sessions", "clicks", "ctr", "cpc"].includes(alert.metric), alert.metric);
        for (const text of [alert.title, alert.description, alert.why, alert.action, alert.label, alert.scopeLabel]) {
          assert.doesNotMatch(text, SALES_WORDS, `${JSON.stringify(by)}: ${text}`);
        }
      }
    }
    // Only the first scenario (sales-only) is silent.
    assert.equal(alerts, (scenarios.length - 1) * 3);
  });
});

describe("severity", () => {
  test("Pilne only for a shop's sales halving", () => {
    assert.equal(streakSeverity({ metric: "sales", change: -0.55, days: 2 }), "critical");
    assert.equal(streakSeverity({ metric: "orders", change: -0.35, days: 2 }), "high");
    assert.equal(streakSeverity({ metric: "cpa", change: 0.35, days: 2 }), "medium");
    assert.equal(streakSeverity({ metric: "cpa", change: 0.6, days: 2 }), "high");
    assert.equal(streakSeverity({ metric: "sessions", change: -0.9, days: 2 }), "high");
    assert.equal(streakSeverity({ metric: "sessions", change: -0.35, days: 2 }), "medium");
    assert.equal(streakSeverity({ metric: "clicks", change: -0.35, days: 3 }), "high");
  });
});

describe("dedup with the 3-days-vs-14 alerts", () => {
  const old = [
    { id: "client-clicks-down", severity: "medium" as const },
    { id: "client-sessions-down", severity: "high" as const },
    { id: "camp-123-clicks", severity: "high" as const },
    { id: "client-spend", severity: "medium" as const },
  ];

  test("the same metric's older alert gives way to the streak", () => {
    const { alerts, severity } = mergeStreak(old, { covered: ["sessions"], severity: "medium" });
    assert.deepEqual(
      alerts.map((a) => a.id),
      ["client-clicks-down", "camp-123-clicks", "client-spend"]
    );
    // It replaced a Ważne alert, so it is at least Ważne itself.
    assert.equal(severity, "high");
  });

  test("companions count too; campaign-level and other metrics stay", () => {
    const { alerts } = mergeStreak(old, { covered: ["sessions", "clicks"], severity: "high" });
    assert.deepEqual(
      alerts.map((a) => a.id),
      ["camp-123-clicks", "client-spend"]
    );
  });

  test("a Pilne zero-orders alert keeps its urgency inside the streak", () => {
    const { alerts, severity } = mergeStreak(
      [{ id: "ecom-zero-orders", severity: "critical" as const }, { id: "ecom-revenue-drop", severity: "medium" as const }],
      { covered: ["orders"], severity: "high" }
    );
    assert.deepEqual(
      alerts.map((a) => a.id),
      ["ecom-revenue-drop"]
    );
    assert.equal(severity, "critical");
  });

  test("no streak, nothing changes", () => {
    const { alerts, severity } = mergeStreak(old, null);
    assert.equal(alerts.length, old.length);
    assert.equal(severity, null);
  });
});

describe("Polish wording", () => {
  test("weekday forms and prepositions", () => {
    assert.equal(weekdaysPhrase(["2026-11-03", "2026-11-04"]), " we wtorki i środy");
    assert.equal(weekdaysPhrase(["2026-11-02", "2026-11-03", "2026-11-04"]), " w poniedziałki, wtorki i środy");
    assert.equal(weekdaysPhrase(["2026-11-06", "2026-11-07"]), " w piątki i soboty");
    assert.equal(weekdaysPhrase(["2026-11-08", "2026-11-09"]), " w niedziele i poniedziałki");
    assert.equal(weekdaysPhrase(["a", "b", "c", "d"].map((_, i) => addDaysIso("2026-11-01", i))), " w te dni tygodnia");
    assert.equal(weekdaysPhrase(Array.from({ length: 7 }, (_, i) => addDaysIso("2026-11-01", i))), "");
    assert.equal(whenPhrase(["2026-11-03", "2026-11-04"]), "We wtorek i środę");
    assert.equal(whenPhrase(["2026-11-07", "2026-11-08"]), "W sobotę i niedzielę");
    assert.equal(whenPhrase(["2026-11-04", "2026-11-05", "2026-11-06"]), "W środę, czwartek i piątek");
  });

  test("plurals", () => {
    const z = (n: number) => `${n} ${plPlural(n, "zamówienie", "zamówienia", "zamówień")}`;
    assert.equal(z(1), "1 zamówienie");
    assert.equal(z(2), "2 zamówienia");
    assert.equal(z(5), "5 zamówień");
    assert.equal(z(12), "12 zamówień");
    assert.equal(z(22), "22 zamówienia");
    assert.equal(z(104), "104 zamówienia");
    assert.equal(z(0), "0 zamówień");
  });

  test("titles for each metric", () => {
    const t = (metric: StreakMetric, change: number) =>
      streakTitle({ metric, change, capped: false, dates: ["2026-11-03", "2026-11-04"] });
    assert.equal(t("sales", -0.35), "Od 2 dni sprzedaż jest o 35% niższa niż zwykle we wtorki i środy");
    assert.equal(t("purchases", -0.35), "Od 2 dni zakupów z reklam jest o 35% mniej niż zwykle we wtorki i środy");
    assert.equal(t("cr", -0.4), "Od 2 dni konwersja sklepu jest o 40% niższa niż zwykle we wtorki i środy");
    assert.equal(t("cpa", 0.5), "Od 2 dni zakup z reklam kosztuje o 50% więcej niż zwykle we wtorki i środy");
    assert.equal(t("clicks", -0.3), "Od 2 dni kliknięć w reklamy jest o 30% mniej niż zwykle we wtorki i środy");
    assert.equal(t("ctr", -0.3), "Od 2 dni klikalność reklam jest o 30% niższa niż zwykle we wtorki i środy");
  });

  test("money and big numbers keep together", () => {
    const days = lastDays(THURSDAY, SHOP, 2, { sales: 0.5 });
    const alert = buildStreakAlert({ today: THURSDAY, shop: true, days });
    assert.ok(alert);
    assert.equal(
      alert.description,
      "We wtorek i środę: 10 000 zł sprzedaży, a zwykle w te dni ok. 20 000 zł."
    );
  });
});
