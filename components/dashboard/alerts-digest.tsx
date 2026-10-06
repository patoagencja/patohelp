import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";

import { explainAlert } from "@/components/dashboard/alert-explained";
import type { Anomaly } from "@/lib/alerts/anomalies";
import { cn } from "@/lib/utils";

type Lang = "pl" | "en";

const SEVERITY_DOT: Record<Anomaly["severity"], string> = {
  critical: "bg-red-600",
  high: "bg-amber-500",
  medium: "bg-sky-500",
};

// Plain words instead of "Krytyczny/Wysoki/Średni" - a board member should
// know at a glance whether something needs action today or is just FYI.
const SEVERITY_LABEL: Record<Lang, Record<Anomaly["severity"], string>> = {
  pl: { critical: "Pilne", high: "Ważne", medium: "Informacja" },
  en: { critical: "Urgent", high: "Important", medium: "FYI" },
};

const SEVERITY_PILL: Record<Anomaly["severity"], string> = {
  critical: "bg-red-500/10 text-red-700 dark:text-red-400",
  high: "bg-amber-500/15 text-amber-800 dark:text-amber-400",
  medium: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
};

const COPY = {
  pl: {
    title: "Najważniejsze alerty",
    intro: "Rzeczy, którym się przyglądamy - przy każdej piszemy, co z tym robimy.",
    doing: "Co robimy:",
    all: "Wszystkie alerty",
    empty: "Wszystko w normie - wyniki zgodne z ostatnimi 2 tygodniami.",
  },
  en: {
    title: "Top alerts",
    intro: "Things we're keeping an eye on - each says what we're doing about it.",
    doing: "What we're doing:",
    all: "All alerts",
    empty: "All clear - results are in line with the last 2 weeks.",
  },
} as const;

/**
 * Compact "most important alerts" module for the overview - a sibling of the
 * monthly-budget bar (same card style). Shows the top few live anomalies and
 * links to the full Alerty tab.
 */
export function AlertsDigest({
  alerts,
  clientSlug,
  linkless = false,
  lang = "pl",
}: {
  alerts: Anomaly[];
  clientSlug: string;
  linkless?: boolean;
  lang?: Lang;
}) {
  const t = COPY[lang];
  const top = alerts.slice(0, 4);

  return (
    <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <AlertTriangle
              className={cn(
                "h-4 w-4 shrink-0",
                top.length > 0 ? "text-amber-500" : "text-muted-foreground"
              )}
              aria-hidden
            />
            {t.title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t.intro}</p>
        </div>
        {!linkless ? (
          <Link
            href={`/${clientSlug}/alerty`}
            className="flex shrink-0 items-center gap-1 rounded-sm pt-0.5 text-sm font-medium text-primary dark:text-indigo-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t.all}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        ) : null}
      </div>

      {top.length === 0 ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
          {t.empty}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border/60">
          {top.map((a, i) => {
            // A pulsing red "Pilne" with no next step read as "panic"; the
            // Alerty tab's calm "Co z tym robimy" line belongs right here.
            const x = explainAlert(a, lang);
            const body = (
              <>
                {/* Only urgent items pulse - draws the eye without making the
                    whole list feel alarming. */}
                <span className="relative mt-1.5 flex h-2 w-2 shrink-0">
                  {a.severity === "critical" ? (
                    <span
                      className={cn(
                        "absolute inline-flex h-full w-full rounded-full opacity-75 motion-safe:animate-ping",
                        SEVERITY_DOT[a.severity]
                      )}
                    />
                  ) : null}
                  <span
                    className={cn(
                      "relative inline-flex h-2 w-2 rounded-full",
                      SEVERITY_DOT[a.severity]
                    )}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium leading-snug group-hover:underline">
                    {a.title}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {a.scopeLabel}
                  </span>
                  <span className="mt-1 block text-xs leading-snug text-muted-foreground">
                    <span className="font-medium text-foreground/80">{t.doing}</span>{" "}
                    {x.action}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium",
                    SEVERITY_PILL[a.severity]
                  )}
                >
                  {SEVERITY_LABEL[lang][a.severity]}
                </span>
              </>
            );
            const cls = "group flex items-start gap-3 rounded-md py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
            return (
              <li
                key={a.id}
                className="motion-safe:animate-[rise-in_0.4s_ease-out_both]"
                style={{ animationDelay: `${i * 70}ms` }}
              >
                {linkless ? (
                  <div className={cls}>{body}</div>
                ) : (
                  <Link href={`/${clientSlug}/alerty`} className={cls}>
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
