import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { isCronAuthorized } from "@/lib/integrations/cron-auth";
import { NEWS_CATEGORIES, isNewsCategory, type NewsCategory } from "@/lib/news/fetch";
import {
  MIN_RESEARCH_MS,
  NEWS_START_HOUR_PL,
  TICK_MS,
  planNewsTick,
  remainingAfter,
  researchBudgetMs,
  type NewsTarget,
} from "@/lib/news/plan";
import {
  claimTarget,
  readNewsDay,
  recentNewsTitles,
  researchAndStore,
} from "@/lib/news/runs";
import { createAdminClient } from "@/lib/supabase/admin";

// Builds the daily "Newsy" feed (Claude + web search), one step per call.
//
// Every call used to run past the scheduler's curl limit (HTTP 000 on every
// tick): one Claude call with no deadline, three searches, 5000 output tokens
// and the SDK's two silent retries could outlive curl (180 s) and even
// maxDuration, and a killed or empty category was simply researched again on
// the next tick, all day. Now (lib/news/plan.ts):
// - most calls answer in a second: before 06:00 PL, day complete, or the
//   remaining categories are being researched by another call;
// - otherwise up to two categories are claimed in news_runs and researched in
//   parallel, each call cut at RESEARCH_DEADLINE_MS (keeping what streamed in),
//   so the response comes back by ~255 s, under maxDuration and curl's 310 s;
// - each category is researched at most twice a day, never by two calls at
//   once, and a claim left by a killed call expires after the lease.
//   ?category=meta  - research that category now (even if done today)
//   ?force=1        - ignore the before-06:00 guard and the attempts cap
export const dynamic = "force-dynamic";
// Keep in step with RESEARCH_DEADLINE_MS / CLAIM_LEASE_MS (lib/news/plan.ts)
// and the curl limit of the news job in .github/workflows/cron.yml.
export const maxDuration = 300;

export async function GET(request: Request) {
  const startedAt = Date.now();
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const force = searchParams.get("force") === "1";
  const only = searchParams.get("category");
  if (only !== null && !isNewsCategory(only)) {
    return NextResponse.json({ ok: false, error: "Unknown category" }, { status: 400 });
  }

  const now = new Date(startedAt);
  const today = formatInTimeZone(now, "Europe/Warsaw", "yyyy-MM-dd");
  const hourPl = Number(formatInTimeZone(now, "Europe/Warsaw", "H"));
  // Most night ticks end here, without a database round trip.
  if (!force && !only && hourPl < NEWS_START_HOUR_PL) {
    return NextResponse.json({ ok: true, items_inserted: 0, note: "before 6:00" });
  }

  const admin = createAdminClient();
  const day = await readNewsDay(admin, today);
  if (!day.ok) {
    return NextResponse.json({ ok: false, error: day.error }, { status: 500 });
  }
  const { withItems, runs } = day.state;
  const migrated = runs !== null;

  const plan = planNewsTick({
    categories: NEWS_CATEGORIES,
    hourPl,
    withItems,
    runs,
    now: startedAt,
    only,
    force,
    rotation: Math.floor(startedAt / TICK_MS),
  });
  if (plan.kind === "before-start") {
    return NextResponse.json({ ok: true, items_inserted: 0, note: "before 6:00" });
  }
  const counts = {
    done: plan.done.length,
    running: plan.running.length,
    given_up: plan.given_up.length,
    migrated,
  };
  if (plan.kind === "idle") {
    return NextResponse.json({
      ok: true,
      items_inserted: 0,
      note:
        plan.reason === "busy"
          ? "being researched by another call"
          : plan.reason === "capped"
            ? "news_runs missing (migration 0044): no automatic research after the morning hours"
            : "all categories done today",
      ...counts,
      remaining: remainingAfter(NEWS_CATEGORIES, plan, []).length,
    });
  }

  // Claim before paying for the research: a category another call got first
  // is skipped. Without news_runs (not migrated) there's nothing to claim.
  const nowIso = new Date().toISOString();
  const claims = await Promise.all(
    plan.targets.map(async (target) => ({
      target,
      result: migrated ? await claimTarget(admin, today, target, nowIso) : ("claimed" as const),
    }))
  );
  const mine: NewsTarget[] = claims.filter((c) => c.result === "claimed").map((c) => c.target);
  const claimErrors = claims
    .filter((c) => c.result === "error")
    .map((c) => `${c.target.category}: claim failed`);
  if (mine.length === 0) {
    return NextResponse.json({
      ok: claimErrors.length === 0,
      items_inserted: 0,
      note: "claimed by another call",
      ...counts,
      ...(claimErrors.length ? { errors: claimErrors } : {}),
    });
  }

  const recentTitles = await recentNewsTitles(admin);
  const budget = researchBudgetMs(Date.now() - startedAt);
  if (budget < MIN_RESEARCH_MS) {
    // Practically unreachable (the reads above take a second or two); the
    // claims expire after the lease and the next tick takes them again.
    return NextResponse.json({ ok: false, items_inserted: 0, note: "no time left", ...counts });
  }

  // Independent categories side by side: the call takes as long as the
  // slowest one, not their sum, and every one stops at the same deadline.
  const results = await Promise.all(
    mine.map((target) =>
      researchAndStore(
        admin,
        today,
        target.category as NewsCategory,
        migrated ? target.attempt : null,
        recentTitles,
        budget
      )
    )
  );

  const filled = results.filter((r) => r.items > 0).map((r) => r.category);
  const sum = (pick: (r: (typeof results)[number]) => number | undefined) =>
    results.reduce((acc, r) => acc + (pick(r) ?? 0), 0);
  const errors = [
    ...claimErrors,
    ...results.filter((r) => r.error).map((r) => `${r.category}: ${r.error}`),
  ];
  return NextResponse.json({
    ok: filled.length === results.length && claimErrors.length === 0,
    researched: results.length,
    items_inserted: sum((r) => r.items),
    timed_out: results.filter((r) => r.diag.timed_out).length,
    ...counts,
    remaining: remainingAfter(NEWS_CATEGORIES, plan, filled).length,
    // Usage of this call's research, to keep an eye on the cost per day.
    input_tokens: sum((r) => r.diag.input_tokens),
    output_tokens: sum((r) => r.diag.output_tokens),
    web_searches: sum((r) => r.diag.web_searches),
    seconds: Math.round((Date.now() - startedAt) / 1000),
    categories: results.map((r) => ({ category: r.category, items: r.items })),
    ...(errors.length ? { errors } : {}),
    diags: results.map((r) => r.diag),
  });
}
