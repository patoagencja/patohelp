import { Flag, Sparkles, TrendingUp, Trophy, type LucideIcon } from "lucide-react";

import type { RecordIcon, RecordItem } from "@/lib/dashboard/records";
import { cn } from "@/lib/utils";

const ICONS: Record<RecordIcon, LucideIcon> = {
  trophy: Trophy,
  flag: Flag,
  sparkles: Sparkles,
  trending: TrendingUp,
};

// Full class strings (not interpolated) so Tailwind's scanner keeps them; the
// grid never leaves empty columns when there are fewer than four wins.
const COLS: Record<number, string> = {
  1: "",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

const MONTHS_GEN = [
  "stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca",
  "lipca", "sierpnia", "września", "października", "listopada", "grudnia",
];

/** yyyy-MM-dd is already a Warsaw-local day, so format the parts directly. */
function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS_GEN[m - 1]} ${y}`;
}

/**
 * Celebratory strip of records and milestones ("najlepszy tydzień",
 * "1 mln wyświetleń") - the numbers a marketing manager can take straight to
 * their board. Renders nothing when there is nothing honest to celebrate.
 */
export function RecordsCard({ records }: { records: RecordItem[] }) {
  if (!records.length) return null;
  const items = records.slice(0, 4);

  return (
    <section className="surface overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/15">
          <Trophy className="h-5 w-5 text-amber-700 dark:text-amber-400" aria-hidden />
        </span>
        <div>
          <h2 className="text-base font-semibold">Rekordy i kamienie milowe</h2>
          <p className="text-xs text-muted-foreground">
            Policzone na Twoich danych - warte pokazania zarządowi
          </p>
        </div>
      </div>

      {/* Phones: one swipeable row instead of four tall stacked tiles (that
          stack alone was most of a screen); sm+ is the usual grid. */}
      <ul
        className={cn(
          "flex snap-x snap-mandatory gap-3 overflow-x-auto p-4 sm:grid sm:overflow-visible sm:p-5",
          COLS[items.length]
        )}
      >
        {items.map((r) => {
          const Icon = ICONS[r.icon] ?? Trophy;
          return (
            <li
              key={r.id}
              className={cn(
                "group relative flex shrink-0 snap-start flex-col overflow-hidden rounded-lg border border-border bg-card p-4 sm:w-auto",
                items.length > 1 ? "w-[80%]" : "w-full"
              )}
            >
              <span className="relative flex h-8 w-8 items-center justify-center rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <p className="relative mt-3 text-sm font-semibold leading-snug text-foreground">
                {r.title}
              </p>
              <p className="relative mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {r.detail}
              </p>
              {r.achievedOn ? (
                <p className="relative mt-auto pt-3 text-[11px] font-medium uppercase tracking-wide text-amber-800 dark:text-amber-400">
                  {dayLabel(r.achievedOn)}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
