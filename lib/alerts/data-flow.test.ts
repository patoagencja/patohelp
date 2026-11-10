import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  addDaysIso,
  advanceGuard,
  buildFlowAlert,
  cartBaselineFrom,
  cartTodayFrom,
  checkDue,
  clockLabel,
  dailyDue,
  dayShare,
  flowSince,
  incidentId,
  judgeCheckout,
  judgeFeed,
  judgeGa4,
  judgeMetaPixel,
  localClock,
  metaBaselineFrom,
  openFlowAlerts,
  plPlural,
  profileFrom,
  recordRealtime,
  rememberPush,
  runFlowCheck,
  usualRealtime,
  CONFIRM_CHECKS,
  FLOW_GUARDS,
  OPEN_TTL_MIN,
  RT_BASE_WEEKDAY_DAYS,
  type CartBaseline,
  type EcomHourRow,
  type FlowIncident,
  type FlowInput,
  type FlowState,
  type HourEcom,
  type MetaBaseline,
  type Reading,
  type Verdict,
} from "./data-flow.ts";

// November: Warsaw is UTC+1. 2026-11-05 is a Thursday.
const OFFSET = 60;
const THURSDAY = "2026-11-05";
const SATURDAY = "2026-11-07";

/** Warsaw wall clock -> ISO instant. */
const at = (day: string, hhmm: string): string =>
  new Date(Date.parse(`${day}T${hhmm}:00Z`) - OFFSET * 60_000).toISOString();

const clockAt = (day: string, hhmm: string) => localClock(at(day, hhmm), OFFSET);

const mod = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

const hhmmOf = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Every check of a day: 7:25, 7:55, ... 22:55. */
const CHECK_TIMES: string[] = [];
for (let m = 7 * 60 + 25; m <= 22 * 60 + 55; m += 30) CHECK_TIMES.push(hhmmOf(m));

const SALES_WORDS = /sprzeda|zamówie|zakup|koszyk|kas[aey]|ROAS|przych/i;

const bad = (v: Verdict) => {
  assert.equal(v.kind, "bad", JSON.stringify(v));
  return v as Extract<Verdict, { kind: "bad" }>;
};

describe("clock", () => {
  test("Warsaw wall clock in winter and summer", () => {
    assert.deepEqual(localClock("2026-11-05T13:25:00Z", 60), {
      day: THURSDAY,
      hour: 14,
      minute: 25,
      mod: 865,
      weekday: 4,
    });
    assert.equal(localClock("2026-07-02T13:25:00Z", 120).hour, 15);
    // 23:30 UTC is already tomorrow in Warsaw.
    assert.equal(localClock("2026-11-05T23:30:00Z", 60).day, "2026-11-06");
  });

  test("clock labels and day arithmetic", () => {
    assert.equal(clockLabel(835), "13:55");
    assert.equal(clockLabel(545), "9:05");
    assert.equal(clockLabel(-10), "0:00");
    assert.equal(addDaysIso("2026-03-01", -1), "2026-02-28");
  });

  test("a check is due 20 minutes after the previous one", () => {
    assert.equal(checkDue(null, at(THURSDAY, "10:25")), true);
    const prev: FlowState = { v: 1, checkedAt: at(THURSDAY, "10:25") };
    assert.equal(checkDue(prev, at(THURSDAY, "10:35")), false);
    assert.equal(checkDue(prev, at(THURSDAY, "10:55")), true);
  });

  test("once-a-day inputs are due on a new day", () => {
    const prev: FlowState = {
      v: 1,
      profile: { day: THURSDAY, hours: [] },
      cartBase: { day: THURSDAY, days: [] },
    };
    assert.deepEqual(dailyDue(prev, THURSDAY), { profile: false, cartBase: false, metaBase: true });
    assert.deepEqual(dailyDue(prev, "2026-11-06"), { profile: true, cartBase: true, metaBase: true });
  });
});

describe("ad clicks flowing", () => {
  const readings: Reading[] = [
    [mod("12:25"), 100],
    [mod("12:55"), 130],
    [mod("13:25"), 150],
  ];

  test("compares with the newest reading at least 50 minutes old and the previous one", () => {
    assert.deepEqual(flowSince(readings, mod("13:55"), 175), { flow: 45, step: 25, minutes: 60 });
  });

  test("no old enough reading: unknown", () => {
    assert.equal(flowSince([[mod("13:25"), 150]], mod("13:55"), 175), null);
    assert.equal(flowSince([], mod("13:55"), 175), null);
  });
});

describe("realtime baseline", () => {
  test("one sample per day and hour, weekdays apart from weekends, newest kept", () => {
    let base = undefined as ReturnType<typeof recordRealtime> | undefined;
    for (let d = 1; d <= 7; d++) {
      const day = addDaysIso("2026-10-25", d); // Mon 26.10 ... Sun 1.11
      base = recordRealtime(base, clockAt(day, "14:25"), 10 + d);
      base = recordRealtime(base, clockAt(day, "14:55"), 20 + d); // the later check of the hour wins
    }
    assert.equal(base!["wd-14"].length, RT_BASE_WEEKDAY_DAYS);
    assert.deepEqual(base!["wd-14"].map(([, v]) => v), [21, 22, 23, 24, 25]);
    assert.deepEqual(base!["we-14"].map(([, v]) => v), [26, 27]);
  });

  test("learned median from earlier days, else the heatmap estimate", () => {
    const thu = clockAt(THURSDAY, "14:25");
    let base = recordRealtime(undefined, clockAt("2026-11-02", "14:25"), 10);
    base = recordRealtime(base, clockAt("2026-11-03", "14:25"), 14);
    const profile = Array.from({ length: 24 }, () => 0);
    profile[14] = 30;
    // Two samples are not enough yet: 30 sessions an hour x 0.4.
    assert.deepEqual(usualRealtime(base, thu, profile), { usual: 12, learned: false });
    base = recordRealtime(base, clockAt("2026-11-04", "14:25"), 12);
    // Today's own sample never counts as "usual".
    base = recordRealtime(base, thu, 0);
    assert.deepEqual(usualRealtime(base, thu, profile), { usual: 12, learned: true });
    assert.equal(usualRealtime(undefined, thu, null), null);
  });
});

