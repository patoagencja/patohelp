import { Card } from "@tremor/react";
import { Sparkles } from "lucide-react";

import type { AiSummary } from "@/lib/dashboard/overview";
import { formatDateWarsaw } from "@/lib/utils";

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
          <Sparkles className="h-4 w-4 text-accent-foreground" />
        </span>
        <div>
          <p className="text-sm font-medium">{en ? "AI summary" : "Podsumowanie AI"}</p>
          {summary ? (
            <>
              <p className="mt-1 text-sm leading-relaxed text-foreground">
                {summary.summaryText.replace(/[–—]/g, "-")}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {en ? "Generated" : "Wygenerowano"}{" "}
                {formatDateWarsaw(summary.generatedAt, "d MMM yyyy, HH:mm")}
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
