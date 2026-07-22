"use client";

import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";

import type { FlightMetric, PacingFlight } from "@/lib/alerts/pacing";
import { cn, formatMoneyPLN, formatNumberPL } from "@/lib/utils";

const METRIC_LABEL: Record<FlightMetric, string> = {
  clicks: "Kliknięcia",
  impressions: "Wyświetlenia",
  spend: "Wydatki",
  conversions: "Konwersje",
};

const fmt = (metric: FlightMetric, v: number) =>
  metric === "spend" ? formatMoneyPLN(v) : formatNumberPL(v);

// Ring colour by pacing status (won overrides everything below).
const RING_COLOR: Record<PacingFlight["status"], string> = {
  behind: "#ef4444",
  on_track: "#6366f1",
  ahead: "#10b981",
  upcoming: "#94a3b8",
  ended: "#94a3b8",
};

function Ring({ flight, index }: { flight: PacingFlight; index: number }) {
  const won = flight.realizedPct >= 1;
  const pct = Math.min(flight.realizedPct, 1);

  // Animate the arc from 0 to its value on mount (the "closing ring" moment).
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setProgress(pct), 60 + index * 90);
    return () => clearTimeout(t);
  }, [pct, index]);

  const R = 52;
  const CIRC = 2 * Math.PI * R;
  const color = won ? "#f5b301" : RING_COLOR[flight.status];
  const dash = CIRC * progress;

  return (
    <div
      className={cn(
        "relative flex flex-col items-center rounded-2xl border p-4 text-center transition-colors",
        won
          ? "border-amber-300 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10"
          : "border-border bg-card"
      )}
    >
      {won ? (
        <span className="absolute right-3 top-3 text-xs font-bold text-amber-500">
          🎉
        </span>
      ) : null}

      <div className="relative h-[128px] w-[128px]">
        <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
          <circle
            cx="64"
            cy="64"
            r={R}
            fill="none"
            className="stroke-muted"
            strokeWidth="10"
          />
          <circle
            cx="64"
            cy="64"
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${CIRC}`}
            style={{
              transition: "stroke-dasharray 1.1s cubic-bezier(0.22,1,0.36,1)",
              filter: won ? `drop-shadow(0 0 6px ${color}aa)` : undefined,
            }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {won ? (
            <Trophy className="h-7 w-7 text-amber-500" />
          ) : (
            <span className="text-2xl font-bold tabular-nums">
              {Math.round(flight.realizedPct * 100)}%
            </span>
          )}
          <span className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {METRIC_LABEL[flight.metric]}
          </span>
        </div>
      </div>

      <p
        className="mt-3 line-clamp-2 text-sm font-medium leading-snug"
        title={flight.campaignName}
      >
        {flight.campaignName}
      </p>
      <p className="mt-1 font-mono text-xs text-muted-foreground">
        {fmt(flight.metric, flight.realized)} / {fmt(flight.metric, flight.target)}
      </p>
      <p
        className={cn(
          "mt-1.5 text-xs font-semibold",
          won
            ? "text-amber-600 dark:text-amber-400"
            : flight.status === "behind"
              ? "text-red-500"
              : flight.status === "ahead"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-muted-foreground"
        )}
      >
        {won
          ? "Cel dowieziony!"
          : flight.status === "upcoming"
            ? "Wkrótce start"
            : flight.status === "ended"
              ? "Zakończona"
              : flight.status === "behind"
                ? `Za wolno - zostało ${Math.max(flight.daysLeft, 0)} dni`
                : flight.status === "ahead"
                  ? `Przed planem - ${Math.max(flight.daysLeft, 0)} dni`
                  : `Na czas - ${Math.max(flight.daysLeft, 0)} dni`}
      </p>
    </div>
  );
}

/**
 * Whoop/Bevel-style progress rings for campaign goals: each flight is a ring
 * that "closes" as the target is hit, with a win state on completion.
 */
export function CampaignRings({ flights }: { flights: PacingFlight[] }) {
  const active = flights.filter((f) => f.status !== "ended");
  if (active.length === 0) return null;

  const won = active.filter((f) => f.realizedPct >= 1).length;

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Trophy className="h-4 w-4 text-amber-500" />
          Cele kampanii
        </h2>
        {won > 0 ? (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
            {won} dowiezione 🏆
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {active.map((f, i) => (
          <Ring key={f.id} flight={f} index={i} />
        ))}
      </div>
    </section>
  );
}