describe("GA4 guard", () => {
  const clock = clockAt(THURSDAY, "14:25");
  const learned = { usual: 12, learned: true };
  const flowing = { flow: 40, step: 20, minutes: 60 };

  test("data flowing: ok", () => {
    assert.equal(judgeGa4({ clock, realtime: { users: 7, events: 80 }, usual: learned, flow: flowing }).kind, "ok");
  });

  test("nobody on the site while the ads send people: Pilne when the level is learned", () => {
    const v = bad(judgeGa4({ clock, realtime: { users: 0, events: 0 }, usual: learned, flow: flowing }));
    assert.equal(v.severity, "critical");
    assert.deepEqual(v.facts, { guard: "ga4", users: 0, events: 0, usual: 12, clicks: 40, minutes: 60 });
  });

  test("against the heatmap estimate it is only Ważne", () => {
    const v = bad(
      judgeGa4({ clock, realtime: { users: 0, events: 0 }, usual: { usual: 12, learned: false }, flow: flowing })
    );
    assert.equal(v.severity, "high");
  });

  test("~0 is 10% of the usual: 2 of 25 still counts, 3 does not", () => {
    const usual = { usual: 25, learned: true };
    assert.equal(judgeGa4({ clock, realtime: { users: 2, events: 9 }, usual, flow: flowing }).kind, "bad");
    assert.equal(judgeGa4({ clock, realtime: { users: 3, events: 9 }, usual, flow: flowing }).kind, "ok");
    // Below 10 usual visitors only a true zero counts.
    assert.equal(judgeGa4({ clock, realtime: { users: 1, events: 3 }, usual: { usual: 9, learned: true }, flow: flowing }).kind, "ok");
  });

  test("no ad clicks coming in: an empty site is not proof of a broken tag", () => {
    const quiet = judgeGa4({ clock, realtime: { users: 0, events: 0 }, usual: learned, flow: { flow: 4, step: 2, minutes: 60 } });
    assert.equal(quiet.kind, "unknown");
    // Clicks that stopped arriving since the previous check don't count either.
    const stalled = judgeGa4({ clock, realtime: { users: 0, events: 0 }, usual: learned, flow: { flow: 30, step: 0, minutes: 60 } });
    assert.equal(stalled.kind, "unknown");
    assert.equal(judgeGa4({ clock, realtime: { users: 0, events: 0 }, usual: learned, flow: null }).kind, "unknown");
  });

  test("quiet hours, the night and missing realtime are never judged", () => {
    assert.equal(judgeGa4({ clock, realtime: { users: 0, events: 0 }, usual: { usual: 4, learned: true }, flow: flowing }).kind, "unknown");
    assert.equal(
      judgeGa4({ clock: clockAt(THURSDAY, "23:25"), realtime: { users: 0, events: 0 }, usual: learned, flow: flowing }).kind,
      "unknown"
    );
    assert.equal(
      judgeGa4({ clock: clockAt(THURSDAY, "06:55"), realtime: { users: 0, events: 0 }, usual: learned, flow: flowing }).kind,
      "unknown"
    );
    assert.equal(judgeGa4({ clock, realtime: null, usual: learned, flow: flowing }).kind, "unknown");
  });
});

describe("incidents", () => {
  const facts = { guard: "ga4" as const, users: 0, events: 0, usual: 12, clicks: 40, minutes: 60 };
  const badHigh: Verdict = { kind: "bad", severity: "high", facts };
  const badCritical: Verdict = { kind: "bad", severity: "critical", facts };
  const ok: Verdict = { kind: "ok" };
  const unk: Verdict = { kind: "unknown", reason: "x" };

  test(`opens after ${CONFIRM_CHECKS} bad checks in a row, with a stable id`, () => {
    const t1 = advanceGuard("ga4", undefined, badHigh, at(THURSDAY, "14:25"));
    assert.equal(t1.open, undefined);
    assert.equal(t1.bad, 1);
    const t2 = advanceGuard("ga4", t1, badHigh, at(THURSDAY, "14:55"));
    assert.ok(t2.open);
    assert.equal(t2.open!.id, incidentId("ga4", at(THURSDAY, "14:25")));
    assert.equal(t2.open!.id, "flow-ga4-202611051325");
    const t3 = advanceGuard("ga4", t2, badCritical, at(THURSDAY, "15:25"));
    assert.equal(t3.open!.id, t2.open!.id);
    assert.equal(t3.open!.severity, "critical");
    // Severity never drops back within an incident.
    const t4 = advanceGuard("ga4", t3, badHigh, at(THURSDAY, "15:55"));
    assert.equal(t4.open!.severity, "critical");
    assert.equal(t4.open!.lastSeen, at(THURSDAY, "15:55"));
  });

  test("a check in between that could not judge breaks the row", () => {
    const t1 = advanceGuard("ga4", undefined, badHigh, at(THURSDAY, "14:25"));
    const t2 = advanceGuard("ga4", t1, unk, at(THURSDAY, "14:55"));
    const t3 = advanceGuard("ga4", t2, badHigh, at(THURSDAY, "15:25"));
    assert.equal(t3.open, undefined);
  });

  test("clears as soon as the data flows again", () => {
    let t = advanceGuard("ga4", undefined, badHigh, at(THURSDAY, "14:25"));
    t = advanceGuard("ga4", t, badHigh, at(THURSDAY, "14:55"));
    t = advanceGuard("ga4", t, ok, at(THURSDAY, "15:25"));
    assert.equal(t.open, undefined);
    assert.equal(t.closed!.id, "flow-ga4-202611051325");
  });

  test("an unknown check keeps it; nobody confirming it for 75 minutes ends it", () => {
    let t = advanceGuard("ga4", undefined, badHigh, at(THURSDAY, "14:25"));
    t = advanceGuard("ga4", t, badHigh, at(THURSDAY, "14:55"));
    t = advanceGuard("ga4", t, unk, at(THURSDAY, "15:25"));
    assert.ok(t.open);
    t = advanceGuard("ga4", t, unk, at(THURSDAY, "16:25"));
    assert.equal(t.open, undefined);
    assert.equal(t.closed!.at, at(THURSDAY, "14:55"));
  });

  test("back within 3 hours it is the same incident (one e-mail); later a new one", () => {
    let t = advanceGuard("ga4", undefined, badHigh, at(THURSDAY, "10:25"));
    t = advanceGuard("ga4", t, badHigh, at(THURSDAY, "10:55"));
    const first = t.open!.id;
    t = advanceGuard("ga4", t, ok, at(THURSDAY, "11:25"));
    t = advanceGuard("ga4", t, badHigh, at(THURSDAY, "12:25"));
    t = advanceGuard("ga4", t, badHigh, at(THURSDAY, "12:55"));
    assert.equal(t.open!.id, first);
    assert.equal(t.open!.startedAt, at(THURSDAY, "12:25"));
    t = advanceGuard("ga4", t, ok, at(THURSDAY, "13:25"));
    t = advanceGuard("ga4", t, badHigh, at(THURSDAY, "17:25"));
    t = advanceGuard("ga4", t, badHigh, at(THURSDAY, "17:55"));
    assert.notEqual(t.open!.id, first);
  });
});

