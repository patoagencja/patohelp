import { Card } from "@tremor/react";
import { Sparkles } from "lucide-react";

import type { AiSummary } from "@/lib/dashboard/overview";
import { formatDateWarsaw } from "@/lib/utils";

/** "2026-09-29" -> "29.09" (period dates are already Warsaw days). */
const ddmm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

export function AiSummaryCard({
  summary,
  lang = "pl",
}: {
  summary: AiSummary | null;
  lang?: "pl" | "en";
}) {
  const en = lang === "en";
  return (
    <Card className="border-l-4 border-l-primary">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent">
          <Sparkles className="h-4 w-4 text-accent-foreground" aria-hidden />
        </span>
        <div>
          <h2 className="text-base font-semibold">{en ? "AI summary" : "Podsumowanie AI"}</h2>
          {summary ? (
            <>
              <p className="mt-1 text-sm leading-relaxed text-foreground">
                {summary.summaryText.replace(/[–—]/g, "-")}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {en ? "Generated" : "Wygenerowano"}{" "}
                {formatDateWarsaw(summary.generatedAt, "d MMM yyyy, HH:mm")}
                {/* Its own fixed 7-day window, not the range picked above -
                    say which days, or its numbers look like they contradict
                    the cards. */}
                {summary.periodStart && summary.periodEnd
                  ? ` · ${en ? "data" : "dane"} ${ddmm(summary.periodStart)}–${ddmm(summary.periodEnd)}`
                  : null}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              {en
                ? "The AI summary will be generated after the first data sync."
                : "Podsumowanie AI zostanie wygenerowane po pierwszej synchronizacji danych."}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
