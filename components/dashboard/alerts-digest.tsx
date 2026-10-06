import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";

import { explainAlert } from "@/components/dashboard/alert-explained";
import { Ping, type PingTone } from "@/components/ui/primitives";
import type { Anomaly } from "@/lib/alerts/anomalies";

type Lang = "pl" | "en";

// Plain words instead of "Krytyczny/Wysoki/Średni" - a board member should
// know at a glance whether something needs action today or is just FYI.
const SEVERITY_LABEL: Record<Lang, Record<Anomaly["severity"], string>> = {
  pl: { critical: "Pilne", high: "Ważne", medium: "Informacja" },
  en: { critical: "Urgent", high: "Important", medium: "FYI" },
};

const SEVERITY_PING: Record<Anomaly["severity"], PingTone> = {
  critical: "coral",
  high: "amber",
  medium: "muted",
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

  // 2026 pastel: a glass section with the mono kicker + title, rows with
  // ping dots (only urgent ones pulse) and a chip pill with the words.
  return (
    <section className="glass rounded-glass p-6 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="kick">{lang === "en" ? "Alerts" : "Alerty"}</p>
          <h2 className="mt-2 text-[22px] font-medium tracking-[-0.03em]">{t.title}</h2>
          <p className="mt-1 text-sm text-ink-3">{t.intro}</p>
        </div>
        {!linkless ? (
          <Link
            href={`/${clientSlug}/alerty`}
            className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-chip pl-4 pr-3.5 text-sm font-medium text-foreground transition-colors hover:bg-anchor hover:text-anchor-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t.all}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        ) : null}
      </div>

      {top.length === 0 ? (
        <p className="mt-5 flex items-center gap-2.5 rounded-[18px] bg-chip p-4 text-sm text-ink-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-positive" aria-hidden />
          {t.empty}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {top.map((a, i) => {
            // A pulsing red "Pilne" with no next step read as "panic"; the
            // Alerty tab's calm "Co z tym robimy" line belongs right here.
            const x = explainAlert(a, lang);
            const body = (
              <>
                {/* Only urgent items pulse - draws the eye without making the
                    whole list feel alarming. */}
                <Ping tone={SEVERITY_PING[a.severity]} still={a.severity !== "critical"} className="mt-2" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium leading-snug group-hover:underline">
                    {a.title}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] text-ink-3">{a.scopeLabel}</span>
                  <span className="mt-1.5 block text-[13px] leading-snug text-ink-2">
                    <span className="font-medium text-foreground">{t.doing}</span> {x.action}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-chip px-3 py-1 text-xs font-medium text-ink-2">
                  {SEVERITY_LABEL[lang][a.severity]}
                </span>
              </>
            );
            const cls =
              "group flex items-start gap-3.5 rounded-2xl py-3.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
            return (
              <li
                key={a.id}
                className="animate-rise"
                style={{ "--d": `${0.1 + i * 0.07}s` } as React.CSSProperties}
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
    </section>
  );
}