// ---- a whole day through runFlowCheck ---------------------------------------------------

interface DayPlan {
  day: string;
  shop?: boolean;
  /** Realtime visitors at a check (null = the realtime call failed). */
  users: (hhmm: string) => number | null;
  /** Cumulative ad clicks today at a check. */
  clicks?: (hhmm: string) => number;
  until?: string;
  extra?: (hhmm: string) => Partial<FlowInput>;
}

/** Engagement-like ads: 20 clicks every half hour from 8:00. */
const steadyClicks = (hhmm: string) => Math.max(0, Math.floor((mod(hhmm) - 480) / 30)) * 20;
const busyHours = (hhmm: string) => (mod(hhmm) >= 9 * 60 && mod(hhmm) < 21 * 60 ? 12 : 3);

function runDay(state: FlowState | null, plan: DayPlan) {
  const verdicts: Array<{ time: string; v: Record<string, Verdict> }> = [];
  let s = state;
  for (const time of CHECK_TIMES) {
    if (plan.until && mod(time) > mod(plan.until)) break;
    const users = plan.users(time);
    const input: FlowInput = {
      now: at(plan.day, time),
      utcOffsetMin: OFFSET,
      shop: plan.shop ?? false,
      realtime: users === null ? null : { users, events: users * 9 },
      adClicksToday: (plan.clicks ?? steadyClicks)(time),
      ...(plan.extra?.(time) ?? {}),
    };
    const r = runFlowCheck(s, input);
    s = r.state;
    verdicts.push({ time, v: r.verdicts });
  }
  return { state: s as FlowState, verdicts };
}

/** Three ordinary weekdays before THURSDAY. */
function learnedWeek(shop = false): FlowState {
  let s: FlowState | null = null;
  for (const day of ["2026-11-02", "2026-11-03", "2026-11-04"]) s = runDay(s, { day, shop, users: busyHours }).state;
  return s as FlowState;
}

