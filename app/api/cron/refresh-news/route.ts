import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import {
  NEWS_CATEGORIES,
  fetchOneCategory,
  type NewsCategory,
} from "@/lib/news/fetch";
import { createAdminClient } from "@/lib/supabase/admin";

// Refreshes the "Newsy" industry feed via Claude + web search.
//
// ONE CATEGORY PER INVOCATION on purpose. Researching all four in a single
// request meant ~8 Claude calls with web search back to back, which ran past
// the serverless time limit - the request died, nothing was written, and the
// feed silently froze for weeks. The external cron pings this every 30 min, so
// each run fills the next category still missing for today and all four are in
// place shortly after 06:00 PL.
//   ?category=meta  - refresh a specific category
//   ?force=1        - ignore the "already done today" / before-06:00 guards
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { searchParams } = new URL(request.url);
  const today = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");
  const force = searchParams.get("force") === "1";
  const only = searchParams.get("category") as NewsCategory | null;

  if (!force && !only) {
    const hourPl = Number(formatInTimeZone(new Date(), "Europe/Warsaw", "H"));
    if (hourPl < 6) {
      return NextResponse.json({ ok: true, items_inserted: 0, note: "before 6:00" });
    }
  }

  // Which categories already have items for today?
  const { data: todayRows, error: todayErr } = await admin
    .from("news_items")
    .select("category")
    .eq("published_on", today);
  if (todayErr) {
    return NextResponse.json({ ok: false, error: todayErr.message }, { status: 500 });
  }
  const done = new Set((todayRows ?? []).map((r) => r.category as string));

  // Rotate through the MISSING categories instead of always taking the first
  // one. Picking `find(...)` meant a category that keeps coming back empty was
  // retried on every tick forever and the ones after it in the list were never
  // attempted at all - which is why the feed only ever had Meta items.
  const missing = NEWS_CATEGORIES.filter((c) => !done.has(c));
  const slot = Math.floor(Date.now() / (30 * 60 * 1000)); // advances each tick
  const target =
    only ?? (missing.length ? missing[slot % missing.length] : null);
  if (!target) {
    return NextResponse.json({
      ok: true,
      items_inserted: 0,
      note: "all categories done today",
      done: [...done],
    });
  }

  // Titles from recent days so the model skips already-covered stories.
  const { data: recent } = await admin
    .from("news_items")
    .select("title")
    .order("published_on", { ascending: false })
    .limit(40);
  const recentTitles = (recent ?? []).map((r) => r.title as string);

  // No backfill pass here either: this runs unattended every 30 min with no
  // human watching the cost. A thin category some day (fewer than 4 fresh
  // items) is fine - it is NOT worth silently doubling the Claude spend on an
  // automated path. Use ?category= manually if a category genuinely needs the
  // wider sweep.
  const { items, diags } = await fetchOneCategory(target, recentTitles, {
    backfill: false,
  });

  if (items.length === 0) {
    return NextResponse.json({
      ok: false,
      category: target,
      items_inserted: 0,
      note: "no items for this category",
      diags,
    });
  }

  // Replace only this category's rows for today (other categories untouched).
  await admin
    .from("news_items")
    .delete()
    .eq("published_on", today)
    .eq("category", target);

  const { error } = await admin.from("news_items").insert(
    items.map((i) => ({
      published_on: today,
      category: i.category,
      title: i.title,
      summary: i.summary,
      source_name: i.source_name,
      source_url: i.source_url,
    }))
  );
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const remaining = NEWS_CATEGORIES.filter(
    (c) => c !== target && !done.has(c)
  );
  return NextResponse.json({
    ok: true,
    category: target,
    items_inserted: items.length,
    remaining,
  });
}
