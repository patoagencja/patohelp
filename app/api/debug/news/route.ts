import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { fetchDailyNews } from "@/lib/news/fetch";
import { createAdminClient } from "@/lib/supabase/admin";

// Diagnostic for the Newsy feed: runs each step of the refresh inline and
// reports where it breaks (missing table / Claude call / insert). Agency only.
// Visit /api/debug/news?client=olx while logged in - takes 1-2 min.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const clientSlug = searchParams.get("client") ?? "olx";

  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) {
    return NextResponse.json({ error: "Brak dostępu" }, { status: access.status });
  }

  const admin = createAdminClient();
  const diag: Record<string, unknown> = {
    has_anthropic_key: Boolean(process.env.ANTHROPIC_API_KEY),
  };

  // 1. Does the table exist?
  const { count, error: tableError } = await admin
    .from("news_items")
    .select("id", { count: "exact", head: true });
  diag.table_ok = !tableError;
  diag.table_error = tableError?.message ?? null;
  diag.existing_rows = count ?? 0;
  if (tableError) {
    diag.verdict = "BRAK TABELI news_items - odpal SQL z migracji 0015 w Supabase.";
    return NextResponse.json(diag);
  }

  // 2. Fetch from Claude + web search.
  try {
    const items = await fetchDailyNews([]);
    diag.fetched_items = items.length;
    diag.sample = items.slice(0, 3).map((i) => ({
      category: i.category,
      title: i.title,
      source: i.source_name,
    }));

    if (items.length === 0) {
      diag.verdict =
        "Claude zwrócił 0 świeżych newsów (albo wszystko odpadło na filtrze świeżości / JSON się nie sparsował).";
      return NextResponse.json(diag);
    }

    // 3. Insert.
    const today = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");
    await admin.from("news_items").delete().eq("published_on", today);
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
    diag.insert_ok = !insertError;
    diag.insert_error = insertError?.message ?? null;
    diag.verdict = insertError
      ? "Zapis do bazy padł - patrz insert_error."
      : `OK - zapisano ${items.length} newsów. Odśwież zakładkę Newsy.`;
  } catch (err) {
    diag.fetch_error = err instanceof Error ? err.message : String(err);
    diag.verdict = "Wywołanie Claude/web search padło - patrz fetch_error.";
  }

  return NextResponse.json(diag);
}
