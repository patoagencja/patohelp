"use client";

import { useState } from "react";
import { Download, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { RangeKey } from "@/lib/dashboard/ranges";
import { cn } from "@/lib/utils";

export function ReportActions({
  clientSlug,
  range,
}: {
  clientSlug: string;
  range: RangeKey;
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
      {/* Controls — hidden in the printed PDF */}
      <div className="flex flex-wrap gap-2 print:hidden">
        <Button onClick={generate} disabled={loading} className="gap-1.5">
          <Sparkles className={cn("h-4 w-4", loading && "animate-pulse")} />
          {loading ? "Generuję…" : summary ? "Wygeneruj ponownie" : "Generuj opis AI"}
        </Button>
        <Button
          variant="outline"
          onClick={() => window.print()}
          className="gap-1.5"
        >
          <Download className="h-4 w-4" />
          Pobierz PDF
        </Button>
      </div>

      {/* Narrative — part of the printable report */}
      {summary ? (
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            Podsumowanie
          </div>
          <div className="space-y-3 text-sm leading-relaxed text-foreground">
            {summary.split(/\n\s*\n/).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground print:hidden">
          Kliknij „Generuj opis AI", aby dodać do raportu narrację o wynikach z
          wybranego okresu. Potem „Pobierz PDF", aby zapisać i wysłać.
        </div>
      )}
    </>
  );
}
