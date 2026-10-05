"use client";

import { Component, Suspense, type ErrorInfo, type ReactNode } from "react";
import { CloudOff } from "lucide-react";

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
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-xl border border-dashed border-border bg-card px-4 py-3 text-sm text-muted-foreground"
      >
        <CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>Tej sekcji nie udało się wczytać - reszta panelu działa. Odśwież za chwilę.</p>
      </div>
    );
  }
}