describe("GA4 guard over a day", () => {
  test("ordinary days teach the level and raise nothing", () => {
    let s: FlowState | null = null;
    for (const day of ["2026-11-02", "2026-11-03", "2026-11-04"]) {
      const r = runDay(s, { day, users: busyHours });
      for (const { v } of r.verdicts) for (const g of FLOW_GUARDS) assert.notEqual(v[g].kind, "bad");
      s = r.state;
    }
    assert.equal(s!.rtBase!["wd-14"].length, 3);
    assert.equal(openFlowAlerts(s, at("2026-11-04", "22:56"), OFFSET, false).length, 0);
  });

  test("the tag breaks at 14:00: Pilne at the second check, gone when the data flows again", () => {
    const week = learnedWeek();
    const broken = (t: string) => (mod(t) >= mod("14:25") && mod(t) <= mod("15:00") ? 0 : busyHours(t));
    const { state, verdicts } = runDay(week, { day: THURSDAY, users: broken, until: "14:55" });
    assert.equal(verdicts.find((x) => x.time === "14:25")!.v.ga4.kind, "bad");
    assert.equal(openFlowAlerts(runDay(week, { day: THURSDAY, users: broken, until: "14:25" }).state, at(THURSDAY, "14:30"), OFFSET, false).length, 0);

    const alerts = openFlowAlerts(state, at(THURSDAY, "15:00"), OFFSET, false);
    assert.equal(alerts.length, 1);
    const a = alerts[0];
    assert.equal(a.severity, "critical");
    assert.equal(a.id, "flow-ga4-202611051325");
    assert.equal(a.title, "Nie spływają dane z Analytics");
    assert.equal(a.sinceLabel, "od ok. 13:55");
    assert.equal(
      a.description,
      "Od ok. 13:55 Google Analytics nie widzi na stronie nikogo, a zwykle o tej porze w ciągu pół godziny jest tam ok. 12 osób. W ostatniej godzinie reklamy dały 40 kliknięć — ludzie wchodzą, ale Analytics ich nie liczy."
    );
    assert.match(a.action, /^Sprawdź, czy tag Google \(gtag\/GTM\) jest na stronie — ruch z reklam jest, a Analytics nic nie widzi\./);
    // An engagement client never reads a sales word.
    for (const text of [a.title, a.description, a.why, a.action]) assert.doesNotMatch(text, SALES_WORDS);
    // The zeros were not learned as the new usual.
    assert.deepEqual(state.rtBase!["wd-14"].map(([d]) => d), ["2026-11-02", "2026-11-03", "2026-11-04"]);

    const after = runFlowCheck(state, {
      now: at(THURSDAY, "15:25"),
      utcOffsetMin: OFFSET,
      shop: false,
      realtime: { users: 11, events: 90 },
      adClicksToday: steadyClicks("15:25"),
    });
    assert.equal(after.verdicts.ga4.kind, "ok");
    assert.equal(openFlowAlerts(after.state, at(THURSDAY, "15:30"), OFFSET, false).length, 0);
  });

  test("ads paused and nobody on the site: no alert", () => {
    const week = learnedWeek();
    const stopped = (t: string) => Math.min(steadyClicks(t), steadyClicks("13:00"));
    const { state } = runDay(week, { day: THURSDAY, users: (t) => (mod(t) >= mod("14:25") ? 0 : busyHours(t)), clicks: stopped, until: "16:55" });
    assert.equal(openFlowAlerts(state, at(THURSDAY, "17:00"), OFFSET, false).length, 0);
  });

  test("one empty half hour is not an incident", () => {
    const week = learnedWeek();
    const blip = (t: string) => (t === "14:25" ? 0 : busyHours(t));
    const { state } = runDay(week, { day: THURSDAY, users: blip, until: "15:25" });
    assert.equal(openFlowAlerts(state, at(THURSDAY, "14:56"), OFFSET, false).length, 0);
    assert.equal(state.guards?.ga4?.open, undefined);
  });

  test("a failed realtime call in between breaks the row", () => {
    const week = learnedWeek();
    const users = (t: string) => (t === "14:55" ? null : mod(t) >= mod("14:25") && mod(t) <= mod("15:25") ? 0 : busyHours(t));
    const { state } = runDay(week, { day: THURSDAY, users, until: "15:25" });
    assert.equal(state.guards?.ga4?.open, undefined);
  });

  test("checks skipped for hours: an old bad check is not 'in a row'", () => {
    const week = learnedWeek();
    const users = (t: string) => (mod(t) >= mod("14:25") ? 0 : busyHours(t));
    const first = runDay(week, { day: THURSDAY, users, until: "14:25" }).state;
    const r = runFlowCheck(first, {
      now: at(THURSDAY, "16:25"),
      utcOffsetMin: OFFSET,
      shop: false,
      realtime: { users: 0, events: 0 },
      adClicksToday: steadyClicks("16:25"),
    });
    // Still ~nobody with clicks flowing: bad again, but it starts a new row.
    assert.equal(r.verdicts.ga4.kind, "bad");
    assert.equal(r.state.guards?.ga4?.bad, 1);
    assert.equal(r.state.guards?.ga4?.open, undefined);
  });

  test("the snapshot keeps the last realtime reading; a state of another version starts over", () => {
    const week = learnedWeek();
    assert.deepEqual(week.realtime, { at: at("2026-11-04", "22:55"), users: 3, events: 27 });
    const input: FlowInput = {
      now: at(THURSDAY, "14:25"),
      utcOffsetMin: OFFSET,
      shop: false,
      realtime: { users: 0, events: 0 },
      adClicksToday: 240,
    };
    const fresh = runFlowCheck({ ...week, v: 2 } as unknown as FlowState, input);
    // The learned days are gone: no level to judge against, learning restarts.
    assert.equal(fresh.verdicts.ga4.kind, "unknown");
    assert.deepEqual(fresh.state.rtBase?.["wd-14"], [[THURSDAY, 0]]);
  });

  test("an evening incident is not shown after midnight (no second e-mail on a new day)", () => {
    const week = learnedWeek();
    const users = (t: string) => (mod(t) >= mod("21:55") ? 0 : busyHours(t));
    const { state } = runDay(week, { day: THURSDAY, users, clicks: steadyClicks });
    // 21-22 is a quiet hour for this site (3 visitors): nothing to judge.
    assert.equal(openFlowAlerts(state, at(THURSDAY, "22:56"), OFFSET, false).length, 0);

    const lateBusy = (t: string) => (mod(t) >= 9 * 60 ? 12 : 3);
    let s: FlowState | null = null;
    for (const day of ["2026-11-02", "2026-11-03", "2026-11-04"]) s = runDay(s, { day, users: lateBusy }).state;
    const late = runDay(s, { day: THURSDAY, users: (t) => (mod(t) >= mod("22:25") ? 0 : lateBusy(t)) }).state;
    assert.equal(openFlowAlerts(late, at(THURSDAY, "23:30"), OFFSET, false).length, 1);
    assert.equal(openFlowAlerts(late, at("2026-11-06", "00:00"), OFFSET, false).length, 0);
  });
});

// ---- checkout -------------------------------------------------------------------------------

/** A past weekday: 9-21 busy - 100 events, 10 carts, 4 checkouts, 2 purchases an hour. */
function pastDayRows(date: string, perHour: Partial<HourEcom> = {}): EcomHourRow[] {
  const rows: EcomHourRow[] = [];
  for (let hour = 0; hour < 24; hour++) {
    const busy = hour >= 9 && hour <= 21;
    rows.push({
      date,
      hour,
      events: busy ? 100 : 10,
      carts: busy ? (perHour.carts ?? 10) : 0,
      checkouts: busy ? (perHour.checkouts ?? 4) : 0,
      purchases: busy ? (perHour.purchases ?? 2) : 0,
    });
  }
  return rows;
}

const SAME_WEEKDAYS = [1, 2, 3, 4].map((w) => addDaysIso(THURSDAY, -7 * w));

function baseline(perHour: Partial<HourEcom> = {}): CartBaseline {
  return cartBaselineFrom(SAME_WEEKDAYS.flatMap((d) => pastDayRows(d, perHour)), THURSDAY);
}

/** Today until `lastHour` (GA4 has processed up to there); purchases stop at `stopAt`. */
function todayHours(lastHour: number, stopAt: number, cell: Partial<HourEcom> = {}): Array<HourEcom | null> {
  const rows: EcomHourRow[] = [];
  for (let hour = 0; hour <= lastHour; hour++) {
    const busy = hour >= 9;
    rows.push({
      date: THURSDAY,
      hour,
      events: busy ? 100 : 10,
      carts: busy ? (cell.carts ?? 10) : 0,
      checkouts: busy ? (cell.checkouts ?? 4) : 0,
      purchases: busy && hour < stopAt ? 2 : 0,
    });
  }
  return cartTodayFrom(rows, THURSDAY);
}

