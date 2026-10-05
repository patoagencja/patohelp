import Link from "next/link";
import { Flag } from "lucide-react";

import type { EngagementGoal, GoalMetric } from "@/lib/dashboard/goals";
import { plPlural } from "@/lib/dashboard/story";
import { monthLabelPl, todayWarsaw } from "@/lib/ecom/insights";
import { cn, formatDateWarsaw, formatNumberPL } from "@/lib/utils";

// Friendly names (no "sesje", no "konwersje") + the genitive forms needed
// after "ok." in the status sentence: "ok. 1 wizyty", "ok. 300 wizyt".
const METRIC: Record<
  GoalMetric,
  { name: string; genOne: string; genMany: string }
> = {
  sessions: { name: "Wizyty na stronie", genOne: "wizyty", genMany: "wizyt" },
  clicks: { name: "Kliknięcia w reklamy", genOne: "kliknięcia", genMany: "kliknięć" },
  impressions: {
    name: "Wyświetlenia reklam",
    genOne: "wyświetlenia",
    genMany: "wyświetleń",
  },
  conversions: { name: "Działania na stronie", genOne: "działania", genMany: "działań" },
};

const TONE = {
  good: { dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" },
  neutral: { dot: "bg-sky-500", text: "text-foreground" },
  warn: { dot: "bg-amber-500", text: "text-amber-800 dark:text-amber-400" },
  muted: { dot: "bg-muted-foreground/40", text: "text-muted-foreground" },
} as const;

/** Round "about" figures so a forecast never pretends to single-unit precision. */
function about(n: number): number {
  const a = Math.abs(n);
  const step = a >= 1_000_000 ? 10_000 : a >= 100_000 ? 1_000 : a >= 1_000 ? 100 : a >= 100 ? 10 : 1;
  return Math.round(n / step) * step;
}

function aboutCount(n: number, metric: GoalMetric): string {
  const v = Math.max(1, about(n));
  const m = METRIC[metric];
  return `ok. ${formatNumberPL(v)} ${v === 1 ? m.genOne : m.genMany}`;
}

const pctOf = (ratio: number) => `${Math.round(ratio * 100)}%`;

/** One plain sentence per goal - what a client would ask: "will we make it?" */
function statusLine(g: EngagementGoal): { text: string; tone: keyof typeof TONE } {
  if (g.achievedOn) {
    return {
      text: `Cel osiągnięty 🎉 ${formatDateWarsaw(`${g.achievedOn}T12:00:00Z`, "d MMMM")}`,
      tone: "good",
    };
  }
  if (g.forecast === null || g.forecastPct === null) {
    return {
      text: "Za mało danych z ostatnich dni, żeby uczciwie przewidzieć wynik.",
      tone: "muted",
    };
  }
  if (g.status === "ahead") {
    return {
      text: `Idziemy przed planem - w tym tempie ok. ${pctOf(g.forecastPct - 1)} ponad cel.`,
      tone: "good",
    };
  }
  if (g.forecastPct >= 1) {
    return { text: "Idziemy zgodnie z planem.", tone: "good" };
  }
  // Short of the target: say how much more per day it takes, in units the
  // client recognises, rather than a percentage of a forecast.
  const gap =
    g.requiredDaily !== null && g.recentDailyAvg !== null
      ? g.requiredDaily - g.recentDailyAvg
      : null;
  if (gap === null || gap <= 0) {
    return { text: "Idziemy zgodnie z planem.", tone: "good" };
  }
  if (g.status === "on_track") {
    return {
      text: `Jesteśmy blisko - brakuje ${aboutCount(gap, g.metric)} dziennie, żeby dowieźć cel.`,
      tone: "neutral",
    };
  }
  return {
    text: `Brakuje ${aboutCount(gap, g.metric)} dziennie, żeby dowieźć cel.`,
    tone: "warn",
  };
}

function GoalRow({ goal: g }: { goal: EngagementGoal }) {
  const status = statusLine(g);
  const done = g.achievedOn !== null;
  // Once achieved the forecast is hidden, so it must not stretch the scale
  // either - the bar should read "full, past the marker".
  const scale = Math.max(g.target, done ? 0 : (g.forecast ?? 0), g.actual, 1);
  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;

  return (
    <li className="min-w-0 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="text-sm font-medium">{METRIC[g.metric].name}</p>
        <p className="text-xs tabular-nums text-muted-foreground">
          <span className="font-semibold text-foreground">{formatNumberPL(g.actual)}</span> z{" "}
          {formatNumberPL(g.target)}
          {g.forecast !== null && g.forecastPct !== null && !done ? (
            <>
              {" "}
              · prognoza ok. {formatNumberPL(about(g.forecast))} ({pctOf(g.forecastPct)})
            </>
          ) : null}
          {done ? <> · {pctOf(g.progressPct)} celu</> : null}
        </p>
      </div>

      {/* Actual (solid) vs forecast (ghost) against the goal marker. */}
      <div
        className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${formatNumberPL(g.actual)} z ${formatNumberPL(g.target)}`}
      >
        {g.forecast !== null && !done ? (
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary/25"
            style={{ width: pct(g.forecast) }}
          />
        ) : null}
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-all duration-700",
            done ? "bg-emerald-500" : "bg-primary"
          )}
          style={{ width: pct(g.actual) }}
        />
        <div
          className="absolute inset-y-0 w-0.5 bg-foreground/70"
          // Clamp so a marker at 100% isn't clipped by the rounded track.
          style={{ left: `min(calc(${pct(g.target)} - 1px), calc(100% - 3px))` }}
          title="Cel"
        />
      </div>

      <p className={cn("mt-2 flex items-start gap-2 text-sm", TONE[status.tone].text)}>
        <span
          aria-hidden
          className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", TONE[status.tone].dot)}
        />
        <span className="min-w-0">{status.text}</span>
      </p>
    </li>
  );
}

/**
 * "Cele na październik" for engagement clients: month to date against each
 * goal, with an honest end-of-month forecast (recent 7-day pace × days left).
 * Renders nothing for clients without goals; agency users get a nudge to set
 * them instead.
 */
export function GoalsCard({
  goals,
  clientSlug,
  isAgency,
  monthName,
}: {
  goals: EngagementGoal[];
  clientSlug: string;
  isAgency: boolean;
  /** Empty-state month name; defaults to the current Warsaw month. */
  monthName?: string;
}) {
  if (goals.length === 0) {
    if (!isAgency) return null;
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-card px-5 py-4 text-sm">
        <p className="flex items-center gap-2 text-muted-foreground">
          <Flag className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          Brak celów na{" "}
          {monthName ?? monthLabelPl(`${todayWarsaw().slice(0, 7)}-01`).split(" ")[0]} -
          pokażemy postęp i prognozę, gdy je ustawisz.
        </p>
        <Link
          href={`/${clientSlug}/settings#cele`}
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          Ustaw cele
        </Link>
      </section>
    );
  }

  const shown = goals.slice(0, 4);
  const first = shown[0];

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-base font-semibold">
          <Flag className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          Cele na {first.monthName}
        </h2>
        {isAgency ? (
          <Link
            href={`/${clientSlug}/settings#cele`}
            className="text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            Zmień cele
          </Link>
        ) : null}
      </div>

      <ul className="mt-4 divide-y divide-border">
        {shown.map((g) => (
          <GoalRow key={g.metric} goal={g} />
        ))}
      </ul>

      {/* Say how the forecast is made, so a client can trust (or question) it. */}
      <p className="mt-4 text-xs tabular-nums text-muted-foreground">
        {first.completeDays}{" "}
        {plPlural(first.completeDays, "pełny dzień", "pełne dni", "pełnych dni")} z{" "}
        {first.daysInMonth} za nami. Prognoza = wynik do wczoraj + średnia z ostatnich 7 dni ×
        pozostałe dni.
      </p>
    </section>
  );
}
