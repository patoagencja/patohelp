"use client";

import { FileDown } from "lucide-react";

import { ClientBrandMark } from "@/components/dashboard/client-brand-mark";
import { clientLogo } from "@/components/dashboard/client-logo";
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
  clientSlug,
  logoUrl,
}: {
  clientName: string;
  periodLabel: string;
  /** With a logo (uploaded or built-in) the PDF opens with the client's own
   *  mark top-left, so the board sees their report, not an agency printout. */
  clientSlug?: string;
  logoUrl?: string | null;
}) {
  const generated = new Intl.DateTimeFormat("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Warsaw",
  }).format(new Date());
  const hasMark = Boolean(logoUrl || (clientSlug && clientLogo(clientSlug)));
  return (
    // The rule under the header carries the client's accent (falls back to
    // primary) - one of the few places the brand colour is allowed.
    <div className="hidden border-b-2 border-client-accent pb-3 print:block">
      <div className="flex items-center gap-4">
        {hasMark ? (
          <ClientBrandMark
            name={clientName}
            slug={clientSlug}
            logoUrl={logoUrl}
            className="h-12 max-w-[14rem] shrink-0 text-foreground [&:not(img)]:h-10"
          />
        ) : null}
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Raport kampanii · {periodLabel}
          </p>
          <p className="text-xl font-semibold">{clientName}</p>
          <p className="text-xs text-muted-foreground">Wygenerowano {generated}</p>
        </div>
      </div>
    </div>
  );
}
