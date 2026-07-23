"use client";

import { useEffect, useState } from "react";

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
  // hashed JS files were purged from the CDN (typically while a new deploy is
  // still rolling out). We recover with a cache-busting reload, retried gently
  // with delays so we keep trying until the rollout settles instead of burning
  // through attempts in a couple of seconds and getting stuck.
  const isChunkError =
    error.name === "ChunkLoadError" ||
    /loading (css )?chunk [\w-]+ failed|failed to fetch dynamically imported/i.test(
      error.message
    );

  // Once auto-retries are exhausted we stop hiding the problem and reveal the
  // real error so it can be diagnosed instead of an eternal loader.
  const [gaveUp, setGaveUp] = useState(false);

  const MAX_ATTEMPTS = 5;
  const RETRY_DELAY_MS = 2500;

  function hardReload() {
    const url = new URL(window.location.href);
    url.searchParams.set("_cb", String(Date.now()));
    window.location.replace(url.toString());
  }

  useEffect(() => {
    console.error("[dashboard error]", error);
    if (!isChunkError) return;

    const KEY = "chunkReload";
    const now = Date.now();
    let state = { at: 0, n: 0 };
    try {
      state = { ...state, ...JSON.parse(sessionStorage.getItem(KEY) || "{}") };
    } catch {
      /* ignore malformed state */
    }
    // Fresh incident if the last attempt was a while ago (a previous recovery
    // succeeded, or a new deploy rolled out since).
    if (now - state.at > 120_000) state.n = 0;

    if (state.n >= MAX_ATTEMPTS) {
      setGaveUp(true);
      return;
    }

    try {
      sessionStorage.setItem(KEY, JSON.stringify({ at: now, n: state.n + 1 }));
    } catch {
      /* ignore */
    }

    // Delay before reloading: a chunk 404 usually clears within a few seconds
    // once the new deploy finishes propagating on the CDN.
    const t = setTimeout(hardReload, RETRY_DELAY_MS);
    return () => clearTimeout(t);
  }, [error, isChunkError]);

  if (isChunkError && !gaveUp) {
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
            hardReload();
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
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            try {
              sessionStorage.removeItem("chunkReload");
            } catch {
              /* ignore */
            }
            hardReload();
          }}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          Odśwież
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Spróbuj ponownie
        </button>
      </div>
    </div>
  );
}
