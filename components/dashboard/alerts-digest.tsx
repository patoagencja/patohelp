import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";

import type { Anomaly } from "@/lib/alerts/anomalies";
import { cn } from "@/lib/utils";

const SEVERITY_DOT: Record<Anomaly["severity"], string> = {
  critical: "bg-red-600",
  high: "bg-red-400",
  medium: "bg-amber-400",
};

const SEVERITY_LABEL: Record<Anomaly["severity"], string> = {
  critical: "Krytyczny",
  high: "Wysoki",
  medium: "Średni",
};

/**
 * Compact "most important alerts" module for the overview - a sibling of the
 * monthly-budget bar (same card style). Shows the top few live anomalies and
 * links to the full Alerty tab.
 */
export function AlertsDigest({
  alerts,
  clientSlug,
}: {
  alerts: Anomaly[];
  clientSlug: string;
}) {
  const top = alerts.slice(0, 4);

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle
            className={cn(
              "h-4 w-4",
              top.length > 0 ? "text-red-500" : "text-muted-foreground"
            )}
          />
          Najważniejsze alerty
        </p>
        <Link
          href={`/${clientSlug}/alerty`}
          className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Wszystkie alerty
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {top.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          Brak aktywnych alertów - wyniki w normie względem ostatnich 2 tygodni.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border/60">
          {top.map((a) => (
            <li key={a.id}>
              <Link
                href={`/${clientSlug}/alerty`}
                className="group flex items-center gap-3 py-2.5"
              >
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    SEVERITY_DOT[a.severity]
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium group-hover:underline">
                    {a.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {a.scopeLabel}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    a.severity === "critical"
                      ? "bg-red-600 text-white"
                      : a.severity === "high"
                        ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
                        : "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400"
                  )}
                >
                  {SEVERITY_LABEL[a.severity]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
