import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  agoText,
  classifyCheck,
  durationText,
  failureShort,
  failureText,
  formatUptime,
  initialSiteMachine,
  isSiteDownNow,
  planSiteNotice,
  siteDownAlertCopy,
  siteGuardLine,
  siteHost,
  siteNoticeKey,
  siteNoticeMessage,
  stepSiteState,
  uptimePercent,
  whatToCheck,
  DOWN_AFTER_FAILS,
  FLAP_GUARD_MIN,
  SITE_DOWN_KEY_PREFIX,
  UP_AFTER_OKS,
  type SiteMachine,
  type SiteSnapshot,
  type SiteState,
} from "./site-guard.ts";

const MIN = 60_000;
const T0 = Date.parse("2026-11-07T10:00:00Z");
const at = (n: number) => T0 + n * 5 * MIN; // n-th 5-minute tick

/** Feed checks oldest first; collect the transitions with their tick. */
function run(results: Array<boolean | null>, start: SiteMachine = initialSiteMachine(T0)) {
  let m = start;
  const transitions: Array<{ tick: number; to: SiteState }> = [];
  results.forEach((ok, tick) => {
    const step = stepSiteState(m, { at: at(tick), ok });
    m = step.machine;
    if (step.transition) transitions.push({ tick, to: step.transition });
  });
  return { m, transitions };
}

describe("stepSiteState", () => {
  test("DOWN only on the 3rd failure in a row, dated from the first", () => {
    assert.equal(DOWN_AFTER_FAILS, 3);
    const { m, transitions } = run([true, false, false, false]);
    assert.deepEqual(transitions, [{ tick: 3, to: "down" }]);
    assert.equal(m.state, "down");
    assert.equal(m.downSince, at(1));
    assert.equal(m.since, at(1));
  });

  test("two failures and a good check reset the count", () => {
    const { m, transitions } = run([false, false, true, false, false]);
    assert.deepEqual(transitions, []);
    assert.equal(m.state, "up");
    assert.equal(m.failStreak, 2);
  });

  test("no verdict (blocked / lost / our network) neither breaks nor extends a streak", () => {
    const { m, transitions } = run([false, null, false, null, null, false]);
    assert.deepEqual(transitions, [{ tick: 5, to: "down" }]);
    assert.equal(m.downSince, at(0));
    // And a site that only ever answers 403 never goes down.
    assert.deepEqual(run([null, null, null, null, null]).transitions, []);
  });

  test("UP after 2 good checks in a row; the outage ends at the first good one", () => {
    assert.equal(UP_AFTER_OKS, 2);
    const { m, transitions } = run([false, false, false, true, false, true, true]);
    assert.deepEqual(transitions, [
      { tick: 2, to: "down" },
      { tick: 6, to: "up" },
    ]);
    assert.equal(m.state, "up");
    assert.equal(m.since, at(5));
    assert.equal(m.downSince, at(0)); // kept: the last outage was at(0) -> at(5)
    assert.equal(m.since - (m.downSince ?? 0), 25 * MIN);
  });

  test("a flapping site goes down / up at most once per 5 checks", () => {
    const flap = Array.from({ length: 50 }, (_, i) => i % 2 === 0);
    assert.deepEqual(run(flap).transitions, []);
    const cycles = run([false, false, false, true, true, false, false, false, true, true]);
    assert.deepEqual(
      cycles.transitions.map((t) => t.to),
      ["down", "up", "down", "up"]
    );
  });

  test("further failures while down change nothing but the count", () => {
    const { m, transitions } = run([false, false, false, false, false, false]);
    assert.equal(transitions.length, 1);
    assert.equal(m.failStreak, 6);
    assert.equal(m.downSince, at(0));
  });
});

