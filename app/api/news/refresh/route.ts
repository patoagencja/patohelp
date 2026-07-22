import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { fetchDailyNews } from "@/lib/news/fetch";
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

  // 2. Research via Claude + web search.
  const { data: recent } = await admin
    .from("news_items")
    .select("title")
    .order("published_on", { ascending: false })
    .limit(60);

  let items;
  try {
    items = await fetchDailyNews((recent ?? []).map((r) => r.title as string));
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: `Wywołanie Claude/web search padło: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
  }

  if (items.length === 0) {
    return NextResponse.json({
      ok: false,
      error:
        "Claude nie zwrócił świeżych newsów (wszystko odpadło na filtrze świeżości albo research nic nie znalazł). Spróbuj ponownie za chwilę.",
    });
  }

  // 3. Persist.
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
  if (insertError) {
    return NextResponse.json({
      ok: false,
      error: `Zapis do bazy padł: ${insertError.message}`,
    });
  }

  return NextResponse.json({ ok: true, count: items.length });
}
