import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CLAIM_LEASE_MS,
  MAX_ATTEMPTS_PER_DAY,
  MAX_PARALLEL,
  MIN_RESEARCH_MS,
  RESEARCH_DEADLINE_MS,
  categoryStatus,
  isLiveClaim,
  planNewsTick,
  remainingAfter,
  researchBudgetMs,
  type NewsPlan,
  type NewsPlanInput,
  type NewsRunRow,
} from "./plan.ts";

const CATS = ["meta", "google", "tiktok", "ai"];
const NOW = Date.parse("2026-11-07T06:05:00Z"); // 07:05 in Warsaw

const run = (category: string, status: NewsRunRow["status"], attempts: number, ageMs = 60_000): NewsRunRow => ({
  category,
  status,
  attempts,
  started_at: new Date(NOW - ageMs).toISOString(),
});

const plan = (over: Partial<NewsPlanInput> = {}): NewsPlan =>
  planNewsTick({ categories: CATS, hourPl: 7, withItems: new Set(), runs: [], now: NOW, ...over });

const targets = (p: NewsPlan) => (p.kind === "research" ? p.targets.map((t) => t.category) : []);

test("nothing before 06:00 Warsaw unless forced or asked for by name", () => {
  assert.equal(plan({ hourPl: 5 }).kind, "before-start");
  assert.equal(plan({ hourPl: 5, force: true }).kind, "research");
  assert.deepEqual(targets(plan({ hourPl: 5, only: "ai" })), ["ai"]);
  assert.equal(plan({ hourPl: 6 }).kind, "research");
});

test("a fresh day starts with the first categories, MAX_PARALLEL at a time", () => {
  const p = plan();
  assert.equal(p.kind, "research");
  assert.deepEqual(targets(p), CATS.slice(0, MAX_PARALLEL));
  if (p.kind === "research") {
    assert.ok(p.targets.every((t) => t.attempt === 1 && t.previous === null));
  }
});

test("the day completes in ceil(categories / MAX_PARALLEL) calls when every call succeeds", () => {
  const withItems = new Set<string>();
  const runs: NewsRunRow[] = [];
  let calls = 0;
  for (; calls < 10; calls += 1) {
    const p = plan({ withItems, runs });
    if (p.kind !== "research") break;
    for (const t of p.targets) {
      withItems.add(t.category);
      runs.push(run(t.category, "done", t.attempt));
    }
  }
  assert.equal(calls, Math.ceil(CATS.length / MAX_PARALLEL));
  const last = plan({ withItems, runs });
  assert.equal(last.kind, "idle");
  if (last.kind === "idle") assert.equal(last.reason, "complete");
});

test("categories with items today are done, whatever the run rows say", () => {
  const p = plan({ withItems: new Set(["meta", "google", "tiktok"]), runs: [run("meta", "failed", 2)] });
  assert.deepEqual(targets(p), ["ai"]);
  if (p.kind === "research") assert.deepEqual(p.done, ["meta", "google", "tiktok"]);
});

test("a live claim is never researched twice; the plan reports busy when nothing else is left", () => {
  const runs = [run("meta", "running", 1), run("google", "running", 1)];
  const p = plan({ withItems: new Set(["tiktok", "ai"]), runs });
  assert.equal(p.kind, "idle");
  if (p.kind === "idle") {
    assert.equal(p.reason, "busy");
    assert.deepEqual(p.running, ["meta", "google"]);
  }
  // Other categories still go ahead next to a live claim.
  assert.deepEqual(targets(plan({ runs })), ["tiktok", "ai"]);
});

test("a claim older than the lease belongs to a killed call and is taken over as the next attempt", () => {
  const stale = run("meta", "running", 1, CLAIM_LEASE_MS + 1);
  assert.equal(isLiveClaim(stale, NOW), false);
  const p = plan({ withItems: new Set(["google", "tiktok", "ai"]), runs: [stale] });
  assert.equal(p.kind, "research");
  if (p.kind === "research") {
    assert.deepEqual(p.targets, [{ category: "meta", attempt: 2, previous: stale }]);
  }
});

test("the lease outlives the longest call: a 5-minute-old claim is still live", () => {
  assert.ok(CLAIM_LEASE_MS > 300_000);
  assert.equal(isLiveClaim(run("meta", "running", 1, 300_000), NOW), true);
  assert.equal(isLiveClaim({ ...run("meta", "running", 1), started_at: null }, NOW), false);
  assert.equal(isLiveClaim({ ...run("meta", "running", 1), started_at: "garbage" }, NOW), false);
});

