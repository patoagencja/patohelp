"use client";

import { Card } from "@/components/ui/card";
import { useState } from "react";

import type { ActivityHeatmap as ActivityHeatmapData } from "@/lib/dashboard/activity";
import { plPlural } from "@/lib/dashboard/story";
import { cn, formatNumberPL } from "@/lib/utils";

// Day x hour grid answering "when should we post / push ads?". A readout line
// instead of a floating tooltip: it works the same for mouse hover and phone
// taps, and never gets clipped by the card edge.

const DAY_SHORT = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Ndz"];
const DAY_NAME = ["Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek", "Sobota", "Niedziela"];

// Index 0 = no visits at all; 1-6 = intensity relative to the busiest cell.
// Signature lime scale (v2), ending in the deeper chart-1 green so the peak
// hours read as "the point" in both themes. Literal class strings so
// Tailwind generates every level.
const LEVEL_CLASSES = [
  "bg-muted",
  "bg-lime/15",
  "bg-lime/30",
  "bg-lime/50",
  "bg-lime/75",
  "bg-lime",
  "bg-chart-1",
];
const LEGEND_LEVELS = [1, 2, 3, 4, 5, 6];

function level(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(6, Math.max(1, Math.ceil((value / max) * 6)));
}

interface Selection {
  day: number;
  hour: number;
  span: number;
}

function sumSpan(matrix: number[][], s: Selection): number {
  let n = 0;
  for (let h = s.hour; h < s.hour + s.span; h++) n += matrix[s.day]?.[h] ?? 0;
  return n;
}

function describe(matrix: number[][], s: Selection): string {
  const n = sumSpan(matrix, s);
  return `${DAY_NAME[s.day]} ${s.hour}:00-${s.hour + s.span}:00 · ${formatNumberPL(n)} ${plPlural(n, "wizyta", "wizyty", "wizyt")}`;
}

function Grid({
  matrix,
  span,
  labelEvery,
  selected,
  onSelect,
  className,
  colsClass,
}: {
  matrix: number[][];
  /** Hours per column (1 on desktop, 2 on phones). */
  span: number;
  /** Show an hour label every N columns. */
  labelEvery: number;
  selected: Selection | null;
  onSelect: (s: Selection) => void;
  className?: string;
  colsClass: string;
}) {
  const columns = 24 / span;
  const cells = matrix.map((row) =>
    Array.from({ length: columns }, (_, c) => {
      let v = 0;
      for (let h = c * span; h < (c + 1) * span; h++) v += row[h] ?? 0;
      return v;
    })
  );
  // Scale per grid: 2-hour buckets have roughly double the values.
  const max = Math.max(0, ...cells.flat());

  return (
    <div className={cn("grid gap-[3px]", colsClass, className)}>
      {cells.map((row, d) => (
        <div key={d} className="contents">
          <div className="flex items-center pr-1 text-xs text-muted-foreground">{DAY_SHORT[d]}</div>
          {row.map((v, c) => {
            const hour = c * span;
            const isSelected = selected?.day === d && selected.hour === hour && selected.span === span;
            return (
              <div
                key={c}
                onPointerEnter={() => onSelect({ day: d, hour, span })}
                onClick={() => onSelect({ day: d, hour, span })}
                className={cn(
                  "aspect-square cursor-pointer rounded-[4px] transition-shadow",
                  LEVEL_CLASSES[level(v, max)],
                  isSelected && "ring-2 ring-foreground ring-offset-1 ring-offset-card"
                )}
              />
            );
          })}
        </div>
      ))}
      <div />
      {Array.from({ length: columns }, (_, c) => (
        <div key={c} className="pt-1 text-[10px] leading-none tabular-nums text-muted-foreground">
          {c % labelEvery === 0 ? c * span : ""}
        </div>
      ))}
    </div>
  );
}

export function ActivityHeatmap({ data }: { data: ActivityHeatmapData | null }) {
  const [selected, setSelected] = useState<Selection | null>(null);
  if (!data || data.total <= 0) return null;

  const { matrix, peak } = data;
  const readout = selected
    ? describe(matrix, selected)
    : `Szczyt: ${describe(matrix, { day: peak.day, hour: peak.hour, span: 1 })}`;

  const facts = [
    {
      label: "Najmocniejsze dni",
      value: data.topDays.map((d) => DAY_NAME[d].toLowerCase()).join(" i "),
    },
    {
      label: "Najlepsze 3 godziny",
      value: `${data.bestWindow.startHour}:00-${data.bestWindow.endHour}:00`,
    },
    {
      label: "Dni robocze / weekend",
      value: `${Math.round(data.weekdayShare * 100)}% / ${Math.round(data.weekendShare * 100)}%`,
    },
  ];

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-section-title text-foreground">Kiedy Twoi klienci są aktywni</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{data.takeaway}</p>

      <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-start">
        <div
          className="min-w-0 flex-1 lg:max-w-3xl"
          role="img"
          aria-label={`Wizyty na stronie wg dnia tygodnia i godziny. ${data.takeaway}`}
          onPointerLeave={() => setSelected(null)}
        >
          {/* 24 columns get too thin to tap below ~640px - phones see 2-hour buckets. */}
          <Grid
            matrix={matrix}
            span={1}
            labelEvery={3}
            selected={selected}
            onSelect={setSelected}
            className="hidden sm:grid"
            colsClass="grid-cols-[2.25rem_repeat(24,minmax(0,1fr))]"
          />
          <Grid
            matrix={matrix}
            span={2}
            labelEvery={2}
            selected={selected}
            onSelect={setSelected}
            className="sm:hidden"
            colsClass="grid-cols-[2rem_repeat(12,minmax(0,1fr))]"
          />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="inline-flex items-center gap-2 text-sm font-medium tabular-nums" aria-live="polite">
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-lime" />
              {readout}
            </p>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-hidden>
              <span>mniej</span>
              {LEGEND_LEVELS.map((l) => (
                <span key={l} className={cn("h-3 w-3 rounded-[4px]", LEVEL_CLASSES[l])} />
              ))}
              <span>więcej</span>
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3 lg:w-56 lg:grid-cols-1">
          {facts.map((f) => (
            <div key={f.label} className="rounded-2xl bg-muted/60 px-4 py-3">
              <dt className="text-xs text-muted-foreground">{f.label}</dt>
              <dd className="mt-1 text-[15px] font-semibold tabular-nums tracking-[-0.01em]">{f.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Suma wizyt z ostatnich 4 tygodni wg dnia tygodnia i godziny (czas polski).
      </p>
    </Card>
  );
}