describe("classifyCheck", () => {
  test("HTTP statuses", () => {
    assert.equal(classifyCheck(200, null), "ok");
    assert.equal(classifyCheck(301, null), "ok");
    assert.equal(classifyCheck(304, null), "ok");
    assert.equal(classifyCheck(403, null), "blocked");
    assert.equal(classifyCheck(401, null), "blocked");
    assert.equal(classifyCheck(429, null), "blocked");
    assert.equal(classifyCheck(503, "HTTP 503"), "http_5xx");
    assert.equal(classifyCheck(522, null), "http_5xx");
    assert.equal(classifyCheck(404, null), "http_missing");
    assert.equal(classifyCheck(410, null), "http_missing");
    assert.equal(classifyCheck(400, null), "http_other");
  });

  test("pg_net / libcurl errors", () => {
    assert.equal(classifyCheck(null, "Timeout of 10000 ms reached. Total time: 10001 ms"), "timeout");
    assert.equal(classifyCheck(null, "Timeout was reached"), "timeout");
    assert.equal(classifyCheck(null, "Connection timed out after 10001 milliseconds"), "timeout");
    assert.equal(classifyCheck(null, "Couldn't resolve host name"), "dns");
    assert.equal(classifyCheck(null, "Could not resolve host: sklep.pl"), "dns");
    assert.equal(classifyCheck(null, "SSL certificate problem: certificate has expired"), "tls");
    assert.equal(classifyCheck(null, "SSL connect error"), "tls");
    assert.equal(classifyCheck(null, "SSL peer certificate or SSH remote key was not OK"), "tls");
    assert.equal(classifyCheck(null, "Couldn't connect to server"), "connect");
    assert.equal(classifyCheck(null, "Failed to connect to x port 443: Connection refused"), "connect");
    assert.equal(classifyCheck(null, "no response (pg_net)"), "lost");
    assert.equal(classifyCheck(null, "Server returned nothing (no headers, no data)"), "unknown");
    assert.equal(classifyCheck(null, null), "unknown");
  });
});

describe("Polish wording", () => {
  test("what we saw", () => {
    assert.equal(
      failureText("http_5xx", 503),
      "serwer odpowiada błędem HTTP 503 (usługa niedostępna - przeciążenie albo prace serwisowe)"
    );
    assert.match(failureText("http_5xx", 522), /Cloudflare/);
    assert.equal(failureText("http_5xx", 599), "serwer odpowiada błędem HTTP 599");
    assert.equal(failureText("timeout", null), "strona nie odpowiedziała w ciągu 10 s");
    assert.match(failureText("tls", null), /certyfikat SSL/);
    assert.equal(failureShort("http_5xx", 503), "HTTP 503");
    assert.equal(failureShort("dns", null), "błąd DNS");
  });

  test("hints follow the cause", () => {
    assert.match(whatToCheck("tls", null)[0], /^Certyfikat SSL/);
    assert.match(whatToCheck("dns", null)[0], /^Domena/);
    assert.match(whatToCheck("http_5xx", 500)[0], /^Hosting/);
    assert.match(whatToCheck("http_5xx", 521)[0], /Cloudflare/);
    assert.match(whatToCheck("http_missing", 404)[0], /^Strona główna/);
    for (const kind of ["timeout", "connect", "unknown", "http_other"] as const) {
      assert.ok(whatToCheck(kind, null).length >= 2, kind);
    }
  });

  test("durations", () => {
    assert.equal(durationText(0), "1 min");
    assert.equal(durationText(15 * MIN), "15 min");
    assert.equal(durationText(42 * MIN), "42 min");
    assert.equal(durationText(60 * MIN), "1 godz.");
    assert.equal(durationText(65 * MIN), "1 godz. 5 min");
    assert.equal(durationText(24 * 60 * MIN), "1 dzień");
    assert.equal(durationText(51 * 60 * MIN), "2 dni 3 godz.");
    assert.equal(agoText(20_000), "przed chwilą");
    assert.equal(agoText(3 * MIN), "3 min temu");
  });

  test("uptime: needs enough checks, rounds down, Polish comma", () => {
    assert.equal(uptimePercent(10, 10), null);
    assert.equal(uptimePercent(100, 100), 100);
    assert.equal(formatUptime(100), "100%");
    assert.equal(formatUptime(uptimePercent(8639, 8640) ?? -1), "99,9%"); // 99.988...
    assert.equal(formatUptime(uptimePercent(997, 1000) ?? -1), "99,7%"); // float noise
    assert.equal(formatUptime(uptimePercent(950, 1000) ?? -1), "95,0%");
    assert.equal(formatUptime(uptimePercent(5, 30) ?? -1), "16,6%");
  });

  test("host for the card", () => {
    assert.equal(siteHost("https://www.dre.pl/"), "dre.pl");
    assert.equal(siteHost("https://sklep.example.pl/pl?x=1"), "sklep.example.pl");
    assert.equal(siteHost("not a url"), "not a url");
  });
});

function snapshot(over: Partial<SiteSnapshot> = {}): SiteSnapshot {
  return {
    url: "https://sklep.pl/",
    state: "up",
    since: T0 - 3 * 24 * 60 * MIN,
    downSince: null,
    failStreak: 0,
    okStreak: 40,
    lastCheckedAt: T0 - 3 * MIN,
    lastOk: true,
    lastHttpStatus: 200,
    lastError: null,
    lastFailStatus: null,
    lastFailError: null,
    ...over,
  };
}