test("a category is given up for the day after MAX_ATTEMPTS_PER_DAY paid calls", () => {
  const runs = [run("meta", "failed", MAX_ATTEMPTS_PER_DAY), run("google", "failed", 1)];
  const p = plan({ withItems: new Set(["tiktok", "ai"]), runs });
  assert.deepEqual(targets(p), ["google"]);
  if (p.kind === "research") {
    assert.deepEqual(p.given_up, ["meta"]);
    assert.equal(p.targets[0].attempt, 2);
  }
  const later = plan({
    withItems: new Set(["tiktok", "ai"]),
    runs: [run("meta", "failed", MAX_ATTEMPTS_PER_DAY), run("google", "failed", MAX_ATTEMPTS_PER_DAY)],
  });
  assert.equal(later.kind, "idle");
  if (later.kind === "idle") {
    assert.equal(later.reason, "complete");
    assert.deepEqual(later.given_up, ["meta", "google"]);
  }
});

test("a stale claim on the last allowed attempt is given up, not retried", () => {
  const stale = run("meta", "running", MAX_ATTEMPTS_PER_DAY, CLAIM_LEASE_MS + 1);
  assert.equal(categoryStatus(stale, false, NOW), "given-up");
});

test("force ignores the attempts cap", () => {
  const runs = [run("meta", "failed", MAX_ATTEMPTS_PER_DAY)];
  const p = plan({ withItems: new Set(["google", "tiktok", "ai"]), runs, force: true });
  assert.deepEqual(targets(p), ["meta"]);
});

test("never-tried categories go before retries", () => {
  const p = plan({ runs: [run("meta", "failed", 1)] });
  assert.deepEqual(targets(p), ["google", "tiktok"]);
});

test("asked for by name: researched even when done or over the cap, but not while a live call has it", () => {
  const withItems = new Set(["meta"]);
  const p = plan({ withItems, runs: [run("meta", "done", 1)], only: "meta" });
  assert.equal(p.kind, "research");
  if (p.kind === "research") assert.deepEqual(p.targets, [{ category: "meta", attempt: 2, previous: run("meta", "done", 1) }]);

  assert.deepEqual(targets(plan({ runs: [run("ai", "failed", 5)], only: "ai" })), ["ai"]);

  const busy = plan({ withItems, runs: [run("meta", "running", 2)], only: "meta" });
  assert.equal(busy.kind, "idle");
  if (busy.kind === "idle") assert.equal(busy.reason, "busy");
});

test("without news_runs (not migrated): one category per call, rotating so none starves", () => {
  const seen = new Set<string>();
  for (let tick = 0; tick < CATS.length; tick += 1) {
    const p = plan({ runs: null, rotation: tick });
    const t = targets(p);
    assert.equal(t.length, 1);
    seen.add(t[0]);
  }
  assert.equal(seen.size, CATS.length);
  // Done categories are still skipped.
  assert.deepEqual(targets(plan({ runs: null, withItems: new Set(["meta", "google", "tiktok"]) })), ["ai"]);
});

test("without news_runs a category that never fills is not paid for all day", () => {
  // Production ran without migration 0044 ("migrated": false): no claims,
  // no attempts cap. A category that keeps coming back empty was then
  // researched on every 30-minute tick from 06:00 to midnight (36 calls).
  const withItems = new Set<string>();
  let paid = 0;
  for (let tick = 0; tick < 36; tick += 1) {
    const hourPl = 6 + Math.floor(tick / 2);
    const p = plan({ runs: null, withItems, hourPl, rotation: tick });
    for (const t of targets(p)) {
      paid += 1;
      if (t !== "tiktok") withItems.add(t); // tiktok never finds anything fresh
    }
  }
  // The same daily budget the claims enforce once migrated: each category
  // twice, in total.
  assert.ok(paid <= CATS.length * MAX_ATTEMPTS_PER_DAY, `paid ${paid} research calls`);
  // ... and every category still got its turn in the morning.
  assert.deepEqual([...withItems].sort(), ["ai", "google", "meta"]);
  const late = plan({ runs: null, withItems, hourPl: 15 });
  assert.equal(late.kind, "idle");
  // The button (a category by name) and ?force=1 still research.
  assert.deepEqual(targets(plan({ runs: null, withItems, hourPl: 15, only: "tiktok", force: true })), ["tiktok"]);
  assert.deepEqual(targets(plan({ runs: null, withItems, hourPl: 15, force: true })), ["tiktok"]);
  // Migrated: the claims cap it, not the clock.
  assert.equal(plan({ runs: [], hourPl: 15 }).kind, "research");
});

test("the research deadline leaves time to save before maxDuration (300 s) and stays under curl's 310 s", () => {
  assert.equal(researchBudgetMs(0), RESEARCH_DEADLINE_MS);
  assert.equal(researchBudgetMs(2_000), RESEARCH_DEADLINE_MS - 2_000);
  assert.equal(researchBudgetMs(-5), RESEARCH_DEADLINE_MS);
  assert.ok(RESEARCH_DEADLINE_MS + 30_000 <= 300_000);
  assert.ok(researchBudgetMs(RESEARCH_DEADLINE_MS - MIN_RESEARCH_MS + 1) < MIN_RESEARCH_MS);
});

test("remaining = not done before and not filled now", () => {
  assert.deepEqual(
    remainingAfter(CATS, { done: ["meta"], running: ["google"], given_up: [] }, ["tiktok"]),
    ["google", "ai"]
  );
});
