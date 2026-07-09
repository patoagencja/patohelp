"use client";

import { useEffect } from "react";

// Route error boundary: keeps the dashboard usable instead of a blank white
// "Application error" screen, and surfaces the actual message/digest so we can
// diagnose client-side exceptions.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-lg font-semibold">Coś poszło nie tak</p>
      <p className="max-w-lg text-sm text-muted-foreground">
        Wystąpił błąd podczas ładowania widoku. Spróbuj ponownie - jeśli się
        powtarza, prześlij poniższy komunikat.
      </p>
      <pre className="max-w-xl overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-left text-xs text-muted-foreground">
        {error.message || "Nieznany błąd"}
        {error.digest ? `\n\ndigest: ${error.digest}` : ""}
      </pre>
      <button
        type="button"
        onClick={reset}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        Spróbuj ponownie
      </button>
    </div>
  );
}
