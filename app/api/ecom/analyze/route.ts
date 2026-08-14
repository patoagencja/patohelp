import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { generateEcomAnalysis, type DailyPoint } from "@/lib/ecom/analysis";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";

// Generate + cache the AI e-commerce analysis for a client. Agency only.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const clientSlug = new URL(request.url).searchParams.get("client");
  if (!clientSlug) {
    return NextResponse.json({ ok: false, error: "Brak client" }, { status: 400 });
  }
  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: "Brak dostępu" }, { status: access.status });
  }

  const admin = createAdminClient();
  const cid = access.clientId;
  const force = new URL(request.url).searchParams.get("force") === "1";

  // Cost guard: this call does real web search + Sonnet, so a re-click (agency
  // checking back, or just curiosity) must not silently re-bill. One real
  // generation per client per ~20h; ?force=1 bypasses for when it's genuinely
  // needed sooner (e.g. right after a data fix).
  if (!force) {
    const { data: recent } = await admin
      .from("ecom_analyses")
      .select("content, generated_at")
      .eq("client_id", cid)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recent?.generated_at) {
      const ageMs = Date.now() - new Date(recent.generated_at as string).getTime();
      if (ageMs < 20 * 60 * 60 * 1000) {
        return NextResponse.json({
          ok: true,
          analysis: recent.content,
          cached: true,
          generated_at: recent.generated_at,
        });
      }
    }
  }

  const { data: client } = await admin
    .from("clients")
    .select("name")
    .eq("id", cid)
    .maybeSingle();
  const clientName = (client?.name as string) ?? clientSlug;

  const today = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");
  const since = formatInTimeZone(subDays(new Date(), 89), "Europe/Warsaw", "yyyy-MM-dd");

  // Daily revenue + transactions (GA4 totals) and spend (ads).
  const ga4 = await admin
    .from("ga4_daily")
    .select("date, revenue_minor_units, transactions")
    .eq("client_id", cid)
    .is("source_medium", null)
    .is("device_category", null)
    .is("page_path", null)
    .gte("date", since)
    .lte("date", today);
  if (ga4.error) {
    return NextResponse.json(
      { ok: false, error: "Brak kolumn przychodu - uruchom migrację 0016." },
      { status: 400 }
    );
  }

  const { data: adsRows } = await admin
    .from("ads_daily")
    .select("date, spend_minor_units")
    .eq("client_id", cid)
    .gte("date", since)
    .lte("date", today);

  const byDate = new Map<string, DailyPoint>();
  const get = (d: string) => {
    let p = byDate.get(d);
    if (!p) {
      p = { date: d, revenue: 0, spend: 0, transactions: 0 };
      byDate.set(d, p);
    }
    return p;
  };
  for (const r of ga4.data ?? []) {
    const p = get(r.date as string);
    p.revenue += Number((r as { revenue_minor_units?: number }).revenue_minor_units ?? 0) / 100;
    p.transactions += Number((r as { transactions?: number }).transactions ?? 0);
  }
  for (const r of adsRows ?? []) {
    get(r.date as string).spend += Number(r.spend_minor_units) / 100;
  }
  const daily = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

  if (daily.every((d) => d.revenue === 0)) {
    return NextResponse.json(
      { ok: false, error: "Brak danych sprzedażowych z GA4 (0 przychodu). Sprawdź tracking e-commerce w GA4 i odśwież dane." },
      { status: 400 }
    );
  }

  let analysis;
  try {
    analysis = await generateEcomAnalysis(clientName, daily);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Błąd generowania: ${(e as Error).message}` },
      { status: 500 }
    );
  }
  if (!analysis) {
    return NextResponse.json(
      { ok: false, error: "Nie udało się wygenerować analizy (brak ANTHROPIC_API_KEY albo pusta odpowiedź)." },
      { status: 500 }
    );
  }

  await admin.from("ecom_analyses").insert({ client_id: cid, content: analysis });

  return NextResponse.json({ ok: true, analysis });
}
