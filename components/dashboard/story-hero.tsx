import {
  ArrowDownRight,
  ArrowUpRight,
  Eye,
  Hourglass,
  PartyPopper,
  Sparkles,
} from "lucide-react";

import type { Story, Tone } from "@/lib/dashboard/story";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<Tone, string> = {
  good: "text-emerald-700 dark:text-emerald-400",
  bad: "text-rose-600 dark:text-rose-400",
  flat: "text-muted-foreground",
};

/**
 * First thing on the overview: the period in one sentence, four big numbers
 * with words instead of acronyms, and the good news. Built to be read aloud
 * in a board meeting by someone who never opened Ads Manager.
 */
export function StoryHero({
  story,
  periodLabel,
}: {
  story: Story;
  periodLabel: string;
}) {
  return (
    <section
      aria-label="Najważniejsze w skrócie"
      className="relative overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/[0.07] via-card to-card p-5 shadow-sm sm:p-7"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl"
      />

      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-accent-foreground">
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        Najważniejsze w skrócie · {periodLabel}
      </p>
      <h2 className="mt-2 max-w-3xl text-balance text-xl font-semibold leading-snug tracking-tight sm:text-2xl">
        {story.headline}
      </h2>

      {story.facts.length === 0 && story.note ? (
        <p className="mt-3 flex max-w-2xl items-start gap-2 text-sm leading-relaxed text-muted-foreground">
          <Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          {story.note}
        </p>
      ) : null}

      <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-5 empty:hidden lg:grid-cols-4">
        {story.facts.map((f) => (
          // dt must come first for screen readers; CSS order keeps the big
          // number on top visually.
          <div key={f.key} className="flex min-w-0 flex-col">
            <dt className="order-2 mt-0.5 text-sm text-muted-foreground">{f.caption}</dt>
            <dd className="order-1 text-2xl font-bold tabular-nums tracking-tight sm:text-3xl">
              {f.value}
            </dd>
            {f.change ? (
              <dd
                className={cn(
                  "order-3 mt-1 flex items-start gap-1 text-xs font-medium",
                  TONE_CLASS[f.change.tone]
                )}
              >
                {f.change.tone !== "flat" ? (
                  (f.key === "cpc") === (f.change.tone === "good") ? (
                    <ArrowDownRight className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                  ) : (
                    <ArrowUpRight className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                  )
                ) : null}
                {f.change.text}
              </dd>
            ) : null}
          </div>
        ))}
      </dl>

      {story.wins.length > 0 || story.watch ? (
        <div className="mt-6 grid gap-3 border-t border-border/60 pt-5 md:grid-cols-[1fr_auto]">
          {story.wins.length > 0 ? (
            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <PartyPopper className="h-4 w-4 text-amber-500" aria-hidden />
                Dobre wiadomości
              </h3>
              <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {story.wins.map((w) => (
                  <li key={w} className="flex items-start gap-2 text-sm">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {story.watch ? (
            <p className="flex max-w-sm items-start gap-2 self-end rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              <Eye className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              {story.watch}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
