"use client";

import { Component, Suspense, type ErrorInfo, type ReactNode } from "react";
import { RotateCw, TriangleAlert } from "lucide-react";

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
    // Stany board: the section's own glass card with a calm chip panel -
    // coral alert tile, plain words, "Spróbuj ponownie" - so a failed
    // section keeps the page's rhythm and says the rest is fine.
    return (
      <div role="status" className="glass rounded-card p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-4 rounded-[20px] bg-chip p-5 sm:p-[22px]">
          <span
            aria-hidden
            className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-negative-soft text-negative"
          >
            <TriangleAlert className="h-[18px] w-[18px]" strokeWidth={2.2} />
          </span>
          <div className="min-w-0 flex-[1_1_15rem]">
            <p className="text-[15px] font-semibold text-foreground">Nie udało się wczytać tej sekcji</p>
            <p className="mt-0.5 text-sm leading-relaxed text-ink-3">
              To chwilowy problem po naszej stronie. Pozostałe liczby na stronie są aktualne.
            </p>
          </div>
          <button
            type="button"
            data-print-hide
            onClick={() => window.location.reload()}
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-card px-[18px] text-sm font-medium text-foreground shadow-card transition-[background-color,color,transform] duration-200 hover:bg-anchor hover:text-anchor-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:active:scale-100 dark:bg-chip"
          >
            <RotateCw className="h-4 w-4" aria-hidden />
            Spróbuj ponownie
          </button>
        </div>
      </div>
    );
  }
}
