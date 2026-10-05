"use client";

import { useEffect, useRef } from "react";

import { SYNC_CHECK_EVENT } from "@/components/dashboard/auto-refresh";

// Fires the SAME per-client sync as the "Odśwież" button, automatically: once
// when the dashboard is opened (if it hasn't run in the last hour) and then
// hourly while the tab stays open. This is what keeps data current without the
// user clicking anything - the collective cron can under-serve a big account
// like OLX, so each client also pulls itself on open. Agency users only.
export function AutoSync({
  clientSlug,
  intervalMinutes = 60,
}: {
  clientSlug: string;
  intervalMinutes?: number;
}) {
  const running = useRef(false);

  useEffect(() => {
    const KEY = `autosync:${clientSlug}`;
    const INTERVAL = intervalMinutes * 60_000;

    async function run() {
      if (running.current) return;
      running.current = true;
      try {
        localStorage.setItem(KEY, String(Date.now()));
        await fetch(`/api/sync/run?client=${encodeURIComponent(clientSlug)}`, {
          method: "POST",
          cache: "no-store",
        }).catch(() => {});
        // The live indicator refreshes only if a new sync stamp landed, so
        // nudging it is cheap; the delayed nudges catch background jobs.
        const nudge = () => window.dispatchEvent(new Event(SYNC_CHECK_EVENT));
        nudge();
        setTimeout(nudge, 30_000);
        setTimeout(nudge, 90_000);
      } finally {
        running.current = false;
      }
    }

    // Trigger on open only if the last auto-sync was over an interval ago
    // (so reloading the page repeatedly doesn't hammer the APIs).
    let last = 0;
    try {
      last = Number(localStorage.getItem(KEY) || 0);
    } catch {
      /* ignore */
    }
    if (Date.now() - last > INTERVAL) run();

    const id = setInterval(run, INTERVAL);
    return () => clearInterval(id);
  }, [clientSlug, intervalMinutes]);

  return null;
}
