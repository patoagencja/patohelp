import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import type { EcomAnalysis } from "@/lib/ecom/analysis";
import { formatDateWarsaw } from "@/lib/utils";

/** One labelled block inside the analysis ("Co dzieje się na rynku"). */
function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-sm font-medium text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

// The AI's reading of the shop's sales against the industry season and the
// market. Shared by the client page (with a "generate" button) and the demo
// (pre-written analysis, no button).
export function AiAnalysisCard({
  analysis,
  generatedAt,
  action,
}: {
  analysis: EcomAnalysis | null;
  generatedAt?: string | null;
  /** E.g. the "Przygotuj analizę" button; omitted on the public demo. */
  action?: ReactNode;
}) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-section-title text-foreground">Analiza AI: co dalej</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Twoja sprzedaż na tle sezonu w branży i tego, co dzieje się na rynku.
          </p>
        </div>
        {action}
      </div>

      {analysis ? (
        <div className="mt-5 max-w-3xl space-y-5">
          <p className="text-lg font-semibold leading-snug">{analysis.headline}</p>
          <p className="text-sm leading-relaxed text-foreground">{analysis.performance}</p>

          {analysis.peaks.length ? (
            <Block title="Najmocniejsze momenty w Twoich danych">
              <ul className="space-y-1.5">
                {analysis.peaks.map((p, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-medium">{p.label}</span>
                    {p.note ? <span className="text-muted-foreground"> - {p.note}</span> : null}
                  </li>
                ))}
              </ul>
            </Block>
          ) : null}

          {analysis.seasonality ? (
            <Block title="Jak zwykle wygląda sezon w branży">
              <p className="text-sm leading-relaxed text-foreground">{analysis.seasonality}</p>
            </Block>
          ) : null}

          {analysis.market ? (
            <Block title="Co dzieje się na rynku">
              <p className="text-sm leading-relaxed text-foreground">{analysis.market}</p>
            </Block>
          ) : null}

          {analysis.recommendations.length ? (
            <Block title="Co proponujemy">
              <ul className="list-disc space-y-1.5 pl-5 text-sm marker:text-muted-foreground">
                {analysis.recommendations.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </Block>
          ) : null}

          {generatedAt ? (
            <p className="text-xs text-muted-foreground">
              Przygotowano: {formatDateWarsaw(generatedAt, "d MMMM yyyy, HH:mm")}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Kliknij „Przygotuj analizę” - AI przejrzy Twoją sprzedaż, wskaże
          najmocniejsze dni, opisze, jak zwykle wygląda sezon w Twojej branży i co
          dzieje się na rynku (sprawdzając aktualne informacje w internecie), a na
          koniec podpowie, jak przygotować się na nadchodzące szczyty.
        </p>
      )}
    </Card>
  );
}
