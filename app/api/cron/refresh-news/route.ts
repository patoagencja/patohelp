import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { fetchDailyNews } from "@/lib/news/fetch";
import { createAdminClient } from "@/lib/supabase/admin";

// Vercel Cron (daily): refresh the "Newsy" industry feed via Claude + web
// search. Replaces today's items so a manual re-run stays idempotent.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const today = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");
  const force = new URL(request.url).searchParams.get("force") === "1";

  // The external scheduler pings this every 30 minutes; the route itself
  // enforces "one prasówka per day, generated in the morning". ?force=1
  // (manual refresh) bypasses both guards.
  if (!force) {
    const hourPl = Number(formatInTimeZone(new Date(), "Europe/Warsaw", "H"));
    if (hourPl < 6) {
      return NextResponse.json({ ok: true, items_inserted: 0, note: "before 6:00" });
    }
    const { count } = await admin
      .from("news_items")
      .select("id", { count: "exact", head: true })
      .eq("published_on", today);
    if (count) {
      return NextResponse.json({ ok: true, items_inserted: 0, note: "already today" });
    }
  }

  // Titles from the last 5 days, so the model skips already-covered stories.
  const { data: recent } = await admin
    .from("news_items")
    .select("title")
    .order("published_on", { ascending: false })
    .limit(60);
  const recentTitles = (recent ?? []).map((r) => r.title as string);

  const items = await fetchDailyNews(recentTitles);

  if (items.length === 0) {
    return NextResponse.json({ ok: true, items_inserted: 0, note: "no items" });
  }

  await admin.from("news_items").delete().eq("published_on", today);
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

  return NextResponse.json({ ok: true, items_inserted: items.length });
}
