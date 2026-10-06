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

/** "6 na 10" style fraction - easier to picture than "58,3%". */
export function outOfTen(share: number): string {
  const n = Math.round(share * 10);
  if (n < 1) return "mniej niż 1 na 10";
  if (n >= 10) return "prawie 10 na 10";
  return `${n} na 10`;
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
}: {
  title: string;
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

  return (
    <Card className={cn("flex flex-col", className)}>
      <Heading className="text-base font-semibold">{title}</Heading>
      {insight ? <p className="mt-1 text-sm text-muted-foreground">{insight}</p> : null}
      <ul className="mt-5 space-y-4">
        {sorted.map((r) => {
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
                    {Math.round(share * 100)}%
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
