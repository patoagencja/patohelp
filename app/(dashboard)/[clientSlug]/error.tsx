"use client";

import { useEffect, useState } from "react";
import { CloudOff, Loader2, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";

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
  // A navigation whose server stream was cut (slow page hitting the function
  // limit, flaky network) fails the same way and recovers the same way: a
  // fresh load of the page.
  const isChunkError =
    error.name === "ChunkLoadError" ||
    /loading (css )?chunk [\w-]+ failed|failed to fetch dynamically imported|connection closed|failed to fetch|load failed|networkerror|unexpected response was received from the server/i.test(
      error.message ?? ""
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

  function freshReload() {
    try {
      sessionStorage.removeItem("chunkReload");
    } catch {
      /* ignore */
    }
    hardReload();
  }

  // 2026 pastel: one frosted card in the page column - mono kicker, a
  // soft icon tile, plain words, the ink pill as the one primary action.
  if (isChunkError && !gaveUp) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4 py-10 sm:px-6">
        <div
          role="status"
          className="glass flex w-full max-w-[28rem] flex-col items-start gap-5 rounded-glass p-7 sm:p-10"
        >
          <span
            aria-hidden
            className="grid h-14 w-14 place-items-center rounded-[18px] bg-lime-soft text-positive"
          >
            <Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none" />
          </span>
          <div>
            <p className="kick">Nowa wersja panelu</p>
            <h1 className="mt-2 text-[26px] font-medium leading-tight tracking-[-0.03em]">Ładuję nową wersję…</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
              Aplikacja została zaktualizowana. Za chwilę odświeży się automatycznie.
            </p>
          </div>
          <Button type="button" size="pill" onClick={freshReload}>
            <RotateCw aria-hidden />
            Odśwież teraz
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-10 sm:px-6">
      <div
        role="alert"
        className="glass flex w-full max-w-[32rem] flex-col items-start gap-5 rounded-glass p-7 sm:p-10"
      >
        <span
          aria-hidden
          className="grid h-14 w-14 place-items-center rounded-[18px] bg-negative-soft text-negative"
        >
          <CloudOff className="h-6 w-6" />
        </span>
        <div>
          <p className="kick">Błąd widoku</p>
          <h1 className="mt-2 text-[26px] font-medium leading-tight tracking-[-0.03em]">Coś poszło nie tak</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-2 [text-wrap:pretty]">
            Nie udało się wczytać tego widoku. Spróbuj ponownie - jeśli błąd się
            powtarza, prześlij nam szczegóły poniżej.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="pill" onClick={reset}>
            <RotateCw aria-hidden />
            Spróbuj ponownie
          </Button>
          <Button type="button" variant="chip" size="pill" onClick={freshReload}>
            Odśwież stronę
          </Button>
        </div>
        <details className="group w-full">
          <summary className="-ml-3 inline-flex min-h-11 cursor-pointer list-none items-center rounded-full px-3 text-[13px] font-medium text-ink-3 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            Szczegóły techniczne
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-[18px] bg-chip p-4 font-mono text-xs text-ink-2">
            {error.message || "Nieznany błąd"}
            {error.digest ? `\n\ndigest: ${error.digest}` : ""}
          </pre>
        </details>
      </div>
    </div>
  );
}
