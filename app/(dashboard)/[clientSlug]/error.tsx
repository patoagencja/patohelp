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
  // A failed chunk load means the browser is holding an old deployment whose
  // hashed JS files were purged from the CDN. We recover by doing a HARD,
  // cache-busting reload so the browser fetches the new build's HTML (which
  // references the new chunk names) instead of replaying the stale one.
  const isChunkError =
    error.name === "ChunkLoadError" ||
    /loading (css )?chunk [\w-]+ failed|failed to fetch dynamically imported/i.test(
      error.message
    );

  useEffect(() => {
    console.error("[dashboard error]", error);
    if (!isChunkError) return;
    try {
      // Bounded retries within a short window so a genuinely broken build can't
      // loop forever showing "Ładuję nową wersję". The window auto-expires, so a
      // fresh chunk error later (after another deploy) recovers again.
      const KEY = "chunkReload";
      const now = Date.now();
      let state = { at: 0, n: 0 };
      try {
        state = { ...state, ...JSON.parse(sessionStorage.getItem(KEY) || "{}") };
      } catch {
        /* ignore malformed state */
      }
      // Reset the counter if the last attempt was long ago (recovery succeeded
      // in between, or this is a brand-new incident).
      if (now - state.at > 30_000) state.n = 0;

      if (state.n >= 3) return; // give up auto-reloading; show manual button

      sessionStorage.setItem(KEY, JSON.stringify({ at: now, n: state.n + 1 }));

      // Cache-busting hard navigation: a plain reload() can be served the same
      // stale document/chunks from cache. A unique query forces a fresh fetch.
      const url = new URL(window.location.href);
      url.searchParams.set("_cb", String(now));
      window.location.replace(url.toString());
    } catch {
      window.location.reload();
    }
  }, [error, isChunkError]);

  if (isChunkError) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-lg font-semibold">Ładuję nową wersję…</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Aplikacja została zaktualizowana. Za chwilę odświeży się automatycznie.
        </p>
        <button
          type="button"
          onClick={() => {
            try {
              sessionStorage.removeItem("chunkReload");
            } catch {
              /* ignore */
            }
            const url = new URL(window.location.href);
            url.searchParams.set("_cb", String(Date.now()));
            window.location.replace(url.toString());
          }}
          className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Odśwież teraz
        </button>
      </div>
    );
  }

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
