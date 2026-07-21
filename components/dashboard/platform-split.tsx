import { Card, Title } from "@tremor/react";

import type { PlatformSplit as PlatformSplitData } from "@/lib/dashboard/metrics";
import { formatMoneyPLN } from "@/lib/utils";

// Inline-SVG donut (server component). Deliberately NOT Tremor's DonutChart -
// Recharts-based charts repeatedly fail to render in this app; pure SVG always
// paints and needs no hydration.
export function PlatformSplit({ split }: { split: PlatformSplitData }) {
  const total =
    split.metaSpendMinorUnits +
    split.googleSpendMinorUnits +
    split.tiktokSpendMinorUnits;
  const pct = (v: number) => (total > 0 ? Math.round((v / total) * 100) : 0);

  // Only show platforms that actually have spend.
  const entries = [
    { short: "Meta", value: split.metaSpendMinorUnits, hex: "#3b82f6" },
    { short: "Google", value: split.googleSpendMinorUnits, hex: "#f59e0b" },
    { short: "TikTok", value: split.tiktokSpendMinorUnits, hex: "#fe2c55" },
  ].filter((e) => e.value > 0);

  // Donut geometry: stroke-dasharray segments on a circle.
  const R = 70;
  const CIRC = 2 * Math.PI * R;
  let offset = 0;
  const segments = entries.map((e) => {
    const frac = total > 0 ? e.value / total : 0;
    const seg = { ...e, dash: frac * CIRC, offset };
    offset += frac * CIRC;
    return seg;
  });

  return (
    <Card>
      <Title>Podział wydatków</Title>
      {entries.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          Brak wydatków w tym okresie.
        </p>
      ) : (
        <>
          <div className="mt-6 flex justify-center">
            <div className="relative h-52 w-52">
              <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90">
                <circle
                  cx="100"
                  cy="100"
                  r={R}
                  fill="none"
                  className="stroke-muted"
                  strokeWidth="26"
                />
                {segments.map((s) => (
                  <circle
                    key={s.short}
                    cx="100"
                    cy="100"
                    r={R}
                    fill="none"
                    stroke={s.hex}
                    strokeWidth="26"
                    strokeDasharray={`${Math.max(s.dash, 0.1)} ${CIRC}`}
                    strokeDashoffset={-s.offset}
                    strokeLinecap="butt"
                  />
                ))}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-lg font-semibold tabular-nums">
                  {formatMoneyPLN(total)}
                </span>
                <span className="text-xs text-muted-foreground">łącznie</span>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1">
            {entries.map((e) => (
              <span
                key={e.short}
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: e.hex }}
                />
                {e.short}: {formatMoneyPLN(e.value)} ({pct(e.value)}%)
              </span>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
