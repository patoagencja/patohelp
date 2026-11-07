import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";

import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { NEWS_CATEGORIES, isNewsCategory, type NewsCategory } from "@/lib/news/fetch";
import { planNewsTick, remainingAfter, researchBudgetMs } from "@/lib/news/plan";
import {
  claimTarget,
  readNewsDay,
  recentNewsTitles,
  researchAndStore,
} from "@/lib/news/runs";
import { createAdminClient } from "@/lib/supabase/admin";

// On-demand news refresh (agency only), run inline so the UI can surface the
// exact failure (missing table / Claude call / insert) instead of a silent
// empty feed. ONE category per click, through the same claim as the cron
// (lib/news/plan.ts): a category the cron is researching right now isn't paid
// for twice, and the research stops at the same deadline as the cron's.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const startedAt = Date.now();
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

  // 2. Pick the category: the one asked for, else the first missing today,
  // else the first one again (so the button always does something useful).
  const now = new Date(startedAt);
  const today = formatInTimeZone(now, "Europe/Warsaw", "yyyy-MM-dd");
  const requested = searchParams.get("category");
  if (requested !== null && !isNewsCategory(requested)) {
    return NextResponse.json({ ok: false, error: "Nieznana kategoria." }, { status: 400 });
  }
  const day = await readNewsDay(admin, today);
  if (!day.ok) {
    return NextResponse.json({ ok: false, error: `Odczyt newsów padł: ${day.error}` });
  }
  const { withItems, runs } = day.state;
  const target: NewsCategory =
    requested ?? NEWS_CATEGORIES.find((c) => !withItems.has(c)) ?? NEWS_CATEGORIES[0];

  const busy = () =>
    NextResponse.json({
      ok: false,
      error: `Kategoria ${target} jest właśnie pobierana (automatycznie albo przez kogoś innego). Newsy pojawią się za kilka minut.`,
    });
  const plan = planNewsTick({
    categories: NEWS_CATEGORIES,
    hourPl: Number(formatInTimeZone(now, "Europe/Warsaw", "H")),
    withItems,
    runs,
    now: startedAt,
    only: target,
    force: true,
  });
  if (plan.kind !== "research") return busy();
  const step = plan.targets[0];
  if (runs !== null) {
    const claim = await claimTarget(admin, today, step, new Date().toISOString());
    if (claim === "taken") return busy();
    if (claim === "error") {
      return NextResponse.json({
        ok: false,
        error: "Nie udało się zarezerwować kategorii w bazie (news_runs). Spróbuj ponownie.",
      });
    }
  }

  // 3. Research and persist (only this category's rows for today).
  const recentTitles = await recentNewsTitles(admin);
  const result = await researchAndStore(
    admin,
    today,
    target,
    runs !== null ? step.attempt : null,
    recentTitles,
    researchBudgetMs(Date.now() - startedAt)
  );

  if (result.items === 0) {
    const apiErr = result.diag.error;
    return NextResponse.json({
      ok: false,
      error: result.writeError
        ? `Zapis do bazy padł: ${result.writeError}`
        : apiErr
          ? `Kategoria ${target}: ${apiErr}`
          : result.diag.timed_out
            ? `Kategoria ${target}: research trwał za długo i został przerwany, zanim powstał jakikolwiek news. Spróbuj ponownie.`
            : `Kategoria ${target}: Claude nie zwrócił świeżych newsów (wszystko odpadło na filtrze świeżości albo research nic nie znalazł). Spróbuj ponownie.`,
    });
  }

  return NextResponse.json({
    ok: true,
    count: result.items,
    category: target,
    remaining: remainingAfter(NEWS_CATEGORIES, plan, [target]),
  });
}
