"use client";

import "./globals.css";

import DashboardError from "./(dashboard)/[clientSlug]/error";

// Last line of defence: anything that escapes every route boundary (root
// layout, a navigation that died before any segment rendered) gets the same
// self-healing screen instead of Next's bare "Application error" text.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="pl">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <DashboardError error={error} reset={reset} />
      </body>
    </html>
  );
}
