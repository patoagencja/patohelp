import { Fragment, type ReactNode } from "react";
import { Sparkles } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Ping } from "@/components/ui/primitives";
import type { EcomAnalysis } from "@/lib/ecom/analysis";
import { formatDateWarsaw } from "@/lib/utils";

// Percentages in the AI text ("o 18%", "+30%", "30-40%") become small tinted chips,
// like the key-number chips of the benchmark's AI banner (2.webp).
// Ranges ("30-40%") stay one chip.
const PCT = /((?:\d+(?:[.,]\d+)?\s?[-–]\s?)?[+\-−]?\d+(?:[.,]\d+)?\s?%)/g;

function withChips(text: string) {
  return text.split(PCT).map((part, i) =>
    i % 2 === 1 ? (
      <span
        key={i}
        className="whitespace-nowrap rounded-md bg-ai-soft px-1 py-px font-semibold tabular-nums text-ai print:bg-transparent print:p-0"
      >
        {part}
      </span>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  );
}

/** One labelled block inside the analysis ("Co dzieje się na rynku"). */
function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="kick mb-2 text-[11px]">{title}</h3>
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
    // The 2026 AI surface (overview's AI card): the pastel orb, "Claude" +
    // what it is, then the headline as the lead sentence.
    <Card className="overflow-hidden p-0">
      <div className="border-b border-line p-6 sm:p-[28px_30px]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <span aria-hidden className="orb h-[52px] w-[52px] sm:h-[56px] sm:w-[56px]">
              <span className="orb-halo" />
              <span className="orb-ring" />
              <span className="orb-core" />
            </span>
            <div className="min-w-0">
              <p className="kick flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                Analiza AI
              </p>
              <h2 className="mt-1.5 text-[22px] font-medium leading-tight tracking-[-0.03em]">
                Co dalej ze sprzedażą
              </h2>
              <p className="mt-1 text-[13px] text-ink-3">
                Twoja sprzedaż na tle sezonu w branży i tego, co dzieje się na rynku.
              </p>
            </div>
          </div>
          {action}
        </div>
        {analysis ? (
          <p className="mt-5 max-w-3xl text-xl font-normal leading-snug tracking-[-0.02em] text-foreground">
            {analysis.headline}
          </p>
        ) : null}
      </div>

      {analysis ? (
        <div className="max-w-3xl space-y-6 p-6 sm:p-[28px_30px]">
          <p className="text-[15px] leading-relaxed text-foreground">
            {withChips(analysis.performance)}
          </p>

          {analysis.peaks.length ? (
            <Block title="Najmocniejsze momenty w Twoich danych">
              <ul className="space-y-1.5">
                {analysis.peaks.map((p, i) => (
                  <li key={i} className="flex gap-2.5 text-sm">
                    <Ping tone="lime" still className="mt-1.5" />
                    <span>
                      <span className="font-medium">{p.label}</span>
                      {p.note ? <span className="text-muted-foreground"> - {p.note}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </Block>
          ) : null}

          {analysis.seasonality ? (
            <Block title="Jak zwykle wygląda sezon w branży">
              <p className="text-sm leading-relaxed text-foreground">
                {withChips(analysis.seasonality)}
              </p>
            </Block>
          ) : null}

          {analysis.market ? (
            <Block title="Co dzieje się na rynku">
              <p className="text-sm leading-relaxed text-foreground">{withChips(analysis.market)}</p>
            </Block>
          ) : null}

          {analysis.recommendations.length ? (
            <Block title="Co proponujemy">
              <ol className="space-y-2 text-sm">
                {analysis.recommendations.map((r, i) => (
                  <li key={i} className="flex gap-2.5 leading-relaxed">
                    <span
                      aria-hidden
                      className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ai-soft text-[11px] font-semibold tabular-nums text-ai"
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0">{r}</span>
                  </li>
                ))}
              </ol>
            </Block>
          ) : null}

          {generatedAt ? (
            <p className="text-xs text-muted-foreground">
              Przygotowano: {formatDateWarsaw(generatedAt, "d MMMM yyyy, HH:mm")}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="max-w-3xl p-6 text-sm leading-relaxed text-ink-2 sm:p-[28px_30px]">
          Kliknij „Przygotuj analizę” - AI przejrzy Twoją sprzedaż, wskaże
          najmocniejsze dni, opisze, jak zwykle wygląda sezon w Twojej branży i co
          dzieje się na rynku (sprawdzając aktualne informacje w internecie), a na
          koniec podpowie, jak przygotować się na nadchodzące szczyty.
        </p>
      )}
    </Card>
  );
}
