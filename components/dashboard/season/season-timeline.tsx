import type { CSSProperties } from "react";

import { dayMonthLong, daysWord, diffDaysIso, type SeasonState } from "@/lib/season/config";
import { cn } from "@/lib/utils";

/**
 * The season as one bar: how far in we are, where the big moments sit and
 * how many days are left until each. The countdown is what a gift business
 * plans around ("do Mikołajek 59 dni"), so it gets the words, not a number
 * buried in a chart.
 */
export function SeasonTimeline({
  state,
  today,
  moments,
}: {
  state: SeasonState;
  today: string;
  moments: Array<{ key: string; label: string; short: string; date: string; i: number }>;
}) {
  const { current, phase, totalDays } = state;
  const running = phase === "in";
  const progress = running ? Math.min(1, ((state.day ?? 0) - 0.5) / totalDays) : 1;
  const upcoming = running ? moments.filter((m) => m.date >= today).slice(0, 3) : [];
  const daysLeft = running ? diffDaysIso(today, current.end) : 0;

  return (
    <div className="glass rounded-card p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <p className="text-[15px] text-ink-2">
          {running ? (
            <>
              <b className="font-semibold text-foreground">
                Dzień {state.day} z {totalDays}
              </b>{" "}
              · do końca sezonu {daysLeft} {daysWord(daysLeft)} ({dayMonthLong(current.end)})
            </>
          ) : phase === "pre" && state.next ? (
            <>
              <b className="font-semibold text-foreground">
                Sezon {state.next.year} startuje za {state.daysToNext} {daysWord(state.daysToNext ?? 0)}
              </b>{" "}
              ({dayMonthLong(state.next.start)}) · poniżej podsumowanie sezonu {current.year}
            </>
          ) : (
            <>
              <b className="font-semibold text-foreground">Sezon {current.year} zakończony</b>
              {state.next ? (
                <>
                  {" "}
                  · kolejny za {state.daysToNext} {daysWord(state.daysToNext ?? 0)} (
                  {dayMonthLong(state.next.start)})
                </>
              ) : null}
            </>
          )}
        </p>
        {upcoming.length ? (
          <ul className="flex flex-wrap gap-2">
            {upcoming.map((m) => {
              const d = diffDaysIso(today, m.date);
              return (
                <li
                  key={m.key}
                  className="rounded-full bg-chip px-3 py-1 text-[13px] text-ink-2 tabular-nums"
                >
                  {m.label}:{" "}
                  <b className="font-semibold text-foreground">
                    {d === 0 ? "dziś" : `za ${d} ${daysWord(d)}`}
                  </b>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {/* The bar and its tags are decoration for sighted users; one plain
          sentence says the same to a screen reader. */}
      <p className="sr-only">
        {running
          ? `Minęło ${state.day} z ${totalDays} dni sezonu.`
          : `Pasek pokazuje cały sezon ${current.year}.`}{" "}
        {moments.length
          ? `Ważne dni: ${moments.map((m) => `${m.label} ${dayMonthLong(m.date)}`).join(", ")}.`
          : ""}
      </p>
      {!running ? (
        <p aria-hidden className="mt-4 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
          Sezon {current.year}
        </p>
      ) : null}
      <div aria-hidden className="relative mt-5 pb-7">
        <div aria-hidden className="h-3 overflow-hidden rounded-full bg-chip">
          <div
            className="share-fill h-full origin-left rounded-full animate-grow"
            style={{ width: `${progress * 100}%`, "--d": ".3s" } as CSSProperties}
          />
        </div>
        {moments.map((m, k) => {
          const left = ((m.i + 0.5) / totalDays) * 100;
          const past = m.date < today;
          // Black Friday and Cyber Monday are 3 days apart: on a phone their
          // tags would print over each other. Tag only moments with room.
          const labelled =
            k === 0 || (m.i - moments[k - 1].i) / totalDays >= 0.06;
          return (
            <span
              key={m.key}
              className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
              style={{ left: `${left}%` }}
            >
              <span
                aria-hidden
                className={cn(
                  "h-3 w-[3px] rounded-full",
                  past ? "bg-card/80" : "bg-[var(--ink-3)]"
                )}
              />
              <span
                className={cn(
                  "mt-1.5 whitespace-nowrap font-mono text-[10.5px] tracking-[0.04em]",
                  past ? "text-ink-3" : "text-ink-2",
                  !labelled && "sr-only"
                )}
                title={`${m.label} - ${dayMonthLong(m.date)}`}
              >
                {m.short}
              </span>
            </span>
          );
        })}
        <span className="absolute left-0 top-5 font-mono text-[10.5px] text-ink-3">
          {dayMonthLong(current.start)}
        </span>
        {/* A moment on the last days (Wigilia) already labels the end. */}
        {moments.some((m) => m.i >= totalDays - 4) ? null : (
          <span className="absolute right-0 top-5 font-mono text-[10.5px] text-ink-3">
            {dayMonthLong(current.end)}
          </span>
        )}
      </div>
    </div>
  );
}
