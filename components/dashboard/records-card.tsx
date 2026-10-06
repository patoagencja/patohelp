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
    <section className="glass overflow-hidden rounded-glass">
      <div className="flex items-center gap-3.5 px-6 pt-6 sm:px-7 sm:pt-7">
        {/* Celebrations wear the signature lime (v2), never the amber that
            means "behind plan" elsewhere. */}
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-lime text-lime-foreground shadow-lime-glow">
          <Trophy className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <div>
          <p className="kick">Warte pokazania zarządowi</p>
          <h2 className="mt-1.5 text-[22px] font-medium tracking-[-0.03em]">Rekordy i kamienie milowe</h2>
        </div>
      </div>

      {/* Phones: one swipeable row instead of four tall stacked tiles (that
          stack alone was most of a screen); sm+ is the usual grid. */}
      <ul
        className={cn(
          "flex snap-x snap-mandatory gap-3 overflow-x-auto px-6 pb-6 pt-5 sm:grid sm:gap-4 sm:overflow-visible sm:px-7 sm:pb-7",
          COLS[items.length]
        )}
      >
        {items.map((r) => {
          const Icon = ICONS[r.icon] ?? Trophy;
          return (
            <li
              key={r.id}
              className={cn(
                "group relative flex shrink-0 snap-start flex-col overflow-hidden rounded-[22px] bg-chip p-[18px] sm:w-auto",
                items.length > 1 ? "w-[80%]" : "w-full"
              )}
            >
              <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-lime-soft text-accent-foreground">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <p className="relative mt-3 text-[15px] font-medium leading-snug tracking-[-0.01em] text-foreground">
                {r.title}
              </p>
              <p className="relative mt-1.5 text-[13px] leading-relaxed text-ink-2">
                {r.detail}
              </p>
              {r.achievedOn ? (
                <p className="relative mt-auto pt-3 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-3">
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
