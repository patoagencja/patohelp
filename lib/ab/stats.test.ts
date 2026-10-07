import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  addDaysIso,
  analyzeAb,
  betaPosterior,
  buildAbSeries,
  computeAbView,
  detectFatigue,
  fixedWindow,
  formatPct,
  formatX,
  formatZl,
  normalCdf,
  probAbove,
  probAboveBy,
  probBest,
  verdictFor,
  type AbInput,
  type AbRow,
  type FatiguePeriod,
  type VerdictInput,
} from "./stats.ts";

const NBSP = "\u00a0";
const close = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b} (eps ${eps})`);

describe("Beta posterior probabilities", () => {
  test("posterior mean and variance follow Beta(1 + s, 1 + f)", () => {
    const p = betaPosterior(10, 200); // Beta(11, 191)
    close(p.mean, 11 / 202);
    close(p.variance, (11 * 191) / (202 * 202 * 203));
    // View-through purchases above clicks: failures floored at 0, no NaN.
    const odd = betaPosterior(5, 3);
    close(odd.mean, 6 / 7);
  });

  test("normal CDF is symmetric and calibrated", () => {
    close(normalCdf(0), 0.5);
    close(normalCdf(1.96), 0.975, 1e-4);
    for (const x of [0.1, 0.7, 1.645, 3.2]) close(normalCdf(x) + normalCdf(-x), 1, 1e-12);
  });

  test("P(a > b) and P(b > a) add up to 1; equal arms give 0.5", () => {
    const a = { purchases: 30, clicks: 1000 };
    const b = { purchases: 18, clicks: 900 };
    close(probAbove(a, b) + probAbove(b, a), 1, 1e-12);
    close(probAbove(a, a), 0.5);
  });

  test("a margin makes the bar harder: P(a > 1.05 b) < P(a > b) < P(a > 0.9 b)", () => {
    const a = { purchases: 300, clicks: 10_000 };
    const b = { purchases: 280, clicks: 10_000 };
    assert.ok(probAboveBy(a, b, 1.05) < probAbove(a, b));
    assert.ok(probAbove(a, b) < probAboveBy(a, b, 0.9));
    close(probAboveBy(a, b, 1), probAbove(a, b), 1e-15);
  });

  test("P(a > b) rises with a's purchases and falls with its clicks", () => {
    const rest = { purchases: 20, clicks: 1000 };
    let prev = -1;
    for (const purchases of [5, 10, 20, 30, 45]) {
      const p = probAbove({ purchases, clicks: 1000 }, rest);
      assert.ok(p > prev, `not increasing at ${purchases}`);
      prev = p;
    }
    prev = 2;
    for (const clicks of [600, 800, 1000, 1400]) {
      const p = probAbove({ purchases: 25, clicks }, rest);
      assert.ok(p < prev, `not decreasing at ${clicks}`);
      prev = p;
    }
  });

  test("probBest is deterministic, sums to 1 and favours the better arm", () => {
    const arms = [
      { purchases: 40, clicks: 1000 },
      { purchases: 25, clicks: 1000 },
      { purchases: 24, clicks: 900 },
    ];
    const one = probBest(arms, 12345);
    const two = probBest(arms, 12345);
    assert.deepEqual(one, two);
    close(one.reduce((s, p) => s + p, 0), 1, 1e-9);
    assert.ok(one[0] > 0.9, `best arm only ${one[0]}`);
    assert.deepEqual(probBest([arms[0]], 1), [1]);
    assert.deepEqual(probBest([], 1), []);
    // Identical arms split roughly evenly.
    const even = probBest([arms[1], arms[1], arms[1], arms[1]], 7);
    for (const p of even) assert.ok(Math.abs(p - 0.25) < 0.05, `uneven ${p}`);
  });
});

describe("periods", () => {
  test("decision periods are finished days; 'today' is today alone", () => {
    const today = "2026-12-09";
    assert.deepEqual(fixedWindow("today", today), { start: today, end: today });
    assert.deepEqual(fixedWindow("3d", today), { start: "2026-12-06", end: "2026-12-08" });
    assert.deepEqual(fixedWindow("7d", today), { start: "2026-12-02", end: "2026-12-08" });
    assert.deepEqual(fixedWindow("30d", today), { start: "2026-11-09", end: "2026-12-08" });
  });
});

describe("verdicts", () => {
  // 1 500 clicks / 40 purchases against a rest of 6 000 / 160: same rate.
  const base: VerdictInput = {
    ad: { purchases: 40, clicks: 1500 },
    rest: { purchases: 160, clicks: 6000 },
    deliveryDays: 7,
    roas: 5,
    restRoas: 5,
    spendShare: 0.3,
    dailySpend: 50_000,
    fatigue: null,
  };

  test("too_early below 10 purchases, 200 clicks or 3 finished days", () => {
    const v = verdictFor({ ...base, ad: { purchases: 4, clicks: 150 } });
    assert.equal(v.kind, "too_early");
    assert.equal(v.probability, null);
    assert.equal(v.purchasesNeeded, 6);
    assert.equal(v.text, "Za wcześnie - potrzeba jeszcze ok. 6 zakupów");
    assert.equal(
      verdictFor({ ...base, ad: { purchases: 9, clicks: 340 } }).text,
      "Za wcześnie - potrzeba jeszcze ok. 1 zakupu"
    );
    const clicksShort = verdictFor({ ...base, ad: { purchases: 30, clicks: 150 } });
    assert.equal(clicksShort.kind, "too_early");
    assert.equal(clicksShort.text, "Za wcześnie - potrzeba jeszcze ok. 50 kliknięć");
    const daysShort = verdictFor({ ...base, deliveryDays: 2 });
    assert.equal(daysShort.kind, "too_early");
    assert.equal(daysShort.text, "Za wcześnie - oceniamy po 3 pełnych dniach emisji (na razie 2 dni)");
    assert.equal(
      verdictFor({ ...base, deliveryDays: 1 }).text,
      "Za wcześnie - oceniamy po 3 pełnych dniach emisji (na razie 1 dzień)"
    );
    // Exactly at every threshold the ad is judged.
    assert.equal(
      verdictFor({ ...base, ad: { purchases: 10, clicks: 375 }, deliveryDays: 3 }).kind,
      "steady"
    );
  });

  test("winner: P >= 0.95, P(lift > 5%) >= 0.9 and ROAS >= 1.15x the rest", () => {
    const strong = { purchases: 80, clicks: 1500 }; // 5.3% vs 2.7%
    const w = verdictFor({ ...base, ad: strong, roas: 6 });
    assert.equal(w.kind, "winner");
    assert.ok(w.probability! > 0.99);
    assert.equal(w.text, "99% szans, że sprzedaje lepiej niż reszta zestawu (zwrot 6,0× wobec 5,0× w reszcie zestawu)");
    // Exactly 1.15x counts; just under does not.
    assert.equal(verdictFor({ ...base, ad: strong, roas: 5.75 }).kind, "winner");
    const thin = verdictFor({ ...base, ad: strong, roas: 5.7 });
    assert.equal(thin.kind, "steady");
    assert.equal(
      thin.text,
      "Sprzedaje częściej niż reszta zestawu (99% szans), ale zwrot 5,7× nie przebija reszty zestawu (5,0×) o 15%"
    );
  });

  test("winner needs a minimum effect: 2.10% vs 2.00% at a million clicks is certain but tiny", () => {
    const ad = { purchases: 21_000, clicks: 1_000_000 };
    const rest = { purchases: 20_000, clicks: 1_000_000 };
    assert.ok(probAbove(ad, rest) > 0.99);
    assert.ok(probAboveBy(ad, rest, 1.05) < 0.9);
    const v = verdictFor({ ...base, ad, rest, roas: null, restRoas: null });
    assert.equal(v.kind, "steady");
    assert.equal(v.text, "Sprzedaje częściej niż reszta zestawu (99% szans), ale przewaga może być mniejsza niż 5%");
    // 2.4% vs 2.0%: the lift is clearly above 5%.
    assert.equal(
      verdictFor({ ...base, ad: { purchases: 24_000, clicks: 1_000_000 }, rest, roas: null, restRoas: null }).kind,
      "winner"
    );
  });

  test("loser: P(worse) >= 0.95, >= 10% of spend, ROAS <= 0.8x the rest", () => {
    const weak = { purchases: 20, clicks: 1500 }; // 1.3% vs 2.7%
    const l = verdictFor({ ...base, ad: weak, roas: 3.9 });
    assert.equal(l.kind, "loser");
    assert.ok(l.probability! > 0.99);
    assert.equal(l.text, "99% szans, że sprzedaje słabiej niż reszta zestawu (zwrot 3,9× wobec 5,0× w reszcie zestawu)");
    assert.equal(verdictFor({ ...base, ad: weak, roas: 4 }).kind, "loser"); // exactly 0.8x
    const near = verdictFor({ ...base, ad: weak, roas: 4.1 });
    assert.equal(near.kind, "steady");
    assert.equal(near.text, "99% szans, że sprzedaje słabiej niż reszta zestawu, ale zwrot 4,1× nie odstaje od reszty zestawu (5,0×)");
    const small = verdictFor({ ...base, ad: weak, roas: 2, spendShare: 0.09 });
    assert.equal(small.kind, "steady");
    assert.equal(small.text, "99% szans, że sprzedaje słabiej niż reszta zestawu, ale wydaje tylko 9% budżetu zestawu");
  });

  test("big spenders (> 1 000 zł a day) need 97.5% to be called losers", () => {
    const rest = { purchases: 300, clicks: 10_000 };
    const ad = { purchases: 125, clicks: 5_000 };
    const pWorse = 1 - probAbove(ad, rest);
    assert.ok(pWorse > 0.95 && pWorse < 0.975, `pWorse ${pWorse}`);
    const input = { ...base, ad, rest, roas: 3, restRoas: 5 };
    assert.equal(verdictFor({ ...input, dailySpend: 100_000 }).kind, "loser"); // exactly 1 000 zł
    const big = verdictFor({ ...input, dailySpend: 150_000 });
    assert.equal(big.kind, "steady");
    assert.equal(
      big.text,
      `96% szans, że sprzedaje słabiej niż reszta zestawu - przy ponad 1${NBSP}000${NBSP}zł dziennie czekamy na 97,5% pewności`
    );
  });

  test("an ad that spends but barely sells is a loser, not 'too early'", () => {
    // 2 purchases on 4 998 clicks, half the set's spend; the rest sold 147 on as many.
    const v = verdictFor({
      ...base,
      ad: { purchases: 2, clicks: 4998 },
      rest: { purchases: 147, clicks: 4998 },
      roas: 0.2,
      restRoas: 5,
      spendShare: 0.5,
      dailySpend: 42_857,
    });
    assert.equal(v.kind, "loser");
    // At the rest's rate its clicks would have bought under 10: still too early.
    const tiny = verdictFor({
      ...base,
      ad: { purchases: 0, clicks: 300 },
      rest: { purchases: 147, clicks: 4998 },
      roas: 0,
      spendShare: 0.5,
    });
    assert.equal(tiny.kind, "too_early");
  });

  test("without purchase value a loser must sell 10%+ less (2.00% vs 2.06% at 1M clicks is not one)", () => {
    const rest = { purchases: 20_600, clicks: 1_000_000 };
    const ad = { purchases: 20_000, clicks: 1_000_000 };
    assert.ok(1 - probAbove(ad, rest) > 0.99);
    const v = verdictFor({ ...base, ad, rest, roas: null, restRoas: null });
    assert.equal(v.kind, "steady");
    assert.equal(v.text, "99% szans, że sprzedaje słabiej niż reszta zestawu, ale różnica jest za mała, by wyłączać");
    assert.equal(
      verdictFor({ ...base, ad: { purchases: 17_000, clicks: 1_000_000 }, rest, roas: null, restRoas: null }).kind,
      "loser"
    );
  });

  test("single-ad ad sets are never winners or losers", () => {
    const v = verdictFor({ ...base, rest: null, alone: true });
    assert.equal(v.kind, "steady");
    assert.equal(v.probability, null);
    assert.equal(v.text, "Jedyna reklama w zestawie - nie ma z czym porównać");
  });

  const before: FatiguePeriod = { spend: 700_000, purchases: 40, value: 6_370_000, frequency: 1.5 };
  const recent: FatiguePeriod = { spend: 300_000, purchases: 8, value: 1_590_000, frequency: 1.8 };

  test("fatigue: own fall relative to the rest's, frequency +15%", () => {
    const f = detectFatigue(8, before, recent);
    assert.ok(f);
    close(f.roasBefore, 9.1);
    close(f.roasRecent, 5.3);
    assert.equal(f.restTrend, 1);
    assert.equal(f.valueDropPerDay, Math.round(100_000 * (9.1 - 5.3)));
    const v = verdictFor({ ...base, fatigue: f });
    assert.equal(v.kind, "fatigue");
    assert.equal(
      v.text,
      "Zwrot spadł z 9,1× do 5,3× w ostatnich 3 dniach (wobec tygodnia wcześniej), częstotliwość rośnie"
    );

    assert.equal(detectFatigue(6, before, recent), null); // < 7 days of history
    assert.equal(detectFatigue(8, { ...before, purchases: 9 }, recent), null); // thin baseline
    // Relative ratio: exactly 0.75 counts, 0.76 doesn't.
    assert.ok(detectFatigue(8, before, { ...recent, value: Math.round(300_000 * 9.1 * 0.75) }));
    assert.equal(detectFatigue(8, before, { ...recent, value: Math.round(300_000 * 9.1 * 0.76) }), null);
    // A few złoty of recent spend can't show a collapse.
    assert.equal(detectFatigue(8, before, { ...recent, spend: 4_000, value: 0 }), null);
  });

  test("fatigue: flat or slightly rising frequency is not 'rising'; >= 3 already is enough", () => {
    assert.equal(detectFatigue(8, before, { ...recent, frequency: 1.5 }), null); // flat
    assert.equal(detectFatigue(8, before, { ...recent, frequency: 1.65 }), null); // +10%
    assert.ok(detectFatigue(8, before, { ...recent, frequency: 1.725 })); // +15%
    const high = detectFatigue(8, { ...before, frequency: 3.5 }, { ...recent, frequency: 3.2 });
    assert.ok(high);
    assert.equal(high.frequencyRising, false);
    assert.equal(
      verdictFor({ ...base, fatigue: high }).text,
      "Zwrot spadł z 9,1× do 5,3× w ostatnich 3 dniach (wobec tygodnia wcześniej), częstotliwość już 3,2"
    );
  });

  test("fatigue is relative: the whole set cooling after a peak is not one ad wearing out", () => {
    const restBefore: FatiguePeriod = { spend: 1_000_000, purchases: 100, value: 9_100_000, frequency: 1.4 };
    // The rest fell exactly as much: relative 1.
    const sameFall = { before: restBefore, recent: { spend: 400_000, purchases: 25, value: 2_120_000, frequency: 1.4 } };
    assert.equal(detectFatigue(8, before, recent, sameFall), null);
    // The rest fell 10%: the ad's own part of the fall still counts, and the
    // money at stake is measured against the rest's trend.
    const mild = { before: restBefore, recent: { spend: 400_000, purchases: 40, value: Math.round(400_000 * 9.1 * 0.9), frequency: 1.4 } };
    const f = detectFatigue(8, before, recent, mild);
    assert.ok(f);
    close(f.restTrend, 0.9, 1e-6);
    assert.equal(f.valueDropPerDay, Math.round(100_000 * (9.1 * f.restTrend - 5.3)));
    // A rest too thin to have a trend is ignored (trend 1).
    const thin = { before: { ...restBefore, purchases: 5 }, recent: sameFall.recent };
    assert.equal(detectFatigue(8, before, recent, thin)?.restTrend, 1);
  });

  test("precedence: loser > fatigue > winner; fatigue also speaks when the period is thin", () => {
    const f = detectFatigue(8, before, recent);
    assert.equal(verdictFor({ ...base, ad: { purchases: 20, clicks: 1500 }, roas: 2, fatigue: f }).kind, "loser");
    assert.equal(verdictFor({ ...base, ad: { purchases: 80, clicks: 1500 }, roas: 9, fatigue: f }).kind, "fatigue");
    assert.equal(verdictFor({ ...base, ad: { purchases: 3, clicks: 100 }, fatigue: f }).kind, "fatigue");
  });
});

describe("formatting", () => {
  test("pl-PL money, multiples and thresholds", () => {
    assert.equal(formatZl(124_000), `1${NBSP}240${NBSP}zł`);
    assert.equal(formatZl(99), `1${NBSP}zł`);
    assert.equal(formatX(9.06), "9,1×");
    assert.equal(formatX(5.3), "5,3×");
    assert.equal(formatPct(0.975), "97,5%");
    assert.equal(formatPct(0.95), "95%");
    assert.equal(formatPct(1 - 0.9), "10%");
  });
});

// ------------------------------------------------------------------ the whole view

const today = "2026-10-07";

function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

function row(adId: string, adsetId: string, date: string, r: Partial<AbRow>): AbRow {
  return {
    date,
    adId,
    adName: adId,
    adsetId,
    adsetName: `Zestaw ${adsetId}`,
    campaignId: "c1",
    campaignName: "PL | Sezon",
    spend: 0,
    impressions: 10_000,
    clicks: 0,
    reach: 8_000,
    frequency: 1.25,
    purchases: 0,
    value: 0,
    video3s: null,
    ...r,
  };
}

const roasOf = (value: number, spend: number) => value / spend;

describe("computeAbView", () => {
  const finished = days("2026-09-30", "2026-10-06");
  const rows: AbRow[] = [
    ...finished.flatMap((d) => [
      row("Elf 15s", "S1", d, { spend: 100_000, clicks: 500, purchases: 25, value: 1_000_000 }),
      row("Elf Fajtłapa 15s", "S1", d, { spend: 124_000, clicks: 600, purchases: 6, value: 300_000 }),
      row("Solo", "S3", d, { spend: 50_000, clicks: 300, purchases: 5, value: 250_000 }),
    ]),
    ...days("2026-10-05", "2026-10-06").map((d) =>
      row("Nowa", "S1", d, { spend: 60_000, clicks: 30, purchases: 1, value: 40_000 })
    ),
    // Spent only before the period (and before the fatigue look-back).
    row("Stara", "S2", "2026-09-20", { spend: 80_000, clicks: 400, purchases: 9, value: 500_000 }),
  ];
  // Today so far: the winner's purchases haven't been attributed yet.
  const todayRows: AbRow[] = [
    row("Elf 15s", "S1", today, { spend: 40_000, clicks: 200, purchases: 0, value: 0 }),
    row("Elf Fajtłapa 15s", "S1", today, { spend: 50_000, clicks: 240, purchases: 9, value: 900_000 }),
  ];

  const input: AbInput = {
    windowKey: "7d",
    start: "2026-09-30",
    end: "2026-10-06",
    today,
    rows,
    marketOf: (name) => (name.includes("PL") ? "PL" : null),
  };

  test("verdicts, tests and actions on a realistic ad set", () => {
    const view = computeAbView(input);
    assert.equal(view.available, true);
    assert.equal(view.monitor, false);
    assert.equal(view.adCount, 4);
    // Ad sets without spend in the period are left out; biggest spender first.
    assert.deepEqual(
      view.tests.map((t) => t.adsetId),
      ["S1", "S3"]
    );
    const s1 = view.tests[0];
    assert.deepEqual(
      s1.ads.map((a) => a.adId),
      ["Elf Fajtłapa 15s", "Elf 15s", "Nowa"]
    );
    const byId = Object.fromEntries(s1.ads.map((a) => [a.adId, a]));
    assert.equal(byId["Elf 15s"].verdict.kind, "winner");
    assert.equal(byId["Elf Fajtłapa 15s"].verdict.kind, "loser");
    assert.equal(byId["Nowa"].verdict.kind, "too_early");
    assert.equal(byId["Nowa"].deliveryDays, 2);
    assert.equal(byId["Nowa"].probBest, null); // under 200 clicks: not ranked
    assert.equal(s1.leaderAdId, "Elf 15s");
    assert.equal(byId["Elf 15s"].market, "PL");
    assert.equal(byId["Nowa"].firstDate, "2026-10-05");
    assert.equal(view.tests[1].ads[0].verdict.text, "Jedyna reklama w zestawie - nie ma z czym porównać");
    // One day-total series for the sparklines, no per-ad series.
    assert.equal(view.days.length, 7);
    assert.equal(view.days[0].spend, 100_000 + 124_000 + 50_000);
    assert.ok(!("daily" in byId["Elf 15s"]));

    // Same unit (sales per day), biggest first; ads to watch after decisions.
    assert.deepEqual(
      view.actions.map((a) => a.kind),
      ["cut", "scale", "watch"]
    );
    const [cut, scale] = view.actions;
    // Cut: the ad's daily spend x (rest ROAS - its ROAS), the rest on its days.
    const restOfLoser = roasOf(7 * 1_000_000 + 2 * 40_000, 7 * 100_000 + 2 * 60_000);
    assert.equal(cut.impactPerDay, Math.round(124_000 * (restOfLoser - roasOf(300_000, 124_000))));
    // 868 000 / 42 purchases against (700 000 + 120 000) / 177 on the same days.
    assert.equal(cut.title, "Wyłącz „Elf Fajtłapa 15s”: zakup 4,5× droższy niż w reszcie zestawu");
    assert.doesNotMatch(cut.title + cut.detail, /przepala|oszczędz/);
    // Scale: half of +30% of daily spend x (its ROAS - rest ROAS).
    const restOfWinner = roasOf(7 * 300_000 + 2 * 40_000, 7 * 124_000 + 2 * 60_000);
    assert.equal(scale.impactPerDay, Math.round(0.5 * 0.3 * 100_000 * (10 - restOfWinner)));
    assert.equal(
      scale.title,
      "Daj więcej budżetu „Elf 15s”: wyłącz słabsze reklamy w zestawie albo przenieś ją do osobnego zestawu"
    );
  });

  test("today never enters a decision: the period is cut at yesterday", () => {
    const withToday = computeAbView({ ...input, end: today, rows: [...rows, ...todayRows] });
    const without = computeAbView(input);
    assert.equal(withToday.end, "2026-10-06");
    assert.deepEqual(withToday, without);
  });

  test("'Dziś' is a preview: today's numbers, no verdicts, chances or actions", () => {
    const view = computeAbView({ ...input, windowKey: "today", start: today, end: today, rows: [...rows, ...todayRows] });
    assert.equal(view.monitor, true);
    assert.equal(view.totals.spend, 90_000);
    assert.deepEqual(view.actions, []);
    for (const t of view.tests) {
      assert.equal(t.leaderAdId, null);
      for (const a of t.ads) {
        assert.equal(a.verdict.kind, "preview");
        assert.equal(a.probBest, null);
      }
    }
  });

  test("a big spender is compared with the REST of its set, not a total that contains itself", () => {
    // A: 70% of the set at ROAS 4; B: ROAS 6. The set total (4.6) would let
    // A pass (4 > 0.8 x 4.6); against the rest it is clearly a loser.
    const big = finished.flatMap((d) => [
      row("A", "S", d, { spend: 70_000, clicks: 700, purchases: 14, value: 280_000 }),
      row("B", "S", d, { spend: 30_000, clicks: 300, purchases: 9, value: 180_000 }),
    ]);
    const { view, ads } = analyzeAb({ ...input, rows: big });
    const [a, b] = view.tests[0].ads;
    assert.equal(a.adId, "A");
    assert.equal(a.verdict.kind, "loser");
    assert.equal(b.verdict.kind, "winner");
    assert.equal(ads.find((x) => x.ad.adId === "A")!.restRoas, 6);
    const cut = view.actions.find((x) => x.kind === "cut")!;
    assert.equal(cut.impactPerDay, 70_000 * (6 - 4));
    assert.equal(cut.title, "Wyłącz „A”: zakup 1,5× droższy niż w reszcie zestawu");
  });

  test("an ad is compared with the rest only on the days it delivered", () => {
    // The old ad sold at 4% / ROAS 10 early in the week, then everything
    // slowed to 2% / ROAS 5 - exactly when the new ad started. On the same
    // days they are equal; against the rest's whole week the newcomer would
    // look like a loser.
    const slump = [
      ...days("2026-09-30", "2026-10-03").map((d) =>
        row("Old", "S", d, { spend: 100_000, clicks: 1000, purchases: 40, value: 1_000_000 })
      ),
      ...days("2026-10-04", "2026-10-06").flatMap((d) => [
        row("Old", "S", d, { spend: 100_000, clicks: 1000, purchases: 20, value: 500_000 }),
        row("New", "S", d, { spend: 100_000, clicks: 1000, purchases: 20, value: 500_000 }),
      ]),
    ];
    const view = computeAbView({ ...input, rows: slump });
    const ad = view.tests[0].ads.find((a) => a.adId === "New")!;
    assert.equal(ad.deliveryDays, 3);
    assert.equal(ad.verdict.kind, "steady");
    assert.equal(ad.verdict.text, "W normie - 50% szans, że sprzedaje lepiej niż reszta zestawu");
  });

  test("at most one 'Zwiększ budżet' per ad set: the one with the most at stake", () => {
    const twoWinners = finished.flatMap((d) => [
      row("W1", "S", d, { spend: 50_000, clicks: 500, purchases: 20, value: 400_000 }),
      row("W2", "S", d, { spend: 40_000, clicks: 400, purchases: 16, value: 320_000 }),
      row("L", "S", d, { spend: 60_000, clicks: 600, purchases: 6, value: 120_000 }),
    ]);
    const view = computeAbView({ ...input, rows: twoWinners });
    const byId = Object.fromEntries(view.tests[0].ads.map((a) => [a.adId, a]));
    assert.equal(byId.W1.verdict.kind, "winner");
    assert.equal(byId.W2.verdict.kind, "winner");
    assert.equal(view.tests[0].leaderAdId, null); // neither is clearly THE best
    const scales = view.actions.filter((a) => a.kind === "scale");
    assert.deepEqual(
      scales.map((a) => a.adId),
      ["W1"]
    );
    assert.equal(scales[0].impactPerDay, Math.round(0.5 * 0.3 * 50_000 * (8 - roasOf(440_000, 100_000))));
    // The cut has far more at stake and comes first.
    assert.deepEqual(
      view.actions.map((a) => a.kind),
      ["cut", "scale"]
    );
    assert.equal(view.actions[0].impactPerDay, 60_000 * (8 - 2));
  });

  test("deterministic across renders", () => {
    assert.deepEqual(computeAbView(input), computeAbView(input));
  });

  test("ads already switched off get no action", () => {
    const view = computeAbView({
      ...input,
      meta: { "Elf Fajtłapa 15s": { thumbnailUrl: null, status: "PAUSED", createdTime: null } },
    });
    assert.ok(!view.actions.some((a) => a.kind === "cut"));
  });

  test("a finished season's period gives verdicts but no actions", () => {
    const view = computeAbView({ ...input, windowKey: "season", end: "2026-10-05", today: "2026-12-01" });
    assert.equal(view.actions.length, 0);
    assert.ok(view.tests.length > 0);
  });
});

describe("fatigue in the view", () => {
  // F and G sold alike for a week (ROAS 9); in the last 3 finished days F
  // fell to ROAS 5 with its frequency up from 1.5 to 1.9.
  const beforeDays = days(addDaysIso(today, -10), addDaysIso(today, -4));
  const recentDays = days(addDaysIso(today, -3), addDaysIso(today, -1));
  const earlier = { spend: 100_000, clicks: 400, purchases: 10, value: 900_000, frequency: 1.5 };
  const fallen = { spend: 100_000, clicks: 400, purchases: 6, value: 500_000, frequency: 1.9 };
  const rowsFor = (gRecent: Partial<AbRow>): AbRow[] => [
    ...beforeDays.flatMap((d) => [row("F", "S4", d, earlier), row("G", "S4", d, earlier)]),
    ...recentDays.flatMap((d) => [row("F", "S4", d, fallen), row("G", "S4", d, gRecent)]),
  ];
  const input = (rows: AbRow[], moments?: AbInput["moments"]): AbInput => ({
    windowKey: "7d",
    start: addDaysIso(today, -7),
    end: addDaysIso(today, -1),
    today,
    rows,
    moments,
  });

  test("an ad falling while the rest holds is tired: refresh, money against the rest's trend", () => {
    const view = computeAbView(input(rowsFor(earlier)));
    const f = view.tests[0].ads.find((a) => a.adId === "F")!;
    assert.equal(f.verdict.kind, "fatigue");
    assert.equal(
      f.verdict.text,
      "Zwrot spadł z 9,0× do 5,0× w ostatnich 3 dniach (wobec tygodnia wcześniej), częstotliwość rośnie"
    );
    const refresh = view.actions.find((a) => a.kind === "refresh")!;
    assert.equal(refresh.adId, "F");
    assert.equal(refresh.impactPerDay, 100_000 * (9 - 5));
  });

  test("a seasonal peak is NOT fatigue: the whole set falls together after it", () => {
    const view = computeAbView(input(rowsFor(fallen)));
    for (const ad of view.tests[0].ads) assert.notEqual(ad.verdict.kind, "fatigue");
    assert.ok(!view.actions.some((a) => a.kind === "refresh"));
  });

  test("near a known sales moment (±1 day) fatigue is not judged at all", () => {
    const peak = [{ date: addDaysIso(today, -11), label: "Mikołajki" }]; // a day before the look-back
    const view = computeAbView(input(rowsFor(earlier), peak));
    const f = view.tests[0].ads.find((a) => a.adId === "F")!;
    assert.equal(f.verdict.kind, "steady");
    assert.equal(
      f.verdict.text,
      "Zwrot spadł z 9,0× do 5,0× w ostatnich 3 dniach, ale to okolice szczytu sprzedaży (Mikołajki) - zmęczenia wtedy nie oceniamy"
    );
    assert.ok(!view.actions.some((a) => a.kind === "refresh"));
    // Two days before the look-back is far enough.
    const far = computeAbView(input(rowsFor(earlier), [{ date: addDaysIso(today, -12), label: "Mikołajki" }]));
    assert.equal(far.tests[0].ads.find((a) => a.adId === "F")!.verdict.kind, "fatigue");
  });

  test("every ad's action is kept for the alerts, even past the list's cut", () => {
    const { ads } = analyzeAb(input(rowsFor(earlier)));
    assert.equal(ads.find((a) => a.ad.adId === "F")!.action?.kind, "refresh");
    assert.equal(ads.find((a) => a.ad.adId === "G")!.action, null);
  });
});

describe("compare series", () => {
  test("zero-filled per ad over the requested days, other ads ignored", () => {
    const s = buildAbSeries(["a", "b"], "2026-10-01", "2026-10-03", [
      { date: "2026-10-02", adId: "a", spend: 100, impressions: 10, clicks: 2, purchases: 1, value: 500 },
      { date: "2026-10-02", adId: "z", spend: 999, impressions: 1, clicks: 1, purchases: 1, value: 1 },
      { date: "2026-10-09", adId: "b", spend: 999, impressions: 1, clicks: 1, purchases: 1, value: 1 },
    ]);
    assert.deepEqual(
      s.map((x) => x.adId),
      ["a", "b"]
    );
    assert.deepEqual(
      s[0].days.map((d) => d.spend),
      [0, 100, 0]
    );
    assert.deepEqual(
      s[1].days.map((d) => d.date),
      ["2026-10-01", "2026-10-02", "2026-10-03"]
    );
    assert.ok(s[1].days.every((d) => d.spend === 0));
  });
});