describe("siteGuardLine", () => {
  const base = { available: true, websiteUrl: "https://sklep.pl/", uptimePct: 99.95, now: T0 };

  test("up, with uptime", () => {
    assert.deepEqual(siteGuardLine({ ...base, status: snapshot() }), {
      tone: "ok",
      text: "Strona działa · sprawdzono 3 min temu · uptime 30 dni 99,9%",
    });
    assert.equal(
      siteGuardLine({ ...base, uptimePct: null, status: snapshot() })?.text,
      "Strona działa · sprawdzono 3 min temu"
    );
  });

  test("down", () => {
    const line = siteGuardLine({
      ...base,
      status: snapshot({
        state: "down",
        downSince: T0 - 25 * MIN,
        failStreak: 5,
        okStreak: 0,
        lastOk: false,
        lastFailStatus: 503,
        lastFailError: "HTTP 503",
      }),
    });
    assert.deepEqual(line, { tone: "down", text: "Strona nie działa od 25 min (HTTP 503) · sprawdzono 3 min temu" });
  });

  test("one failed check before DOWN is a warning, not an outage", () => {
    const line = siteGuardLine({
      ...base,
      status: snapshot({ failStreak: 1, okStreak: 0, lastOk: false, lastFailError: "Timeout was reached" }),
    });
    assert.equal(line?.tone, "warn");
    assert.match(line?.text ?? "", /^Strona nie odpowiedziała przy ostatnim sprawdzeniu \(brak odpowiedzi w 10 s\)/);
  });

  test("a firewall blocking the robot", () => {
    const line = siteGuardLine({
      ...base,
      uptimePct: null,
      status: snapshot({ lastOk: null, lastHttpStatus: 403, lastError: "HTTP 403" }),
    });
    assert.equal(line?.tone, "warn");
    assert.match(line?.text ?? "", /HTTP 403/);
  });

  test("stuck guard, not migrated, new address, no website", () => {
    assert.equal(
      siteGuardLine({ ...base, status: snapshot({ lastCheckedAt: T0 - 2 * 60 * MIN }) })?.text,
      "Strażnik nie sprawdzał strony od 2 godz. - sprawdź zadanie site-guard w Supabase (cron.job)."
    );
    assert.match(siteGuardLine({ ...base, available: false, status: null })?.text ?? "", /0045_site_guard\.sql/);
    assert.equal(
      siteGuardLine({ ...base, status: snapshot({ url: "https://stary.pl/" }) })?.text,
      "Pierwsze sprawdzenie strony w ciągu 5 min."
    );
    assert.equal(
      siteGuardLine({ ...base, status: snapshot({ lastCheckedAt: null, since: T0 - 2 * MIN }) })?.tone,
      "muted"
    );
    assert.equal(
      siteGuardLine({ ...base, status: snapshot({ lastCheckedAt: null, since: T0 - 60 * MIN }) })?.tone,
      "warn"
    );
    assert.equal(siteGuardLine({ ...base, websiteUrl: null, status: snapshot() }), null);
  });
});

describe("Alerty card", () => {
  test("only while down and still being checked", () => {
    const down = snapshot({ state: "down", downSince: T0 - 20 * MIN, lastCheckedAt: T0 - 4 * MIN });
    assert.equal(isSiteDownNow(down, T0), true);
    assert.equal(isSiteDownNow({ ...down, lastCheckedAt: T0 - 3 * 60 * MIN }, T0), false);
    assert.equal(isSiteDownNow(snapshot(), T0), false);
  });

  test("copy", () => {
    const copy = siteDownAlertCopy({
      isShop: true,
      downSince: T0 - 15 * MIN,
      now: T0,
      failStatus: null,
      failError: "SSL certificate problem: certificate has expired",
      startedLabel: "10:45",
    });
    assert.equal(copy.title, "Strona sklepu nie odpowiada od 15 min");
    assert.equal(
      copy.description,
      "Błąd połączenia szyfrowanego - certyfikat SSL jest nieważny albo wygasł. Nie działa od 10:45, sprawdzamy co 5 minut."
    );
    assert.match(copy.why, /sklep nie sprzedaje/);
    assert.match(copy.action, /^Co sprawdzić: Certyfikat SSL/);
    const lead = siteDownAlertCopy({
      isShop: false,
      downSince: T0 - 15 * MIN,
      now: T0,
      failStatus: 502,
      failError: "HTTP 502",
      startedLabel: "10:45",
    });
    assert.equal(lead.title, "Strona nie odpowiada od 15 min");
    assert.match(lead.why, /zapytania/);
  });
});

