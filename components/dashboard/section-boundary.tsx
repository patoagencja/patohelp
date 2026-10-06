"use client";

import { Component, Suspense, type ErrorInfo, type ReactNode } from "react";
import { CloudOff, RotateCw } from "lucide-react";

/**
 * Keeps one failing widget from taking the whole dashboard down. Without it a
 * throw in any section (a bad row, a timed-out query in a streamed async
 * server component) bubbles to the route's error.tsx and the client sees a
 * full-page error instead of the 90% of the panel that works. Errors thrown
 * by (async) server components land here too: React serialises them into the
 * RSC payload and rethrows them at the nearest client boundary.
 */
export class SectionBoundary extends Component<
  {
    children: ReactNode;
    /** Short English name for logs, e.g. "overview/records". */
    name: string;
  },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The digest links this to the server log when the throw came from RSC.
    console.error(`[section:${this.props.name}]`, error, info.componentStack);
  }

  render() {
    if (!this.state.failed) {
      // Error boundaries don't run during SSR: a throw there would fail the
      // whole page shell. The Suspense boundary makes React bail out to
      // client rendering for just this subtree instead, where the throw
      // lands in this boundary. Content that renders fine is unaffected.
      return <Suspense fallback={null}>{this.props.children}</Suspense>;
    }
    // v2: a calm muted panel in the card radius, so a failed section keeps
    // the page's rhythm instead of looking like a broken box.
    return (
      <div
        role="status"
        className="flex flex-col items-start gap-3 rounded-card bg-muted/60 px-5 py-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:px-6"
      >
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card shadow-card"
        >
          <CloudOff className="h-4 w-4" />
        </span>
        <p className="min-w-0 flex-1 leading-relaxed">
          <span className="font-medium text-foreground">Tej sekcji nie udało się wczytać.</span>{" "}
          Reszta panelu działa - odśwież za chwilę.
        </p>
        <button
          type="button"
          data-print-hide
          onClick={() => window.location.reload()}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-card px-4 text-sm font-medium text-foreground shadow-card transition-colors duration-150 hover:bg-anchor hover:text-anchor-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden />
          Odśwież
        </button>
      </div>
    );
  }
}
