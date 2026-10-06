"use client";

import { FileDown } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Browser print -> "Zapisz jako PDF": a clean, paginated board handout. */
export function PrintButton() {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      data-print-hide
      onClick={() => window.print()}
      className="gap-1.5"
      title="Zapisz przegląd jako PDF (np. dla zarządu)"
      // The text label is hidden on phones, leaving an icon-only button.
      aria-label="Pobierz PDF"
    >
      <FileDown className="h-4 w-4" aria-hidden />
      <span className="hidden sm:inline">Pobierz PDF</span>
    </Button>
  );
}

/** Report header that exists only on paper. */
export function PrintHeader({
  clientName,
  periodLabel,
}: {
  clientName: string;
  periodLabel: string;
}) {
  const generated = new Intl.DateTimeFormat("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Warsaw",
  }).format(new Date());
  return (
    <div className="hidden border-b border-border pb-3 print:block">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        Raport kampanii · {periodLabel}
      </p>
      <p className="text-xl font-semibold">{clientName}</p>
      <p className="text-xs text-muted-foreground">Wygenerowano {generated}</p>
    </div>
  );
}
