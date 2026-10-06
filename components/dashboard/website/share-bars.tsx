import { Card } from "@tremor/react";

import { plPlural } from "@/lib/dashboard/story";
import { cn, formatNumberPL } from "@/lib/utils";

// Donuts made people squint at a legend and do mental maths; for "where do
// visitors come from / what do they use" a ranked bar with the % printed is
// read in one glance and survives a projector. Shared by the website widgets.

export interface ShareRow {
  key: string;
  label: string;
  /** One plain-language line under the label ("wpisali adres strony"). */
  hint?: string;
  value: number;
  /** Tailwind bg-* class for the bar (palette classes, no hex). */
  barClass: string;
}

/**
 * GA4 source/device/page breakdowns are a fixed 30-day snapshot, not the
 * range picked on the page. Pages with a range picker (Sprzedaż) label them
 * with this, or their counts appear to contradict the cards next to them.
 */
export const SNAPSHOT_30D_NOTE = "Ostatnie 30 dni - niezależnie od zakresu wybranego u góry";

/** "6 na 10" style fraction - easier to picture than "58,3%". */
export function outOfTen(share: number): string {
  const n = Math.round(share * 10);
  if (n < 1) return "mniej niż 1 na 10";
  if (n >= 10) return "prawie 10 na 10";
  return `${n} na 10`;
}

/**
 * Whole-number percentages that add up to exactly 100 (largest remainder).
 * Rounded one by one, 3 bars of 33.4/33.3/33.3 print "33% 33% 33%" and two
 * of 50.5/49.5 print "51% 50%" - a share card that doesn't sum to 100 makes
 * people doubt every other number on the page.
 */
export function sharesSumming100(values: number[]): number[] {
  const total = values.reduce((a, v) => a + v, 0);
  if (!(total > 0)) return values.map(() => 0);
  const raw = values.map((v) => (v / total) * 100);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((a, v) => a + v, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return out;
}

export function ShareBars({
  title,
  insight,
  rows,
  unit,
  keepOrder = false,
  emptyText,
  className,
  headingLevel = 2,
  periodNote,
}: {
  title: string;
  /** Data window, when it differs from the page's own period. */
  periodNote?: string;
  /** One-sentence takeaway shown above the bars. */
  insight?: string | null;
  rows: ShareRow[];
  unit: (n: number) => string;
  /** Keep the given order (age brackets read better young -> old). */
  keepOrder?: boolean;
  /** Why the card is empty and what happens next (defaults to a GA4 note). */
  emptyText?: string;
  className?: string;
  /** 3 when the card sits under a section heading (Sprzedaż, Odbiorcy). */
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const total = rows.reduce((a, r) => a + r.value, 0);
  const visible = rows.filter((r) => r.value > 0);
  const sorted = keepOrder ? visible : [...visible].sort((a, b) => b.value - a.value);
  const pcts = sharesSumming100(sorted.map((r) => r.value));

  return (
    <Card className={cn("flex flex-col", className)}>
      <Heading className="text-base font-semibold">{title}</Heading>
      {periodNote ? <p className="mt-0.5 text-xs text-muted-foreground">{periodNote}</p> : null}
      {insight ? <p className="mt-1 text-sm text-muted-foreground">{insight}</p> : null}
      <ul className="mt-5 space-y-4">
        {sorted.map((r, i) => {
          const share = total > 0 ? r.value / total : 0;
          return (
            <li key={r.key}>
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-sm font-medium">{r.label}</span>
                  {r.hint ? (
                    <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">
                      {r.hint}
                    </span>
                  ) : null}
                </div>
                <div className="shrink-0 text-right">
                  <span className="text-sm font-semibold tabular-nums">
                    {pcts[i]}%
                  </span>
                  <span className="ml-2 text-xs tabular-nums text-muted-foreground">
                    {unit(r.value)}
                  </span>
                </div>
              </div>
              {/* The % is printed above; the bar only repeats it visually. */}
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div
                  className={cn("h-full rounded-full transition-[width] duration-700 motion-reduce:transition-none", r.barClass)}
                  style={{ width: `${Math.max(share * 100, 1.5)}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      {sorted.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {emptyText ?? "Brak danych w tym okresie - pojawią się po najbliższej synchronizacji."}
        </p>
      ) : null}
    </Card>
  );
}

export const visitsUnit = (n: number) =>
  `${formatNumberPL(n)} ${plPlural(n, "wizyta", "wizyty", "wizyt")}`;
