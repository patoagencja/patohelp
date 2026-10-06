import type { CSSProperties, ReactNode } from "react";

import { Card } from "@/components/ui/card";

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
  /**
   * Tailwind bg-* class for the bar (palette classes, no hex). Omit for the
   * v2 default: the largest row is the striped lime "highlight" bar, the
   * rest quiet grey - colour marks the point, not the category.
   */
  barClass?: string;
  /** Small icon before the label (decorative). */
  icon?: ReactNode;
}

// Default bars: the "Gdzie idą pieniądze" share gradient, the largest row at
// full strength and the rest softer - colour marks the point, not the
// category. Stacked cards (sources) colour each category instead, always
// next to its label, so the colour is never the only cue.
const BAR_TOP = "share-fill";
const BAR_REST = "share-fill opacity-55";
/** Category colours for the stacked overview bar (pastel accents). */
const STACK = ["bg-lime", "bg-mint", "bg-violet", "bg-amber", "bg-[var(--prev)]", "bg-coral/70"];

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
  kicker,
  stacked = false,
}: {
  title: string;
  /** Data window, when it differs from the page's own period. */
  periodNote?: string;
  /** One-sentence takeaway shown above the bars. */
  insight?: ReactNode | null;
  rows: ShareRow[];
  unit: (n: number) => string;
  /** Keep the given order (age brackets read better young -> old). */
  keepOrder?: boolean;
  /** Why the card is empty and what happens next (defaults to a GA4 note). */
  emptyText?: string;
  className?: string;
  /** 3 when the card sits under a section heading (Sprzedaż, Odbiorcy). */
  headingLevel?: 2 | 3;
  /** Mono eyebrow above the title ("RUCH · 30 DNI"). */
  kicker?: string;
  /** One stacked bar of all rows on top, each row in its own colour. */
  stacked?: boolean;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const total = rows.reduce((a, r) => a + r.value, 0);
  const visible = rows.filter((r) => r.value > 0);
  const sorted = keepOrder ? visible : [...visible].sort((a, b) => b.value - a.value);
  const pcts = sharesSumming100(sorted.map((r) => r.value));
  const maxValue = Math.max(0, ...sorted.map((r) => r.value));
  const colour = (i: number) => STACK[Math.min(i, STACK.length - 1)];

  return (
    <Card className={cn("flex flex-col p-6 sm:p-[28px_30px]", className)}>
      {kicker ? <p className="kick">{kicker}</p> : null}
      <Heading
        className={cn(
          "font-medium leading-tight text-foreground",
          headingLevel === 3 ? "text-lg tracking-[-0.02em]" : "text-[22px] tracking-[-0.03em]",
          kicker && "mt-2"
        )}
      >
        {title}
      </Heading>
      {insight ? <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{insight}</p> : null}
      {periodNote ? <p className="mt-1 text-[13px] text-ink-3">{periodNote}</p> : null}
      {stacked && sorted.length > 1 ? (
        <div
          className="mt-6 flex h-[18px] gap-[3px] overflow-hidden rounded-full"
          role="img"
          aria-label={sorted.map((r, i) => `${r.label} ${pcts[i]}%`).join(", ")}
        >
          {sorted.map((r, i) => (
            <span
              key={r.key}
              className={cn("h-full origin-left animate-grow first:rounded-l-full last:rounded-r-full", r.barClass ?? colour(i))}
              style={{ flex: `${Math.max(r.value, total * 0.01)} 1 0`, "--d": `${0.2 + i * 0.08}s` } as CSSProperties}
            />
          ))}
        </div>
      ) : null}
      <ul className={cn(stacked ? "mt-3" : "mt-4")}>
        {sorted.map((r, i) => {
          const share = total > 0 ? r.value / total : 0;
          const isTop = r.value === maxValue && sorted.findIndex((o) => o.value === maxValue) === i;
          return (
            <li key={r.key} className="border-t border-line py-3.5 first:border-t-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex min-w-0 items-baseline gap-2.5">
                  {stacked ? (
                    <span
                      aria-hidden
                      className={cn("h-3 w-3 shrink-0 translate-y-[1px] rounded-[4px]", r.barClass ?? colour(i))}
                    />
                  ) : r.icon ? (
                    <span
                      aria-hidden
                      className="flex h-4 w-4 shrink-0 translate-y-[3px] items-center justify-center text-ink-3 [&_svg]:h-4 [&_svg]:w-4"
                    >
                      {r.icon}
                    </span>
                  ) : null}
                  <span className="text-[15px] font-medium">{r.label}</span>
                  {/* The hint is a side note: it shortens with an ellipsis
                      (full text on hover) instead of wrapping the row. */}
                  {r.hint ? (
                    <span
                      className="hidden min-w-0 truncate text-[13px] text-ink-3 sm:block"
                      title={r.hint}
                    >
                      {r.hint}
                    </span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-baseline gap-3 text-right">
                  <span className="text-[13px] tabular-nums text-ink-3">{unit(r.value)}</span>
                  <span className="min-w-[2.75rem] text-[15px] font-medium tabular-nums tracking-[-0.01em]">
                    {pcts[i]}%
                  </span>
                </div>
              </div>
              {/* The % is printed above; the bar only repeats it visually. */}
              <div className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-chip" aria-hidden>
                <div
                  className={cn(
                    "h-full origin-left rounded-full animate-grow",
                    r.barClass ?? (stacked ? colour(i) : isTop ? BAR_TOP : BAR_REST)
                  )}
                  style={{
                    width: `${Math.max(share * 100, 2)}%`,
                    "--d": `${0.25 + Math.min(i, 6) * 0.06}s`,
                  } as CSSProperties}
                />
              </div>
            </li>
          );
        })}
      </ul>
      {sorted.length === 0 ? (
        <p className="mt-4 text-sm text-ink-2">
          {emptyText ?? "Brak danych w tym okresie - pojawią się po najbliższej synchronizacji."}
        </p>
      ) : null}
    </Card>
  );
}

export const visitsUnit = (n: number) =>
  `${formatNumberPL(n)} ${plPlural(n, "wizyta", "wizyty", "wizyt")}`;
