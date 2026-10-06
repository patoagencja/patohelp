import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CircleCheck,
  CircleMinus,
  Hourglass,
  Loader2,
  PartyPopper,
  Eye,
} from "lucide-react";

import { AiComment } from "@/components/dashboard/overview-ai-comment";
import { Pill } from "@/components/ui/pill";
import type { Anomaly } from "@/lib/alerts/anomalies";
import type { AiSummary } from "@/lib/dashboard/overview";
import type { OverviewStatus, Story } from "@/lib/dashboard/story";
import { cn, formatDateWarsaw } from "@/lib/utils";

/** "2026-09-29" -> "29.09" (period dates are already Warsaw days). */
const ddmm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

const STATUS_TONE = {
  good: "positive",
  warn: "warning",
  bad: "negative",
  neutral: "neutral",
} as const;

const STATUS_ICON = {
  good: CircleCheck,
  warn: AlertTriangle,
  bad: AlertTriangle,
  neutral: CircleMinus,
} as const;

/** The overview's single health signal. */
export function StatusPill({ status }: { status: OverviewStatus | null }) {
  if (!status) {
    // Alerts are still streaming in: say so instead of guessing "all good".
    return (
      <Pill tone="neutral" className="px-3 py-1 text-sm">
        <Loader2 className="motion-safe:animate-spin" aria-hidden />
        Sprawdzamy wyniki…
      </Pill>
    );
  }
  const Icon = STATUS_ICON[status.tone];
  return (
    <Pill
      tone={STATUS_TONE[status.tone]}
      className="px-3 py-1 text-sm font-semibold [&_svg]:size-4"
    >
      <Icon aria-hidden />
      {status.text}
    </Pill>
  );
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
        "group mt-3 flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-4",
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
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-card px-3 py-1 text-[13px] font-medium text-foreground shadow-sm transition-colors group-hover:bg-anchor group-hover:text-anchor-foreground">
        <span className="hidden sm:inline">Zobacz</span>
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </span>
    </Link>
  );
}

// Numbers (with their unit) in the headline get full weight; the words
// around them step back a little - the eye lands on the figures first.
const FIGURE = /(\d[\d\u00a0\u202f ]*(?:[.,]\d+)?(?:\s?(?:zł|%|tys\.|mln))?)/g;

function Headline({ text }: { text: string }) {
  return (
    <>
      {text.split(FIGURE).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="whitespace-nowrap text-foreground">
            {part}
          </span>
        ) : (
          part
        )
      )}
    </>
  );
}

/**
 * First block of the overview: the period in one plain sentence, ONE status
 * pill and the agency's weekly AI comment folded to two lines. The numbers
 * live in the KPI tiles right below, so this block never repeats them.
 * Keep aria-label: the guided tour points at it.
 */
export function OverviewSummary({
  story,
  periodLabel,
  aiSummary,
  status,
  alert,
}: {
  story: Story;
  periodLabel: string;
  aiSummary?: AiSummary | null;
  /** <StatusPill> - a slot so the page can stream it in with the alerts. */
  status: React.ReactNode;
  /** <AlertLine> (streamed); renders nothing when there are no alerts. */
  alert?: React.ReactNode;
}) {
  return (
    <section
      aria-label="Najważniejsze w skrócie"
      // The period sits in the page header; screen readers get it here.
      aria-description={periodLabel}
      className="surface p-5 sm:p-7"
    >
      <div className="flex flex-wrap items-center gap-2">{status}</div>
      <p className="mt-4 max-w-4xl text-balance text-[1.375rem] font-semibold leading-snug tracking-[-0.02em] text-foreground/70 lg:text-[1.75rem] lg:leading-[1.25]">
        <Headline text={story.headline} />
      </p>

      {story.facts.length === 0 && story.note ? (
        <p className="mt-3 flex max-w-2xl items-start gap-2 text-sm leading-relaxed text-muted-foreground">
          <Hourglass className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {story.note}
        </p>
      ) : null}

      {aiSummary ? (
        <div className="mt-5">
          <AiComment
            text={aiSummary.summaryText.replace(/[–—]/g, "-")}
            // Its own fixed 7-day window, not the range above - say which
            // days, or its numbers look like they contradict the tiles.
            meta={`Komentarz tygodnia${
              aiSummary.periodStart && aiSummary.periodEnd
                ? ` · ${ddmm(aiSummary.periodStart)}–${ddmm(aiSummary.periodEnd)}`
                : ""
            } · ${formatDateWarsaw(aiSummary.generatedAt, "d MMM")}`}
          />
        </div>
      ) : null}

      {alert}
    </section>
  );
}

/** "Dobre wiadomości" for the details layer - the wins the numbers hide. */
export function GoodNews({ story }: { story: Story }) {
  if (story.wins.length === 0 && !story.watch) return null;
  return (
    <section className="surface p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold">
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