describe("checkout guard", () => {
  const clock = clockAt(THURSDAY, "15:25");

  test("the baseline keeps only the same weekday 1-4 weeks back", () => {
    const rows = [...SAME_WEEKDAYS.flatMap((d) => pastDayRows(d)), ...pastDayRows("2026-11-04")];
    const b = cartBaselineFrom(rows, THURSDAY);
    assert.equal(b.days.length, 4);
    assert.deepEqual(b.days[0][14], [100, 10, 4, 2]);
    assert.equal(cartBaselineFrom(pastDayRows(SAME_WEEKDAYS[0]), THURSDAY).days.length, 1);
  });

  test("carts and checkouts but no purchase since 11:00: payments, Pilne", () => {
    const v = bad(judgeCheckout({ clock, today: todayHours(14, 11), base: baseline(), orders: [], ordersNow: null }));
    assert.equal(v.severity, "critical");
    assert.deepEqual(v.facts, {
      guard: "checkout",
      hint: "payment",
      fromHour: 11,
      hours: 4,
      carts: 40,
      checkouts: 16,
      expected: 8,
      orders: null,
    });
  });

  test("GA4 lag: hours it has not processed yet are not read as 'no purchases'", () => {
    // 15:25, but GA4 has only processed up to 13:00-14:00: 11, 12, 13 judged.
    const v = bad(judgeCheckout({ clock, today: todayHours(13, 11), base: baseline(), orders: [], ordersNow: null }));
    assert.equal((v.facts as { hours: number }).hours, 3);
    // Processed only up to 12:00-13:00: two silent hours, not yet.
    const early = judgeCheckout({ clock, today: todayHours(12, 11), base: baseline(), orders: [], ordersNow: null });
    assert.equal(early.kind, "ok");
  });

  test("a purchase in the newest hour or within 3 hours: ok", () => {
    assert.equal(judgeCheckout({ clock, today: todayHours(14, 15), base: baseline(), orders: [], ordersNow: null }).kind, "ok");
    assert.equal(judgeCheckout({ clock, today: todayHours(14, 13), base: baseline(), orders: [], ordersNow: null }).kind, "ok");
  });

  test("3 silent hours expecting ~6 purchases: Ważne, not Pilne", () => {
    const v = bad(judgeCheckout({ clock, today: todayHours(14, 12), base: baseline(), orders: [], ordersNow: null }));
    assert.equal(v.severity, "high");
    assert.equal((v.facts as { expected: number }).expected, 6);
  });

  test("few shoppers or a shop that rarely sells at these hours: never judged", () => {
    assert.equal(
      judgeCheckout({ clock, today: todayHours(14, 11, { carts: 1, checkouts: 0 }), base: baseline(), orders: [], ordersNow: null }).kind,
      "unknown"
    );
    // Usually 1 purchase per 20 carts: 4 quiet hours expect ~2.
    assert.equal(
      judgeCheckout({ clock, today: todayHours(14, 11), base: baseline({ carts: 20, purchases: 0.5 }), orders: [], ordersNow: null }).kind,
      "unknown"
    );
  });

  test("more carts than usual (a promo) expect more purchases", () => {
    const v = bad(judgeCheckout({ clock, today: todayHours(14, 12, { carts: 20 }), base: baseline(), orders: [], ordersNow: null }));
    assert.equal((v.facts as { expected: number }).expected, 12);
    assert.equal(v.severity, "critical");
  });

  test("hint: no checkouts although they usually happen -> the cart; no checkout tracking -> both", () => {
    const cart = bad(judgeCheckout({ clock, today: todayHours(14, 11, { checkouts: 0 }), base: baseline(), orders: [], ordersNow: null }));
    assert.equal((cart.facts as { hint: string }).hint, "cart");
    const both = bad(
      judgeCheckout({ clock, today: todayHours(14, 11, { checkouts: 0 }), base: baseline({ checkouts: 0 }), orders: [], ordersNow: null })
    );
    assert.equal((both.facts as { hint: string }).hint, "both");
  });

  test("the shop's own orders keep coming: GA4's purchase tag, Ważne", () => {
    const orders: Reading[] = [
      [mod("10:25"), 9],
      [mod("10:55"), 10],
      [mod("12:25"), 13],
    ];
    const v = bad(judgeCheckout({ clock, today: todayHours(14, 11), base: baseline(), orders, ordersNow: 16 }));
    assert.equal((v.facts as { hint: string }).hint, "tracking");
    assert.equal((v.facts as { orders: number }).orders, 6);
    assert.equal(v.severity, "high");
  });

  test("no baseline (new shop), the night, no data: unknown", () => {
    const thin = cartBaselineFrom(SAME_WEEKDAYS.slice(0, 2).flatMap((d) => pastDayRows(d)), THURSDAY);
    assert.equal(judgeCheckout({ clock, today: todayHours(14, 11), base: thin, orders: [], ordersNow: null }).kind, "unknown");
    assert.equal(
      judgeCheckout({ clock: clockAt(THURSDAY, "23:25"), today: todayHours(22, 11), base: baseline(), orders: [], ordersNow: null }).kind,
      "unknown"
    );
    assert.equal(judgeCheckout({ clock, today: null, base: baseline(), orders: [], ordersNow: null }).kind, "unknown");
    assert.equal(
      judgeCheckout({ clock, today: Array.from({ length: 24 }, () => null), base: baseline(), orders: [], ordersNow: null }).kind,
      "unknown"
    );
  });

  test("wording for each hint", () => {
    const inc = (facts: Extract<Verdict, { kind: "bad" }>["facts"], severity: "critical" | "high" = "critical"): FlowIncident => ({
      id: "flow-checkout-x",
      guard: facts.guard,
      since: at(THURSDAY, "14:25"),
      startedAt: at(THURSDAY, "14:25"),
      lastSeen: at(THURSDAY, "14:55"),
      severity,
      facts,
    });
    const base = { guard: "checkout" as const, fromHour: 11, hours: 3, carts: 34, checkouts: 12, expected: 7.4, orders: null };
    const pay = buildFlowAlert(inc({ ...base, hint: "payment" }), true, OFFSET)!;
    assert.equal(pay.title, "Koszyk lub płatności mogą nie działać");
    // The verb agrees with the number: "były 34 dodania", "było 12 dodań".
    assert.equal(pay.description, "Od 11:00 nikt nie kupił, choć były 34 dodania do koszyka i 12 przejść do kasy. Przy takim ruchu zwykle byłoby już ok. 7 zakupów.");
    assert.equal(pay.action, "Sprawdź płatności — klienci przechodzą do kasy, ale nikt nie płaci od 3 godzin.");
    assert.equal(pay.sinceLabel, "od 11:00");

    const both = buildFlowAlert(inc({ ...base, hint: "both", checkouts: 0, carts: 3 }), true, OFFSET)!;
    assert.equal(both.description, "Od 11:00 nikt nie kupił, choć były 3 dodania do koszyka. Przy takim ruchu zwykle byłoby już ok. 7 zakupów.");
    assert.equal(both.action, "Sprawdź płatności i koszyk — ludzie dodają do koszyka, ale nikt nie kupuje od 3 godzin.");

    const many = buildFlowAlert(inc({ ...base, hint: "both", checkouts: 0, carts: 12 }), true, OFFSET)!;
    assert.equal(many.description, "Od 11:00 nikt nie kupił, choć było 12 dodań do koszyka. Przy takim ruchu zwykle byłoby już ok. 7 zakupów.");

    const cart = buildFlowAlert(inc({ ...base, hint: "cart", checkouts: 0, fromHour: 0, hours: 15 }), true, OFFSET)!;
    assert.equal(cart.description, "Dziś jeszcze nikt nie kupił, choć były 34 dodania do koszyka. Przy takim ruchu zwykle byłoby już ok. 7 zakupów.");
    assert.equal(cart.action, "Sprawdź koszyk — ludzie dodają produkty do koszyka, ale nikt nie przechodzi do kasy od rana.");
    assert.equal(cart.sinceLabel, "dziś");

    const tracking = buildFlowAlert(inc({ ...base, hint: "tracking", orders: 1, expected: 1.2 }, "high"), true, OFFSET)!;
    assert.equal(tracking.title, "Analytics nie widzi zakupów");
    assert.equal(
      tracking.description,
      "Od 11:00 Analytics nie widzi żadnego zakupu, choć sklep przyjął w tym czasie 1 zamówienie. Przy takim ruchu Analytics liczy zwykle ok. 1 zakup."
    );
    assert.equal(tracking.action, "Sprawdź zdarzenie zakupu (purchase) w tagu Google — sklep sprzedaje, a Analytics nie widzi zakupów od 3 godzin.");
    // Never for an engagement client.
    assert.equal(buildFlowAlert(inc({ ...base, hint: "payment" }), false, OFFSET), null);
  });
});

