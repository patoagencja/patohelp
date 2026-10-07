import type { CSSProperties } from "react";
import Link from "next/link";
import { ArrowRight, CalendarRange } from "lucide-react";

import { dayMonthLong, daysWord, diffDaysIso } from "@/lib/season/config";
import { change, compactCount, compactPln } from "@/lib/season/format";
import { getClientSeason, loadSeasonView } from "@/lib/season/load";

/**
 * The overview's season strip for seasonal clients: where we are in the
 * season and the one comparison that matters, linking to the full page.
 * Async and self-contained so it streams in beside the rest of the overview
 * (inside a SectionBoundary) and costs nothing for other clients beyond one
 * cached read.
 */
export async function SeasonOverviewCard({
  clientId,
  clientSlug,
  showRevenue,
}: {
  clientId: string;
  clientSlug: string;
  showRevenue: boolean;
}) {
  const season = await getClientSeason(clientId);
  if (!season) return null;
  const view = await loadSeasonView(clientId, season);
  const { state, totals, prevSamePoint, hasPrev, today } = view;
  const running = state.phase === "in";
  const shop = showRevenue ? view.shop : null;
  const revenue = showRevenue && (view.hasValue || !!shop);
  const ch = shop
    ? shop.hasPrev
      ? change(shop.totals.revenue, shop.prevSamePoint.revenue)
      : null
    : revenue
      ? change(totals.value, prevSamePoint.value)
      : change(totals.clicks, prevSamePoint.clicks);
  const what = shop
    ? compactPln(shop.totals.revenue)
    : revenue
      ? compactPln(totals.value)
      : `${compactCount(totals.clicks)} kliknięć`;
  const salesWord = shop ? "sprzedaży w sklepie" : "sprzedaży z reklam";
  const next = view.moments.find((m) => m.date >= today);
  const progress = running ? Math.min(1, ((state.day ?? 0) - 0.5) / state.totalDays) : 1;

  let line: React.ReactNode;
  if (running) {
    line = (
      <>
        <b className="font-semibold text-foreground">{what}</b>{" "}
        {revenue ? salesWord : ""} od początku sezonu
        {hasPrev && ch ? (
          <>
            {" "}
            -{" "}
            <b className={ch.ratio >= 0 ? "font-semibold text-positive" : "font-semibold text-negative"}>
              {ch.ratio >= 0 ? `o ${ch.text} więcej` : `o ${ch.text} mniej`}
            </b>{" "}
            niż rok temu w tym momencie
          </>
        ) : null}
        {next ? (
          <>
            {" "}
            · {next.label} za {diffDaysIso(today, next.date)} {daysWord(diffDaysIso(today, next.date))}
          </>
        ) : null}
        .
      </>
    );
  } else if (state.next) {
    line = (
      <>
        Sezon {state.next.year} startuje za{" "}
        <b className="font-semibold text-foreground">
          {state.daysToNext} {daysWord(state.daysToNext ?? 0)}
        </b>{" "}
        ({dayMonthLong(state.next.start)}). Poprzedni sezon: <b className="font-semibold text-foreground">{what}</b>
        {revenue ? ` ${salesWord}` : ""}.
      </>
    );
  } else {
    line = <>Sezon {state.current.year}: {what}.</>;
  }

  return (
    <Link
      href={`/${clientSlug}/sezon`}
      className="glass group flex flex-wrap items-center gap-x-5 gap-y-3 rounded-card p-5 transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:hover:translate-y-0 sm:p-6"
    >
      <span
        aria-hidden
        className="grid h-12 w-12 shrink-0 place-items-center rounded-[16px] bg-lime-soft text-positive"
      >
        <CalendarRange className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-[1_1_18rem] space-y-1.5">
        <span className="kick block">
          {running
            ? `Sezon ${state.current.year} · dzień ${state.day} z ${state.totalDays}`
            : `Sezon ${state.current.year} · podsumowanie`}
        </span>
        <span className="block text-[15px] leading-relaxed text-ink-2">{line}</span>
        <span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-chip">
          <span
            className="share-fill block h-full origin-left rounded-full animate-grow"
            style={{ width: `${progress * 100}%`, "--d": ".3s" } as CSSProperties}
          />
        </span>
      </span>
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
        Zobacz sezon
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}
