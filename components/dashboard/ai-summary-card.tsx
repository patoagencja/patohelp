import { Card } from "@/components/ui/card";

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
    // 2026 AI card (Przeglad-pastel): glass + the conic orb, a mono kicker
    // and the comment in body size. Print drops the orb and the blur.
    <Card className="rounded-glass p-6 sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
        <span aria-hidden className="orb size-11 print:hidden">
          <span className="orb-halo" />
          <span className="orb-ring" />
          <span className="orb-core" />
        </span>
        <div className="min-w-0">
          <p className="kick">{en ? "AI analysis · this week" : "Analiza AI · ten tydzień"}</p>
          <h2 className="mt-2 text-[22px] font-medium tracking-[-0.03em]">{en ? "AI summary" : "Podsumowanie AI"}</h2>
          {summary ? (
            <>
              <p className="mt-2 max-w-3xl text-[17px] leading-relaxed tracking-[-0.01em] text-foreground">
                {summary.summaryText.replace(/[–—]/g, "-")}
              </p>
              <p className="mt-3 font-mono text-[11px] tracking-[0.04em] text-ink-3">
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
            <p className="mt-2 text-sm text-ink-2">
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
