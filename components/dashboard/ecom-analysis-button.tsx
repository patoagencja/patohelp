"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2 } from "lucide-react";

export function EcomAnalysisButton({
  clientSlug,
  hasAnalysis = false,
}: {
  clientSlug: string;
  /** Switches the label to "refresh" once an analysis exists. */
  hasAnalysis?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; detail?: string } | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/ecom/analyze?client=${encodeURIComponent(clientSlug)}`,
        { method: "POST" }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        // Raw API errors mean nothing to a shop owner; keep them in the
        // tooltip for whoever debugs it.
        setError({
          message: "Nie udało się przygotować analizy. Spróbuj ponownie za chwilę.",
          detail: body.error ?? `Błąd ${res.status}`,
        });
      } else {
        router.refresh();
      }
    } catch (e) {
      setError({
        message: "Brak połączenia - sprawdź internet i spróbuj ponownie.",
        detail: (e as Error).message,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <button
        type="button"
        onClick={run}
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Sparkles className="h-4 w-4" aria-hidden />
        )}
        {loading
          ? "Analizuję dane i rynek…"
          : hasAnalysis
            ? "Odśwież analizę"
            : "Przygotuj analizę"}
      </button>
      <span aria-live="polite" className="max-w-xs text-xs text-destructive sm:text-right">
        {error ? <span title={error.detail}>{error.message}</span> : null}
      </span>
    </div>
  );
}
