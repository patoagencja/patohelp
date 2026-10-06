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
    // v2 AI banner (benchmark 2): lavender -> pink wash and the "Analiza AI"
    // chip, same as the overview's AI comment. Print drops the wash.
    <Card className="bg-ai-wash">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-5">
        <span className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-xl bg-card/70 px-2.5 py-1.5 text-[13px] font-semibold text-ai shadow-sm dark:bg-card/40 print:shadow-none">
          <Sparkles className="h-4 w-4" aria-hidden />
          {en ? "AI analysis" : "Analiza AI"}
        </span>
        <div className="min-w-0 sm:border-l sm:border-ai/15 sm:pl-5">
          <h2 className="text-section-title">{en ? "AI summary" : "Podsumowanie AI"}</h2>
          {summary ? (
            <>
              <p className="mt-1 max-w-3xl text-[15px] leading-relaxed text-foreground">
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
