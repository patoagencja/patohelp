"use client";

import { useState } from "react";
import { Download, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { ContentSlide } from "@/components/dashboard/report/deck";
import { Button } from "@/components/ui/button";
import type { RangeKey } from "@/lib/dashboard/ranges";
import { cn } from "@/lib/utils";

export function ReportActions({
  clientSlug,
  range,
  rangeLabel,
}: {
  clientSlug: string;
  range: RangeKey;
  rangeLabel: string;
}) {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);
    toast.loading("Generuję opis AI…", { id: "report" });
    try {
      const res = await fetch(
        `/api/report/generate?client=${clientSlug}&range=${range}`,
        { method: "POST" }
      );
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? "");
      setSummary(body.summary as string);
      toast.success("Opis gotowy", { id: "report" });
    } catch {
      toast.error("Nie udało się wygenerować opisu", { id: "report" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Controls - hidden in the printed PDF */}
      <div className="flex flex-wrap justify-center gap-2 print:hidden">
        <Button onClick={generate} disabled={loading} className="gap-1.5">
          <Sparkles className={cn("h-4 w-4", loading && "animate-pulse")} />
          {loading ? "Generuję…" : summary ? "Wygeneruj ponownie" : "Generuj opis AI"}
        </Button>
        <Button variant="outline" onClick={() => window.print()} className="gap-1.5">
          <Download className="h-4 w-4" />
          Pobierz PDF
        </Button>
      </div>

      {/* Narrative - rendered as a deck slide so it's part of the PDF */}
      {summary ? (
        <ContentSlide title="Podsumowanie" subtitle={rangeLabel}>
          <div className="space-y-4 text-[15px] leading-relaxed text-slate-700">
            {summary.split(/\n\s*\n/).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        </ContentSlide>
      ) : (
        <p className="text-center text-sm text-slate-500 print:hidden">
          Kliknij „Generuj opis AI", aby dodać slajd z narracją o wynikach, a potem
          „Pobierz PDF", aby zapisać deck i wysłać.
        </p>
      )}
    </>
  );
}
