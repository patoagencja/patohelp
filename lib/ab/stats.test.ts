import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  addDaysIso,
  betaPosterior,
  computeAbView,
  detectFatigue,
  formatX,
  formatZl,
  normalCdf,
  probAbove,
  probBest,
  verdictFor,
  type AbInput,
  type AbRow,
  type FatiguePeriod,
  type VerdictInput,
} from "./stats.ts";

const NBSP = " ";
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

describe("verdicts", () => {
  const base: VerdictInput = {
    purchases: 40,
    clicks: 1500,
    pBeatRest: 0.5,
    roas: 5,
    setRoas: 5,
    spendShare: 0.3,
    fatigue: null,
  };

  test("too_early below 10 purchases or 200 clicks, with purchases needed", () => {
    const v = verdictFor({ ...base, purchases: 4, clicks: 1000 });
    assert.equal(v.kind, "too_early");
    assert.equal(v.probability, null);
    assert.equal(v.purchasesNeeded, 6);
    assert.equal(v.text, "Za wcześnie - potrzeba jeszcze ok. 6 zakupów");
    assert.equal(verdictFor({ ...base, purchases: 9 }).text, "Za wcześnie - potrzeba jeszcze ok. 1 zakupu");
    const clicksShort = verdictFor({ ...base, purchases: 30, clicks: 150 });
    assert.equal(clicksShort.kind, "too_early");
    assert.equal(clicksShort.purchasesNeeded, 1);
    assert.equal(clicksShort.text, "Za wcześnie - potrzeba jeszcze ok. 50 kliknięć");
    // Exactly at both thresholds the ad is judged.
    assert.equal(verdictFor({ ...base, purchases: 10, clicks: 200 }).kind, "steady");
  });

  test("winner needs P >= 0.95 AND at least the ad set's ROAS", () => {
    const w = verdictFor({ ...base, pBeatRest: 0.97, roas: 6 });
    assert.equal(w.kind, "winner");
    assert.equal(w.probability, 0.97);
    assert.equal(w.text, "97% szans, że sprzedaje lepiej niż reszta zestawu");
    assert.equal(verdictFor({ ...base, pBeatRest: 0.95, roas: 5 }).kind, "winner");
    assert.equal(verdictFor({ ...base, pBeatRest: 0.94, roas: 6 }).kind, "steady");
    assert.equal(verdictFor({ ...base, pBeatRest: 0.99, roas: 4.9 }).kind, "steady");
  });

  test("loser needs P(below) >= 0.95, >= 10% of spend and ROAS < 0.8x the set", () => {
    const l = verdictFor({ ...base, pBeatRest: 0.05, roas: 3.9 });
    assert.equal(l.kind, "loser");
    close(l.probability!, 0.95);
    assert.equal(l.text, "95% szans, że sprzedaje słabiej niż reszta zestawu");
    assert.equal(verdictFor({ ...base, pBeatRest: 0.06, roas: 2 }).kind, "steady");
    assert.equal(verdictFor({ ...base, pBeatRest: 0.01, roas: 2, spendShare: 0.09 }).kind, "steady");
    assert.equal(verdictFor({ ...base, pBeatRest: 0.01, roas: 4 }).kind, "steady"); // 4 = 0.8 x 5
  });

  test("single-ad ad sets are never winners or losers", () => {
    const v = verdictFor({ ...base, pBeatRest: null, alone: true });
    assert.equal(v.kind, "steady");
    assert.equal(v.probability, null);
    assert.equal(v.text, "Jedyna reklama w zestawie - nie ma z czym porównać");
  });

  const before: FatiguePeriod = { spend: 700_000, purchases: 40, value: 6_370_000, frequency: 1.5 };
  const recent: FatiguePeriod = { spend: 300_000, purchases: 8, value: 1_590_000, frequency: 1.8 };

  test("fatigue thresholds", () => {
    const f = detectFatigue(8, before, recent);
    assert.ok(f);
    close(f.roasBefore, 9.1);
    close(f.roasRecent, 5.3);
    assert.equal(f.valueDropPerDay, Math.round(100_000 * 3.8));
    const v = verdictFor({ ...base, fatigue: f });
    assert.equal(v.kind, "fatigue");
    assert.equal(v.text, "Zwrot z reklamy spadł z 9,1× do 5,3× w 3 dni, częstotliwość rośnie");

    assert.equal(detectFatigue(6, before, recent), null); // < 7 days of history
    assert.equal(detectFatigue(8, { ...before, purchases: 9 }, recent), null); // thin baseline
    // ROAS ratio 0.71 > 0.7
    assert.equal(detectFatigue(8, before, { ...recent, value: Math.round(300_000 * 9.1 * 0.71) }), null);
    // Exactly 0.7 counts.
    assert.ok(detectFatigue(8, before, { ...recent, value: Math.round(300_000 * 9.1 * 0.7) }));
    // Frequency falling and low: not fatigue; falling but already >= 3: fatigue.
    assert.equal(detectFatigue(8, before, { ...recent, frequency: 1.2 }), null);
    const high = detectFatigue(8, { ...before, frequency: 3.5 }, { ...recent, frequency: 3.2 });
    assert.ok(high);
    assert.equal(
      verdictFor({ ...base, fatigue: high }).text,
      "Zwrot z reklamy spadł z 9,1× do 5,3× w 3 dni, częstotliwość już 3,2"
    );
    // A few złoty of recent spend can't show a collapse.
    assert.equal(detectFatigue(8, before, { ...recent, spend: 4_000, value: 0 }), null);
  });

  test("precedence: loser > fatigue > winner; fatigue also speaks when the window is thin", () => {
    const f = detectFatigue(8, before, recent);
    assert.equal(verdictFor({ ...base, pBeatRest: 0.01, roas: 2, fatigue: f }).kind, "loser");
    assert.equal(verdictFor({ ...base, pBeatRest: 0.99, roas: 9, fatigue: f }).kind, "fatigue");
    assert.equal(verdictFor({ ...base, purchases: 3, clicks: 100, fatigue: f }).kind, "fatigue");
  });
});

