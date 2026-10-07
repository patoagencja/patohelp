import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { InfoTip } from "@/components/dashboard/info-tip";
import { CountUp } from "@/components/ui/count-up";
import { cn } from "@/lib/utils";

/**
 * Static 2026 KPI tile (Przeglad-pastel `.k`) for pages whose tiles are not
 * chart tabs (Sprzedaż, Strona www): mono label + ⓘ, the change on the
 * right, a light 46px number counting up, a drawn sparkline and quiet lines
 * under it. The overview's Tile is the interactive sibling.
 */

export type StatTone = "good" | "bad" | "flat";

const TONE: Record<StatTone, string> = {
  good: "text-positive",
  bad: "text-negative",
  flat: "text-ink-2",
};

/** Sparkline path in a 200x44 box, min..max stretched to the height. */
function sparkPath(v: number[]): string | null {
  if (v.length < 2) return null;
  const mn = Math.min(...v);
  const mx = Math.max(...v);
  const span = mx - mn || 1;
  return v
    .map(
      (p, j) =>
        `${j ? "L" : "M"}${((j * 200) / (v.length - 1)).toFixed(1)} ${(mx === mn ? 22 : 40 - ((p - mn) / span) * 36).toFixed(1)}`
    )
    .join(" ");
}

export function StatTile({
  label,
  explain,
  value,
  delta,
  spark,
  meter,
  sub,
  foot,
  highlight = false,
  index = 0,
  lang = "pl",
  className,
}: {
  /** Short plain label ("Przychód"); the ⓘ carries the definition. */
  label: string;
  explain?: string;
  /** Formatted figure ("250 863 zł", "62%", "-"). A trailing unit is set small. */
  value: string;
  /** The change, printed top-right: "9,8%" + arrow, coloured by judgement. */
  delta?: { text: string; tone: StatTone; direction: "up" | "down" | null } | null;
  /** Daily values, oldest -> newest (decorative). */
  spark?: number[];
  /** 0..1 share drawn as a short meter where a rate has no daily line. */
  meter?: number | null;
  /** One quiet line under the sparkline ("więcej niż wcześniej"). */
  sub?: ReactNode;
  /** Hairline-separated footer ("+15% vs rok temu"). */
  foot?: ReactNode;
  /** The page's lead number: lime ring + corner light (not a selection). */
  highlight?: boolean;
  /** Entrance stagger position. */
  index?: number;
  lang?: "pl" | "en";
  className?: string;
}) {
  const unit = /^(.*?\d)\s?(zł|%|×)$/.exec(value);
  const path = spark ? sparkPath(spark) : null;
  const delay = { "--d": `${0.15 + index * 0.08}s` } as CSSProperties;
  return (
    <div
      className={cn(
        "glass relative flex min-w-0 flex-col gap-3.5 rounded-tile p-5 pb-[18px] animate-rise focus-within:z-10 hover:z-10 sm:gap-4 sm:p-[22px] sm:pb-5",
        highlight && "shadow-lime-ring print:shadow-none",
        className
      )}
      style={delay}
    >
      {highlight ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[radial-gradient(120%_80%_at_0%_0%,hsl(var(--lime)/0.2),transparent_60%)]"
        />
      ) : null}
      <div className="relative flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1">
          <span className="kick truncate text-[11px] tracking-[0.08em] xl:text-[11.5px] xl:tracking-[0.12em]">
            {label}
          </span>
          {explain ? <InfoTip label={label} text={explain} lang={lang} className="shrink-0" /> : null}
        </span>
        {delta ? (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 text-[13.5px] font-semibold tabular-nums",
              TONE[delta.tone]
            )}
          >
            {delta.direction === "up" ? (
              <ArrowUpRight className="h-[13px] w-[13px]" strokeWidth={2.4} aria-hidden />
            ) : delta.direction === "down" ? (
              <ArrowDownRight className="h-[13px] w-[13px]" strokeWidth={2.4} aria-hidden />
            ) : null}
            {delta.text}
          </span>
        ) : null}
      </div>
      <p
        className={cn(
          "relative truncate font-light leading-none tracking-[-0.055em] tabular-nums",
          // Eight-digit złoty amounts ("10 621 160 zł") in a four-column row
          // were cut to "10 621 16…": long values step down a size.
          value.length >= 11
            ? "text-[2rem] sm:text-[2.25rem] xl:text-[2.25rem]"
            : "text-[2.25rem] sm:text-[2.5rem] xl:text-[2.875rem]"
        )}
        title={value}
      >
        {unit ? (
          <>
            <CountUp text={unit[1]} delayMs={200 + index * 80} />
            <small className="ml-[3px] text-[0.48em] tracking-[-0.02em]">{unit[2]}</small>
          </>
        ) : (
          <CountUp text={value} delayMs={200 + index * 80} />
        )}
      </p>
      {path ? (
        <svg
          aria-hidden
          width="100%"
          height="44"
          viewBox="0 0 200 44"
          preserveAspectRatio="none"
          className="relative overflow-visible"
        >
          <path
            d={path}
            pathLength={1}
            fill="none"
            stroke={highlight ? "hsl(var(--lime-line))" : "var(--ink-3)"}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="draw-path animate-draw"
            style={{ "--d": `${0.6 + index * 0.12}s` } as CSSProperties}
          />
        </svg>
      ) : null}
      {!path && meter != null ? (
        <div aria-hidden className="relative my-[17px] h-2.5 overflow-hidden rounded-full bg-chip">
          <div
            className="share-fill h-full origin-left rounded-full animate-grow"
            style={{ width: `${Math.max(0, Math.min(1, meter)) * 100}%`, "--d": `${0.6 + index * 0.12}s` } as CSSProperties}
          />
        </div>
      ) : null}
      {sub ? <div className="relative text-[13px] leading-snug text-ink-3">{sub}</div> : null}
      {foot ? (
        <div className="relative mt-auto border-t border-line pt-3 text-[12.5px] leading-snug text-ink-3">
          {foot}
        </div>
      ) : null}
    </div>
  );
}