describe("checkout guard over a day", () => {
  test("two checks in a row open it; one purchase closes it", () => {
    const base = baseline();
    let s: FlowState | null = learnedWeek(true);
    const check = (time: string, lastHour: number, stopAt: number, extra: Partial<FlowInput> = {}) => {
      const r = runFlowCheck(s, {
        now: at(THURSDAY, time),
        utcOffsetMin: OFFSET,
        shop: true,
        realtime: { users: 12, events: 100 },
        adClicksToday: steadyClicks(time),
        cartToday: todayHours(lastHour, stopAt),
        cartBase: time === "14:25" ? base : undefined, // loaded once a day, then cached
        ...extra,
      });
      s = r.state;
      return r;
    };
    assert.equal(check("14:25", 13, 11).verdicts.checkout.kind, "bad");
    assert.equal(openFlowAlerts(s, at(THURSDAY, "14:30"), OFFSET, true).length, 0);
    assert.equal(check("14:55", 13, 11).verdicts.checkout.kind, "bad");
    const open = openFlowAlerts(s, at(THURSDAY, "15:00"), OFFSET, true);
    assert.equal(open.length, 1);
    assert.equal(open[0].guard, "checkout");
    assert.equal(open[0].severity, "high"); // 3 hours, ~6 expected
    assert.equal(check("15:25", 14, 11).verdicts.checkout.kind, "bad");
    assert.equal(openFlowAlerts(s, at(THURSDAY, "15:30"), OFFSET, true)[0].severity, "critical");
    // A purchase at 15:00-16:00 (processed by 16:25): over.
    const cells = todayHours(15, 11);
    cells[15] = { events: 100, carts: 10, checkouts: 4, purchases: 1 };
    assert.equal(check("16:25", 15, 11, { cartToday: cells }).verdicts.checkout.kind, "ok");
    assert.equal(openFlowAlerts(s, at(THURSDAY, "16:30"), OFFSET, true).length, 0);
  });

  test("an engagement client never runs the shop guards", () => {
    const r = runFlowCheck(null, {
      now: at(THURSDAY, "15:25"),
      utcOffsetMin: OFFSET,
      shop: false,
      realtime: { users: 12, events: 100 },
      adClicksToday: 100,
      cartToday: todayHours(14, 11),
      cartBase: baseline(),
      lastPushAt: at(THURSDAY, "08:05"),
    });
    assert.equal(r.verdicts.checkout.kind, "unknown");
    assert.equal(r.verdicts["meta-pixel"].kind, "unknown");
    assert.equal(r.verdicts["shop-feed"].kind, "unknown");
  });
});

// ---- Meta pixel ----------------------------------------------------------------------------

