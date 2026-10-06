import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Hourglass,
  Loader2,
  PartyPopper,
  Eye,
} from "lucide-react";

import { OverviewAiCard } from "@/components/dashboard/overview-ai-card";
import { CountUp } from "@/components/ui/count-up";
import { StatusChip, type PingTone } from "@/components/ui/primitives";
import type { Anomaly } from "@/lib/alerts/anomalies";
import type { HeroFigures } from "@/lib/dashboard/hero";
import type { AiSummary } from "@/lib/dashboard/overview";
import type { OverviewStatus, Story } from "@/lib/dashboard/story";
import { cn, formatDateWarsaw, formatNumberPL } from "@/lib/utils";

/** "2026-09-29" -> "29.09" (period dates are already Warsaw days). */
const ddmm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

const STATUS_PING: Record<OverviewStatus["tone"], PingTone> = {
  good: "live",
  warn: "amber",
  bad: "coral",
  neutral: "muted",
};

/** The overview's single health signal: a chip with a ping dot + words. */
export function StatusPill({ status }: { status: OverviewStatus | null }) {
  if (!status) {
    // Alerts are still streaming in: say so instead of guessing "all good".
    return (
      <span className="inline-flex min-h-[38px] items-center gap-2.5 rounded-full bg-chip pl-3 pr-4 text-sm font-medium text-ink-2">
        <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden />
        Sprawdzamy wyniki…
      </span>
    );
  }
  return <StatusChip tone={STATUS_PING[status.tone]}>{status.text}</StatusChip>;
}

/** Alerts worth a look (FYI-level ones stay on the Alerty page). */
export function attentionOf(alerts: Anomaly[]): { attention: number; urgent: boolean } {
  const worth = alerts.filter((a) => a.severity !== "medium");
  return {
    attention: worth.length,
    urgent: worth.some((a) => a.severity === "critical"),
  };
}

/**
 * One line, only when there is something to check: the most important open
 * alert and a link to the full list. No "Brak alertów" box when all is well -
 * the status pill already says so.
 */
export function AlertLine({ alerts, href }: { alerts: Anomaly[]; href: string }) {
  const worth = alerts.filter((a) => a.severity !== "medium");
  if (worth.length === 0) return null;
  const top = worth.find((a) => a.severity === "critical") ?? worth[0];
  const more = worth.length - 1;
  const urgent = top.severity === "critical";
  return (
    <Link
      href={href}
      className={cn(
        "group flex min-h-14 items-center gap-3 rounded-[20px] py-2 pl-3.5 pr-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        urgent
          ? "bg-negative-soft hover:bg-negative-soft/70"
          : "bg-warning-soft hover:bg-warning-soft/70"
      )}
    >
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-card shadow-sm",
          urgent ? "text-negative" : "text-warning"
        )}
      >
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="sr-only">Do sprawdzenia: </span>
        <span className="font-medium text-foreground">{top.title}</span>
        <span className="text-muted-foreground"> · {top.scopeLabel}</span>
        {more > 0 ? (
          <span className="text-muted-foreground"> · i jeszcze {more}</span>
        ) : null}
      </span>
      <span className="flex min-h-10 shrink-0 items-center gap-1 rounded-full bg-card px-3.5 text-[13px] font-medium text-foreground shadow-sm transition-colors group-hover:bg-anchor group-hover:text-anchor-foreground">
        <span className="hidden sm:inline">Zobacz</span>
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </span>
    </Link>
  );
}

/** The weekly AI comment's text + meta line for <OverviewAiCard>. */
export function aiSummaryForCard(aiSummary?: AiSummary | null): { text: string; meta: string } | null {
  if (!aiSummary) return null;
  return {
    text: aiSummary.summaryText.replace(/[–—]/g, "-"),
    // Its own fixed 7-day window, not the range above - say which days, or
    // its numbers look like they contradict the tiles.
    meta: `Komentarz tygodnia${
      aiSummary.periodStart && aiSummary.periodEnd
        ? ` · ${ddmm(aiSummary.periodStart)}–${ddmm(aiSummary.periodEnd)}`
        : ""
    } · ${formatDateWarsaw(aiSummary.generatedAt, "d MMM")}`,
  };
}

/**
 * The overview hero (Przeglad-pastel): left - mono kicker + status chip,
 * the giant light-weight number (spend; revenue for shops) and one sentence
 * with the figures that explain it, the date range; right - the glass AI
 * card. Keep aria-label: the guided tour points at this section.
 */
