import { Card, Title } from "@tremor/react";

import type { CostTrendPoint } from "@/lib/dashboard/metrics";
import { formatMoneyPLN } from "@/lib/utils";

// Inline-SVG dual line chart (server component). Deliberately NOT Tremor's
// LineChart - Recharts-based charts repeatedly fail to render in this app;
// pure SVG always paints and needs no hydration.

const W = 640;
const H = 280;
const PAD = { top: 12, right: 12, bottom: 28, left: 56 };

interface Series {
  name: string;
  hex: string;
  points: Array<{ i: number; value: number }>;
}

export function CostTrends({
  costTrend: raw,
  lang = "pl",
}: {
  costTrend: CostTrendPoint[];
  lang?: "pl" | "en";
}) {
  const en = lang === "en";
  // Trim leading/trailing days with no data at all, so a range that starts
  // before the data does (e.g. before the backfill horizon) doesn't squash
  // the lines into a corner of an empty axis.
  const hasData = (p: CostTrendPoint) =>
    p.metaCpcMinorUnits != null || p.googleCpcMinorUnits != null;
  const first = raw.findIndex(hasData);
  const last = raw.length - 1 - [...raw].reverse().findIndex(hasData);
  const costTrend = first === -1 ? [] : raw.slice(first, last + 1);
  const n = costTrend.length;

  const series: Series[] = [
    {
      name: "CPC Meta",
      hex: "#3b82f6",
      points: costTrend
        .map((p, i) => ({ i, value: p.metaCpcMinorUnits }))
        .filter((p): p is { i: number; value: number } => p.value != null),
    },
    {
      name: "CPC Google",
      hex: "#f59e0b",
      points: costTrend
        .map((p, i) => ({ i, value: p.googleCpcMinorUnits }))
        .filter((p): p is { i: number; value: number } => p.value != null),
    },
  ].filter((s) => s.points.length > 0);

  const allValues = series.flatMap((s) => s.points.map((p) => p.value));
  const max = allValues.length ? Math.max(...allValues) : 0;
  const min = 0; // CPC axis starts at zero for honest proportions
  const span = max - min || 1;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const y = (v: number) => PAD.top + plotH - ((v - min) / span) * plotH;

  // 4 horizontal gridlines with PLN labels.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * span);

  // ~6 x-axis date labels.
  const labelEvery = Math.max(1, Math.ceil(n / 6));
  const xLabels = costTrend
    .map((p, i) => ({ i, date: p.date }))
    .filter(({ i }) => i % labelEvery === 0 || i === n - 1);

  const path = (s: Series) =>
    s.points.map((p, idx) => `${idx === 0 ? "M" : "L"}${x(p.i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");

  return (
    <Card>
      <Title>{en ? "Avg daily CPC - Meta vs Google" : "Średni CPC dziennie - Meta vs Google"}</Title>
      {series.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Brak danych CPC w tym okresie.
        </p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="mt-4 h-64 w-full"
            preserveAspectRatio="none"
            role="img"
            aria-label="Średni CPC dziennie"
          >
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y(t)}
                  y2={y(t)}
                  className="stroke-border"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                <text
                  x={PAD.left - 6}
                  y={y(t) + 3}
                  textAnchor="end"
                  className="fill-muted-foreground"
                  fontSize="10"
                >
                  {formatMoneyPLN(Math.round(t))}
                </text>
              </g>
            ))}
            {xLabels.map(({ i, date }) => {
              const [, month, day] = date.split("-");
              return (
                <text
                  key={date}
                  x={x(i)}
                  y={H - 8}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                  fontSize="10"
                >
                  {day}.{month}
                </text>
              );
            })}
            {series.map((s) => (
              <path
                key={s.name}
                d={path(s)}
                fill="none"
                stroke={s.hex}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          <div className="mt-2 flex justify-center gap-4">
            {series.map((s) => (
              <span
                key={s.name}
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: s.hex }}
                />
                {s.name}
              </span>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