describe("Meta pixel guard", () => {
  const clock = clockAt(THURSDAY, "15:25");
  const now = at(THURSDAY, "15:25");
  const base: MetaBaseline = metaBaselineFrom(
    SAME_WEEKDAYS.flatMap((date) => [
      { date, clicks: 1_200, purchases: 25 },
      { date, clicks: 800, purchases: 15 },
    ]),
    THURSDAY
  );
  const meta = (clicksToday: number, purchasesToday: number | null, syncedAt = at(THURSDAY, "15:05")) => ({
    clicksToday,
    purchasesToday,
    syncedAt,
  });
  const judge = (over: Partial<Parameters<typeof judgeMetaPixel>[0]> = {}) =>
    judgeMetaPixel({
      clock,
      now,
      meta: meta(1_300, 0),
      base,
      profile: null,
      ga4PurchasesToday: 15,
      shopOrdersToday: null,
      ...over,
    });

  test("the baseline sums each day's rows; a row without purchases makes the day unknown", () => {
    assert.deepEqual(base.days[0], { clicks: 2_000, purchases: 40 });
    const partial = metaBaselineFrom(
      [
        { date: SAME_WEEKDAYS[0], clicks: 100, purchases: 2 },
        { date: SAME_WEEKDAYS[0], clicks: 100, purchases: null },
      ],
      THURSDAY
    );
    assert.deepEqual(partial.days[0], { clicks: 200, purchases: null });
  });

  test("clicks as usual, the shop sells, Meta sees no purchase: Pilne", () => {
    // 1300 clicks x 2% x half reported the same day = 13 expected.
    const v = bad(judge());
    assert.equal(v.severity, "critical");
    assert.deepEqual(v.facts, {
      guard: "meta-pixel",
      clicks: 1_300,
      usualClicks: 1_285,
      purchases: 0,
      expected: 13,
      shopPurchases: 15,
      source: "ga4",
    });
  });

  test("far below (2 of 13) is Ważne; a fair share is ok", () => {
    assert.equal(bad(judge({ meta: meta(1_300, 1) })).severity, "high");
    assert.equal(judge({ meta: meta(1_300, 2) }).kind, "ok");
  });

  test("the shop's own orders are evidence too", () => {
    const v = bad(judge({ ga4PurchasesToday: 0, shopOrdersToday: 21 }));
    assert.equal((v.facts as { source: string }).source, "shop");
    assert.equal((v.facts as { shopPurchases: number }).shopPurchases, 21);
  });

  test("not judged: before noon, stale Meta data, fewer clicks than usual, a shop that is not selling", () => {
    assert.equal(judge({ clock: clockAt(THURSDAY, "11:25") }).kind, "unknown");
    assert.equal(judge({ meta: meta(1_300, 0, at(THURSDAY, "13:05")) }).kind, "unknown");
    assert.equal(judge({ meta: meta(600, 0) }).kind, "unknown");
    assert.equal(judge({ meta: meta(1_300, null) }).kind, "unknown");
    assert.equal(judge({ ga4PurchasesToday: 2 }).kind, "unknown");
    assert.equal(judge({ base: { day: THURSDAY, days: base.days.slice(0, 2) } }).kind, "unknown");
  });

  test("a daily profile moves 'usual by now' (a shop that sells in the evening)", () => {
    const evening = Array.from({ length: 24 }, (_, h) => (h >= 18 ? 100 : 10));
    const share = dayShare(evening, clock);
    // 15 quiet hours and a quarter of the 15th out of a day that peaks at 18-24.
    assert.ok(share > 0.19 && share < 0.21, String(share));
    assert.equal(dayShare(null, clock), 925 / 1440);
    assert.deepEqual(profileFrom([{ hour: 14, sessions: 120 }, { hour: 99, sessions: 5 }]).slice(13, 16), [0, 30, 0]);
  });

  test("wording", () => {
    const v = bad(judge());
    const a = buildFlowAlert(
      {
        id: "flow-meta-pixel-x",
        guard: "meta-pixel",
        since: now,
        startedAt: now,
        lastSeen: now,
        severity: v.severity,
        facts: v.facts,
      },
      true,
      OFFSET
    )!;
    assert.equal(a.title, "Piksel Meta nie liczy zakupów");
    assert.equal(
      a.description,
      "Meta nie pokazuje dziś ani jednego zakupu z reklam, choć reklamy dały 1 300 kliknięć — tyle co zwykle o tej porze. Przy takim ruchu Meta liczy zwykle już ok. 13 zakupów, a Analytics widzi dziś 15 zakupów."
    );
    assert.equal(a.action, "Sprawdź piksel Meta / Conversions API — sklep sprzedaje, a Meta nie widzi zakupów.");
    assert.equal(a.scopeLabel, "Pomiar sprzedaży · Meta");
  });
});

// ---- shop feed -----------------------------------------------------------------------------

/** Pushes at :05 every hour 7-22 on the given days (what the checks observe). */
function hourlyPushes(days: string[], from = 7, to = 22): string[] {
  const out: string[] = [];
  for (const day of days) for (let h = from; h <= to; h++) out.push(at(day, `${String(h).padStart(2, "0")}:05`));
  return out;
}

