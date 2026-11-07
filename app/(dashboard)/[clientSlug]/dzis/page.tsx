import { Suspense } from "react";
import { redirect } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";

import { SectionBoundary } from "@/components/dashboard/section-boundary";
import {
  alertItems,
  bestItems,
  briefLink,
  briefNote,
  budgetAction,
  goalActions,
  testActions,
  todayActions,
} from "@/components/dashboard/today/today-items";
import {
  TodayActions,
  TodayAlerts,
  TodayBest,
  TodayBrief,
  TodayColumn,
  TodaySectionSkeleton,
} from "@/components/dashboard/today/today-view";
import { loadAbView } from "@/lib/ab/load";
import { getCurrentAlerts } from "@/lib/alerts/current";
import { getActiveGoals } from "@/lib/dashboard/campaign-goals";
import { getClientBySlug } from "@/lib/dashboard/context";
import { loadDashboardData } from "@/lib/dashboard/metrics";
import { addDays, buildBrief, pickBriefSource } from "@/lib/today/brief";
import { loadSeasonBudgetToday, loadShopDays, loadYesterdayBest } from "@/lib/today/load";

export const dynamic = "force-dynamic";

const WARSAW_TZ = "Europe/Warsaw";

/**
 * "Dziś": the phone-first morning view - the brief (yesterday against the
 * usual same weekday, today so far), what needs a look, what we do today,
 * and yesterday's best. Shops get it in the nav; for everyone else the page
 * still works on a direct link, in clicks and visits, never in sales.
 *
 * Every read is one the other tabs already cache (the overview's default
 * 30-day data, the bell's alert scan, Testy kreacji's 7-day view, the goal
 * tiles, the season view), plus two small per-day reads of its own
 * (lib/today/load). The brief waits for the 30-day data only; the sections
 * stream in after it, each behind its own boundary.
 */
export default async function TodayPage({ params }: { params: { clientSlug: string } }) {
  const client = await getClientBySlug(params.clientSlug);
  if (!client) redirect("/login");

  const base = `/${params.clientSlug}`;
  const isShop = client.clientType === "ecommerce";
  const now = new Date();
  const today = formatInTimeZone(now, WARSAW_TZ, "yyyy-MM-dd");
  const hour = Number(formatInTimeZone(now, WARSAW_TZ, "H"));

  // The overview's default range: its cached computation is shared, and its
  // 30 days hold yesterday and the four same weekdays before it.
  const [data, shopDays] = await Promise.all([
    loadDashboardData(client.id, "30d", null, null),
    // A failed read of the shop's own sales falls back to GA4.
    isShop ? loadShopDays(client.id, addDays(today, -29), today).catch(() => null) : Promise.resolve(null),
  ]);
  const picked = pickBriefSource({ isShop, trend: data.trend, shopDays, start: data.rangeStart, end: today });
  const brief = buildBrief({ picked, today, hour });
  const withVisits = picked?.days.some((d) => d.secondary !== null) ?? false;

  return (
    <div className="px-4 py-6 sm:px-6 md:py-8">
      <TodayColumn>
        {/* The top bar names the page; the heading stays for screen readers. */}
        <h1 className="sr-only">Dziś - {client.name}</h1>

        <TodayBrief
          brief={brief}
          note={briefNote(picked?.kind ?? null, picked?.source ?? null, withVisits)}
          link={briefLink(picked?.kind ?? null, base)}
        />

        <SectionBoundary name="today/alerts">
          <Suspense fallback={<TodaySectionSkeleton title="Na co uważać" rows={1} />}>
            <LiveAlerts clientId={client.id} alertsHref={`${base}/alerty`} />
          </Suspense>
        </SectionBoundary>

        <SectionBoundary name="today/actions">
          <Suspense fallback={<TodaySectionSkeleton title="Co dziś robimy" />}>
            <LiveActions clientId={client.id} base={base} isShop={isShop} today={today} />
          </Suspense>
        </SectionBoundary>

        <SectionBoundary name="today/best">
          <Suspense fallback={null}>
            <LiveBest clientId={client.id} base={base} isShop={isShop} yesterday={addDays(today, -1)} />
          </Suspense>
        </SectionBoundary>
      </TodayColumn>
    </div>
  );
}

/** The same scan the header bell counts (request-cached, shared until the next sync). */
async function LiveAlerts({ clientId, alertsHref }: { clientId: string; alertsHref: string }) {
  const { items, rest } = alertItems(await getCurrentAlerts(clientId));
  return <TodayAlerts items={items} rest={rest} alertsHref={alertsHref} />;
}

async function LiveActions({
  clientId,
  base,
  isShop,
  today,
}: {
  clientId: string;
  base: string;
  isShop: boolean;
  today: string;
}) {
  const [goals, ab, budget] = await Promise.all([
    getActiveGoals(clientId),
    // Tests are judged on purchases: shops only (engagement clients never
    // see ROAS). "7d" = the Testy kreacji page's default, so its cache.
    isShop ? loadAbView(clientId, "7d", today).catch(() => null) : Promise.resolve(null),
    // A failed season read leaves the budget row out, not the section.
    loadSeasonBudgetToday(clientId, today).catch(() => null),
  ]);
  const items = todayActions({
    goal: goalActions(goals, base),
    test: ab ? testActions(ab, base) : [],
    budget: budgetAction(budget, base),
  });
  return <TodayActions items={items} calmHref={base} withTests={isShop} />;
}

async function LiveBest({
  clientId,
  base,
  isShop,
  yesterday,
}: {
  clientId: string;
  base: string;
  isShop: boolean;
  yesterday: string;
}) {
  // Nice to have: a failed read just leaves the section out.
  const best = await loadYesterdayBest(clientId, yesterday, isShop).catch(() => null);
  return <TodayBest items={bestItems(best, base, isShop)} />;
}
