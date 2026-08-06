import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { fetchOneCategory, type NewsCategory } from "@/lib/news/fetch";
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
    // ONE category (default: meta) and no backfill pass, so this returns in
    // well under the function time limit. ?category=google|tiktok|ai to switch.
    const category =
      (searchParams.get("category") as NewsCategory | null) ?? "meta";
    diag.category = category;
    const started = Date.now();
    const { items, diags } = await fetchOneCategory(category, [], {
      backfill: false,
    });
    diag.took_ms = Date.now() - started;
    diag.fetched_items = items.length;
    // Per-category breakdown: stop_reason, parsed count, how many were dropped
    // by the freshness gate, and any API error - so an empty feed names its
    // own cause instead of "0 items".
    diag.per_category = diags;
    diag.sample = items.slice(0, 3).map((i) => ({
      category: i.category,
      title: i.title,
      source: i.source_name,
    }));

    if (items.length === 0) {
      const errs = diags.filter((d) => d.error).map((d) => `${d.category}: ${d.error}`);
      const stale = diags.reduce((a, d) => a + (d.dropped_stale ?? 0), 0);
      const trunc = diags.some((d) => d.stop_reason === "max_tokens");
      diag.verdict = errs.length
        ? `Wywołania Claude padły -> ${errs.join(" | ")}`
        : trunc
          ? "Odpowiedź ucięta na max_tokens - JSON niekompletny."
          : stale > 0
            ? `Wszystkie ${stale} newsów odpadło na filtrze świeżości (model podał stare daty).`
            : "Claude nie zwrócił żadnych pozycji (parsed=0) - zobacz per_category.";
      return NextResponse.json(diag);
    }

    // 3. Insert.
    const today = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");
    await admin
      .from("news_items")
      .delete()
      .eq("published_on", today)
      .eq("category", category);
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