describe("notifications", () => {
  const down = {
    event: "down" as const,
    state: "down" as const,
    okStreak: 0,
    downAnnounced: false,
    upAnnounced: false,
    lastDownAnnouncedAt: null,
    now: T0,
  };

  test("one DOWN per outage", () => {
    assert.deepEqual(planSiteNotice(down), { action: "send" });
    assert.equal(planSiteNotice({ ...down, downAnnounced: true }).action, "drop");
    assert.equal(planSiteNotice({ ...down, state: "up" }).action, "drop");
  });

  test("DOWN waits while the newest check was good, and behind the flap guard", () => {
    assert.equal(planSiteNotice({ ...down, okStreak: 1 }).action, "defer");
    assert.equal(planSiteNotice({ ...down, lastDownAnnouncedAt: T0 - 30 * MIN }).action, "defer");
    assert.equal(
      planSiteNotice({ ...down, lastDownAnnouncedAt: T0 - (FLAP_GUARD_MIN + 1) * MIN }).action,
      "send"
    );
  });

  test("UP only after an announced DOWN, once", () => {
    const up = { ...down, event: "up" as const, state: "up" as const, okStreak: 2 };
    assert.equal(planSiteNotice(up).action, "drop");
    assert.deepEqual(planSiteNotice({ ...up, downAnnounced: true }), { action: "send" });
    assert.equal(planSiteNotice({ ...up, downAnnounced: true, upAnnounced: true }).action, "drop");
    assert.equal(planSiteNotice({ ...up, downAnnounced: true, state: "down" }).action, "drop");
  });

  test("keys name the outage by its first failed check", () => {
    assert.equal(siteNoticeKey("down", "2026-11-07T10:05:00.123456+00:00"), "site-down-2026-11-07T10:05");
    assert.equal(siteNoticeKey("up", "2026-11-07T11:05:00+01:00"), "site-up-2026-11-07T10:05");
    assert.ok(siteNoticeKey("down", "2026-11-07T10:05:00Z").startsWith(SITE_DOWN_KEY_PREFIX));
  });

  test("DOWN message", () => {
    const msg = siteNoticeMessage({
      event: "down",
      clientName: "Sklep <Test>",
      isShop: true,
      url: "https://sklep.pl/?a=1&b=2",
      now: T0,
      downSince: T0 - 15 * MIN,
      upSince: null,
      failStatus: 503,
      failError: "HTTP 503",
      failStreak: 3,
      startedLabel: "10:45",
      endedLabel: null,
    });
    assert.equal(msg.subject, "🚨 Strona sklepu nie odpowiada od 15 min — Sklep <Test>");
    assert.match(msg.text, /^PILNE - Strona sklepu nie odpowiada od 15 min \(Sklep <Test>\)/);
    assert.match(msg.text, /Od kiedy: 10:45 - 3 nieudane sprawdzenia z rzędu, sprawdzamy co 5 minut\./);
    assert.match(msg.text, /Co sprawdzić:\n- Hosting/);
    assert.match(msg.html, /Sklep &lt;Test&gt;/);
    assert.match(msg.html, /href="https:\/\/sklep\.pl\/\?a=1&amp;b=2"/);
    assert.match(msg.html, /<li[^>]*>Hosting:/);
    assert.ok(!msg.html.includes("<Test>"));
    assert.match(msg.telegram, /^🚨 <b>Sklep &lt;Test&gt;: strona sklepu nie odpowiada od 15 min<\/b>/);
  });

  test("UP message with the outage length", () => {
    const msg = siteNoticeMessage({
      event: "up",
      clientName: "DRE",
      isShop: false,
      url: "https://dre.pl/",
      now: T0,
      downSince: T0 - 52 * MIN,
      upSince: T0 - 10 * MIN,
      failStatus: null,
      failError: "Timeout was reached",
      failStreak: 0,
      startedLabel: "10:08",
      endedLabel: "10:50",
    });
    assert.equal(msg.subject, "✅ Strona znowu działa (przerwa: 42 min) — DRE");
    assert.match(msg.text, /Przerwa: Od 10:08 do 10:50\./);
    assert.match(msg.text, /Co widzieliśmy: Strona nie odpowiedziała w ciągu 10 s\./);
    assert.ok(!msg.text.includes("Co sprawdzić"));
    assert.ok(!msg.html.includes("Co sprawdzić"));
  });
});