export function OverviewSummary({
  story,
  periodLabel,
  aiSummary,
  status,
  alert,
  hero,
  kicker,
  range,
  ai,
}: {
  story: Story;
  periodLabel: string;
  aiSummary?: AiSummary | null;
  /** <StatusPill> - a slot so the page can stream it in with the alerts. */
  status: React.ReactNode;
  /** <AlertLine> (streamed); renders nothing when there are no alerts. */
  alert?: React.ReactNode;
  /** The giant number + sentence (lib/dashboard/hero.ts). */
  hero?: HeroFigures | null;
  /** Mono line above: "Październik 2026 · ostatnie 30 dni". */
  kicker?: string;
  /** Date range control (segmented) or the demo's period label. */
  range?: React.ReactNode;
  /** The AI card; defaults to the weekly comment without quick answers. */
  ai?: React.ReactNode;
}) {
  return (
    <section
      aria-label="Najważniejsze w skrócie"
      // The period is in the kicker; screen readers get it here too.
      aria-description={periodLabel}
      className="flex flex-wrap items-stretch gap-7 pt-2 md:pt-6"
    >
      <div className="flex min-w-0 flex-[1.25_1_32rem] flex-col justify-between gap-[22px]">
        <div className="flex flex-col gap-5">
          <div
            className="flex flex-wrap items-center gap-3 animate-rise"
            style={{ "--d": ".1s" } as React.CSSProperties}
          >
            {kicker ? <span className="kick">{kicker}</span> : null}
            {status}
          </div>

          {hero ? (
            <>
              <p
                className="num-grad text-[clamp(3.5rem,8.4vw,8rem)] font-light leading-[0.88] tracking-[-0.055em] tabular-nums animate-rise"
                style={{ "--d": ".2s" } as React.CSSProperties}
              >
                <span className="sr-only">{hero.label}</span>
                <span aria-hidden>
                  <CountUp text={formatNumberPL(hero.value)} />
                  {hero.unit ? (
                    <small className="ml-[0.12em] text-[0.36em] tracking-[-0.03em]">{hero.unit}</small>
                  ) : null}
                </span>
              </p>
              <p
                aria-hidden
                className="m-0 max-w-[40rem] text-balance text-[1.375rem] font-normal leading-[1.25] tracking-[-0.03em] text-ink-3 animate-rise sm:text-[1.625rem] lg:text-[1.875rem]"
                style={{ "--d": ".35s" } as React.CSSProperties}
              >
                {hero.parts.map((p, i) =>
                  typeof p === "string" ? (
                    p
                  ) : (
                    <span key={i} className="whitespace-nowrap font-medium text-foreground">
                      {p.hl}
                    </span>
                  )
                )}
              </p>
            </>
          ) : (
            <p className="max-w-3xl text-balance text-[1.625rem] font-normal leading-snug tracking-[-0.03em] text-ink-3">
              {story.headline}
            </p>
          )}

          {story.facts.length === 0 && story.note ? (
            // No data yet (first sync pending): a calm empty-state panel, not
            // a row of zeros.
            <div className="flex max-w-2xl items-start gap-3 rounded-[22px] bg-chip p-4 sm:items-center">
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card text-muted-foreground shadow-card"
              >
                <Hourglass className="h-4 w-4" />
              </span>
              <p className="text-sm leading-relaxed text-muted-foreground">{story.note}</p>
            </div>
          ) : null}
        </div>

        {range || alert ? (
          <div
            className="flex flex-col items-start gap-4 animate-rise"
            style={{ "--d": ".5s" } as React.CSSProperties}
          >
            {range ? <div className="max-w-full">{range}</div> : null}
            {alert ? <div className="w-full empty:hidden">{alert}</div> : null}
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-[1_1_25rem]">
        {ai ?? <OverviewAiCard summary={aiSummaryForCard(aiSummary)} questions={[]} className="w-full" />}
      </div>
    </section>
  );
}

/** "Dobre wiadomości" for the details layer - the wins the numbers hide. */
export function GoodNews({ story }: { story: Story }) {
  if (story.wins.length === 0 && !story.watch) return null;
  return (
    <section className="glass rounded-glass p-6 sm:p-7">
      <h2 className="flex items-center gap-2 text-[22px] font-medium tracking-[-0.03em]">
        <PartyPopper className="h-4 w-4 text-muted-foreground" aria-hidden />
        Dobre wiadomości
      </h2>
      {story.wins.length > 0 ? (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {story.wins.map((w) => (
            <li key={w} className="flex items-start gap-2 text-sm">
              <span
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-lime ring-2 ring-lime-soft"
                aria-hidden
              />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {story.watch ? (
        <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
          <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {story.watch}
        </p>
      ) : null}
    </section>
  );
}
