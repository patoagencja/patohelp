import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import {
  NEWS_CATEGORIES,
  fetchOneCategory,
  type NewsCategory,
} from "@/lib/news/fetch";
import { createAdminClient } from "@/lib/supabase/admin";

// On-demand news refresh (agency only), run inline so the UI can surface the
// exact failure (missing table / Claude call / insert) instead of a silent
// empty feed. Takes 1-2 min - the news page sets a matching maxDuration.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const clientSlug = searchParams.get("client");
  if (!clientSlug) {
    return NextResponse.json({ ok: false, error: "Missing client" }, { status: 400 });
  }

  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: "Brak dostępu" }, { status: access.status });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({
      ok: false,
      error: "Brak ANTHROPIC_API_KEY na serwerze.",
    });
  }

  const admin = createAdminClient();

  // 1. Table present?
  const { error: tableError } = await admin
    .from("news_items")
    .select("id", { count: "exact", head: true });
  if (tableError) {
    return NextResponse.json({
      ok: false,
      error: `Brak tabeli news_items w Supabase (odpal SQL z migracji 0015). Szczegół: ${tableError.message}`,
    });
  }

  // 2. Research ONE category per click. Doing all four in one request exceeded
  // the serverless time limit, so the call died and nothing was ever written.
  const today = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");
  const requested = new URL(request.url).searchParams.get(
    "category"
  ) as NewsCategory | null;

  const { data: todayRows } = await admin
    .from("news_items")
    .select("category")
    .eq("published_on", today);
  const done = new Set((todayRows ?? []).map((r) => r.category as string));
  // Nothing left for today -> refresh the first category again, so the button
  // always does something useful.
  const target =
    requested ?? NEWS_CATEGORIES.find((c) => !done.has(c)) ?? NEWS_CATEGORIES[0];

  const { data: recent } = await admin
    .from("news_items")
    .select("title")
    .order("published_on", { ascending: false })
    .limit(40);

  let items;
  let diags;
  try {
    // No backfill pass here: the user is watching a spinner, so this must be a
    // single Claude call. The cron does the wider top-up unattended.
    ({ items, diags } = await fetchOneCategory(
      target,
      (recent ?? []).map((r) => r.title as string),
      { backfill: false }
    ));
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: `Wywołanie Claude/web search padło: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
  }

  if (items.length === 0) {
    const apiErr = diags?.find((d) => d.error)?.error;
    return NextResponse.json({
      ok: false,
      error: apiErr
        ? `Kategoria ${target}: ${apiErr}`
        : `Kategoria ${target}: Claude nie zwrócił świeżych newsów (wszystko odpadło na filtrze świeżości albo research nic nie znalazł). Spróbuj ponownie.`,
    });
  }

  // 3. Persist (only this category's rows for today).
  await admin
    .from("news_items")
    .delete()
    .eq("published_on", today)
    .eq("category", target);
  const { error: insertError } = await admin.from("news_items").insert(
    items.map((i) => ({
      published_on: today,
      category: i.category,
      title: i.title,
      summary: i.summary,
      source_name: i.source_name,
      source_url: i.source_url,
    }))
  );
  if (insertError) {
    return NextResponse.json({
      ok: false,
      error: `Zapis do bazy padł: ${insertError.message}`,
    });
  }

  const remaining = NEWS_CATEGORIES.filter((c) => c !== target && !done.has(c));
  return NextResponse.json({
    ok: true,
    count: items.length,
    category: target,
    remaining,
  });
}