describe("formatting", () => {
  test("pl-PL money and multiples", () => {
    assert.equal(formatZl(124_000), `1${NBSP}240${NBSP}zł`);
    assert.equal(formatZl(99), `1${NBSP}zł`);
    assert.equal(formatX(9.06), "9,1×");
    assert.equal(formatX(5.3), "5,3×");
  });
});

describe("computeAbView", () => {
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

  const rows: AbRow[] = [
    ...days("2026-10-01", today).flatMap((d) => [
      row("Elf 15s", "S1", d, { spend: 100_000, clicks: 500, purchases: 25, value: 1_000_000 }),
      row("Elf Fajtłapa 15s", "S1", d, { spend: 124_000, clicks: 600, purchases: 6, value: 300_000 }),
      row("Solo", "S3", d, { spend: 50_000, clicks: 300, purchases: 5, value: 250_000 }),
    ]),
    ...days("2026-10-06", today).map((d) =>
      row("Nowa", "S1", d, { spend: 60_000, clicks: 30, purchases: 1, value: 40_000 })
    ),
    // Spent only before the window (and before the fatigue look-back).
    row("Stara", "S2", "2026-09-20", { spend: 80_000, clicks: 400, purchases: 9, value: 500_000 }),
  ];

  const input: AbInput = {
    windowKey: "7d",
    start: "2026-10-01",
    end: today,
    today,
    rows,
    marketOf: (name) => (name.includes("PL") ? "PL" : null),
  };

  test("verdicts, tests and actions on a realistic ad set", () => {
    const view = computeAbView(input);
    assert.equal(view.available, true);
    assert.equal(view.adCount, 4);
    // Ad sets without spend in the window are left out; biggest spender first.
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
    assert.equal(byId["Nowa"].probBest, null); // under 200 clicks: not ranked
    assert.equal(s1.leaderAdId, "Elf 15s");
    assert.equal(byId["Elf 15s"].market, "PL");
    assert.equal(byId["Nowa"].daily.length, 7);
    assert.equal(byId["Nowa"].daily[0].spend, 0);
    assert.equal(byId["Nowa"].firstDate, "2026-10-06");
    assert.equal(view.tests[1].ads[0].verdict.text, "Jedyna reklama w zestawie - nie ma z czym porównać");

    assert.deepEqual(
      view.actions.map((a) => a.kind),
      ["scale", "cut", "watch"]
    );
    const cut = view.actions[1];
    assert.equal(cut.title, `Wyłącz: «Elf Fajtłapa 15s» przepala 1${NBSP}240${NBSP}zł dziennie`);
    assert.equal(cut.impactPerDay, 124_000);
    for (let i = 1; i < view.actions.length; i++) {
      assert.ok(view.actions[i - 1].impactPerDay >= view.actions[i].impactPerDay);
    }
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

  test("a finished season window gives verdicts but no actions", () => {
    const view = computeAbView({ ...input, windowKey: "season", end: "2026-10-05", today: "2026-12-01" });
    assert.equal(view.actions.length, 0);
    assert.ok(view.tests.length > 0);
  });

  test("fatigue reads the look-back before a short window", () => {
    const fatigueRows: AbRow[] = [
      ...days(addDaysIso(today, -10), addDaysIso(today, -4)).map((d) =>
        row("F1", "S4", d, { spend: 100_000, clicks: 400, purchases: 10, value: 900_000, frequency: 1.5 })
      ),
      ...days(addDaysIso(today, -3), addDaysIso(today, -1)).map((d) =>
        row("F1", "S4", d, { spend: 100_000, clicks: 400, purchases: 6, value: 500_000, frequency: 1.9 })
      ),
      row("F1", "S4", today, { spend: 50_000, clicks: 200, purchases: 3, value: 250_000, frequency: 1.4 }),
    ];
    const view = computeAbView({
      windowKey: "3d",
      start: addDaysIso(today, -2),
      end: today,
      today,
      rows: fatigueRows,
    });
    const ad = view.tests[0].ads[0];
    assert.equal(ad.verdict.kind, "fatigue");
    assert.equal(ad.verdict.text, "Zwrot z reklamy spadł z 9,0× do 5,0× w 3 dni, częstotliwość rośnie");
    assert.equal(ad.daily.length, 3);
    assert.equal(view.actions[0].kind, "refresh");
    assert.equal(view.actions[0].impactPerDay, 400_000);
  });
});