describe("shop feed guard", () => {
  const prevDays = ["2026-11-02", "2026-11-03", "2026-11-04"];
  const today = (until: number) => hourlyPushes([THURSDAY], 7, until);

  test("an hourly feed silent for 3+ hours at a time it always pushes: Ważne, Pilne after 6 hours", () => {
    const pushes = [...hourlyPushes(prevDays), ...today(9)];
    const last = pushes[pushes.length - 1];
    const fresh = judgeFeed({ clock: clockAt(THURSDAY, "11:55"), now: at(THURSDAY, "11:55"), utcOffsetMin: OFFSET, lastPushAt: last, pushes });
    assert.equal(fresh.kind, "ok");
    const v = bad(judgeFeed({ clock: clockAt(THURSDAY, "12:25"), now: at(THURSDAY, "12:25"), utcOffsetMin: OFFSET, lastPushAt: last, pushes }));
    assert.equal(v.severity, "high");
    assert.deepEqual(v.facts, { guard: "shop-feed", lastPushAt: last, ageMin: 200, usualGapMin: 60 });
    assert.equal(
      bad(judgeFeed({ clock: clockAt(THURSDAY, "15:25"), now: at(THURSDAY, "15:25"), utcOffsetMin: OFFSET, lastPushAt: last, pushes }))
        .severity,
      "critical"
    );
  });

  test("a feed dead since yesterday morning is still flagged today, not from the third day", () => {
    const pushes = [...hourlyPushes(prevDays), ...today(9)];
    const last = pushes[pushes.length - 1];
    const judgeOn = (day: string) =>
      judgeFeed({ clock: clockAt(day, "12:25"), now: at(day, "12:25"), utcOffsetMin: OFFSET, lastPushAt: last, pushes });
    assert.equal(judgeOn("2026-11-06").kind, "bad");
    assert.equal(judgeOn("2026-11-07").kind, "unknown");
  });

  test("a shop that pushes only in working hours is not stale at 7:25", () => {
    const pushes = hourlyPushes(prevDays, 9, 20);
    const v = judgeFeed({
      clock: clockAt(THURSDAY, "07:25"),
      now: at(THURSDAY, "07:25"),
      utcOffsetMin: OFFSET,
      lastPushAt: pushes[pushes.length - 1],
      pushes,
    });
    assert.equal(v.kind, "unknown");
  });

  test("too little history, a feed that is not hourly, one switched off a week ago: unknown", () => {
    const few = today(9);
    assert.equal(
      judgeFeed({ clock: clockAt(THURSDAY, "14:25"), now: at(THURSDAY, "14:25"), utcOffsetMin: OFFSET, lastPushAt: few[2], pushes: few.slice(0, 3) }).kind,
      "unknown"
    );
    const daily = ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"].map((d) => at(d, "10:00"));
    assert.equal(
      judgeFeed({ clock: clockAt(THURSDAY, "14:25"), now: at(THURSDAY, "14:25"), utcOffsetMin: OFFSET, lastPushAt: daily[5], pushes: daily }).kind,
      "unknown"
    );
    const old = hourlyPushes(["2026-10-26", "2026-10-27", "2026-10-28"]);
    assert.equal(
      judgeFeed({ clock: clockAt(THURSDAY, "14:25"), now: at(THURSDAY, "14:25"), utcOffsetMin: OFFSET, lastPushAt: old[old.length - 1], pushes: old }).kind,
      "unknown"
    );
    assert.equal(
      judgeFeed({ clock: clockAt(THURSDAY, "14:25"), now: at(THURSDAY, "14:25"), utcOffsetMin: OFFSET, lastPushAt: null, pushes: [] }).kind,
      "unknown"
    );
  });

  test("pushes are remembered once each and pruned after 4 days", () => {
    let list = rememberPush(undefined, at(THURSDAY, "09:05"), at(THURSDAY, "09:25"));
    list = rememberPush(list, at(THURSDAY, "09:05"), at(THURSDAY, "09:55"));
    list = rememberPush(list, at(THURSDAY, "10:05"), at(THURSDAY, "10:25"));
    assert.equal(list.length, 2);
    list = rememberPush(list, at("2026-11-09", "10:05"), at("2026-11-09", "10:25"));
    assert.deepEqual(list, [at("2026-11-09", "10:05")]);
  });

  test("wording: today and yesterday", () => {
    const inc = (lastPushAt: string, ageMin: number, lastSeen: string): FlowIncident => ({
      id: "flow-shop-feed-x",
      guard: "shop-feed",
      since: lastSeen,
      startedAt: lastSeen,
      lastSeen,
      severity: "high",
      facts: { guard: "shop-feed", lastPushAt, ageMin, usualGapMin: 60 },
    });
    const a = buildFlowAlert(inc(at(THURSDAY, "09:05"), 200, at(THURSDAY, "12:25")), true, OFFSET)!;
    assert.equal(a.title, "Zamówienia ze sklepu przestały spływać");
    assert.equal(
      a.description,
      "Sklep ostatni raz przesłał sprzedaż o 9:05 (ponad 3 godz. temu), a zwykle robi to co godzinę. Panel nie widzi nowych zamówień."
    );
    assert.equal(a.sinceLabel, "od 9:05");
    const y = buildFlowAlert(inc(at("2026-11-04", "21:12"), 613, at(THURSDAY, "07:25")), true, OFFSET)!;
    assert.match(y.description, /^Sklep ostatni raz przesłał sprzedaż wczoraj o 21:12 \(ponad 10 godz\. temu\)/);
    assert.equal(y.sinceLabel, "od wczoraj");
  });
});

// ---- shown alerts ----------------------------------------------------------------------------

describe("open alerts", () => {
  const inc = (guard: FlowIncident["guard"], lastSeen: string): FlowIncident => ({
    id: `flow-${guard}-x`,
    guard,
    since: lastSeen,
    startedAt: lastSeen,
    lastSeen,
    severity: "high",
    facts:
      guard === "ga4"
        ? { guard: "ga4", users: 0, events: 0, usual: 9, clicks: 30, minutes: 60 }
        : { guard: "meta-pixel", clicks: 900, usualClicks: 850, purchases: 0, expected: 7, shopPurchases: 11, source: "shop" },
  });
  const state: FlowState = {
    v: 1,
    guards: {
      ga4: { bad: 2, open: inc("ga4", at(THURSDAY, "14:55")) },
      "meta-pixel": { bad: 2, open: inc("meta-pixel", at(THURSDAY, "14:55")) },
    },
  };

  test(`shown while confirmed within ${OPEN_TTL_MIN} minutes`, () => {
    assert.equal(openFlowAlerts(state, at(THURSDAY, "15:00"), OFFSET, true).length, 2);
    assert.equal(openFlowAlerts(state, at(THURSDAY, "16:15"), OFFSET, true).length, 0);
    assert.equal(openFlowAlerts(null, at(THURSDAY, "15:00"), OFFSET, true).length, 0);
  });

  test("an engagement client only ever sees the Analytics one, without sales words", () => {
    const alerts = openFlowAlerts(state, at(THURSDAY, "15:00"), OFFSET, false);
    assert.deepEqual(alerts.map((a) => a.guard), ["ga4"]);
    for (const text of [alerts[0].title, alerts[0].description, alerts[0].why, alerts[0].action]) {
      assert.doesNotMatch(text, SALES_WORDS);
    }
  });

  test("the shop's Analytics card speaks of orders", () => {
    const [ga4] = openFlowAlerts(state, at(THURSDAY, "15:00"), OFFSET, true);
    assert.match(ga4.why, /zamówienia/);
    assert.equal(
      ga4.description,
      "Od ok. 14:25 Google Analytics nie widzi na stronie nikogo, a zwykle o tej porze w ciągu pół godziny jest tam ok. 9 osób. W ostatniej godzinie reklamy dały 30 kliknięć — ludzie wchodzą, ale Analytics ich nie liczy."
    );
  });
});

describe("Polish plurals", () => {
  test("1, 2-4, 5+, 12-14, 22", () => {
    const f = (v: number) => plPlural(v, "zakup", "zakupy", "zakupów");
    assert.deepEqual([1, 2, 4, 5, 12, 14, 22, 25, 0].map(f), [
      "zakup",
      "zakupy",
      "zakupy",
      "zakupów",
      "zakupów",
      "zakupów",
      "zakupy",
      "zakupów",
      "zakupów",
    ]);
  });
});
