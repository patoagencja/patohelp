"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";

import { cn } from "@/lib/utils";

/** Fired by AutoSync when a manual/auto sync finishes, to check right away. */
export const SYNC_CHECK_EVENT = "pato:sync-check";

function relativeLabel(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "Zaktualizowano przed chwilą";
  if (minutes < 60) return `Zaktualizowano ${minutes} min temu`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Zaktualizowano ${hours} godz. temu`;
  return `Zaktualizowano ${formatInTimeZone(new Date(iso), "Europe/Warsaw", "d.MM.yyyy HH:mm")}`;
}

/**
 * Live indicator. Re-rendering the whole dashboard every 30 s (the old
 * behaviour) re-ran every Supabase query and re-animated every number while
 * the data only changes when a sync lands (~every 30 min) - the main reason
 * the panel felt sluggish. Now we poll a one-row stamp and refresh only when
 * it moves; the "X min temu" label ticks locally.
 */
export function AutoRefresh({
  initialStamp,
  checkStamp,
  pollSeconds = 60,
}: {
  initialStamp: string | null;
  checkStamp: () => Promise<string | null>;
  pollSeconds?: number;
}) {
  const router = useRouter();
  const [stamp, setStamp] = useState(initialStamp);
  const [now, setNow] = useState(() => Date.now());
  const [pulse, setPulse] = useState(false);
  const [, startTransition] = useTransition();
  const stampRef = useRef(initialStamp);
  const busy = useRef(false);

  // A server re-render (navigation, manual refresh) brings a fresher stamp.
  useEffect(() => {
    if (initialStamp && initialStamp !== stampRef.current) {
      stampRef.current = initialStamp;
      setStamp(initialStamp);
    }
  }, [initialStamp]);

  const check = useCallback(async () => {
    if (busy.current || document.visibilityState !== "visible") return;
    busy.current = true;
    try {
      const latest = await checkStamp();
      if (latest && latest !== stampRef.current) {
        stampRef.current = latest;
        setStamp(latest);
        setPulse(true);
        setTimeout(() => setPulse(false), 1200);
        // Transition keeps the current screen interactive while fresh server
        // components stream in - no skeleton flash.
        startTransition(() => router.refresh());
      }
    } catch {
      // offline / transient - try again on the next tick
    } finally {
      busy.current = false;
    }
  }, [checkStamp, router]);

  useEffect(() => {
    const poll = setInterval(check, pollSeconds * 1000);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setNow(Date.now());
        check();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(SYNC_CHECK_EVENT, check);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(SYNC_CHECK_EVENT, check);
    };
  }, [check, pollSeconds]);

  return (
    // Quiet freshness cue: a green dot and "X min temu". The dot alone on
    // phones; the full sentence is in the title and for screen readers.
    <span
      className="flex items-center gap-2 text-xs text-muted-foreground"
      title="Dane odświeżają się same, gdy przyjdzie nowa synchronizacja"
    >
      <span className="relative flex h-2 w-2" aria-hidden>
        <span
          className={cn(
            "absolute inline-flex h-full w-full rounded-full bg-lime opacity-60",
            pulse ? "motion-safe:animate-ping" : "motion-safe:animate-pulse"
          )}
        />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-lime" />
      </span>
      {stamp ? (
        <span className="sr-only sm:not-sr-only" suppressHydrationWarning>
          {relativeLabel(stamp, now)}
        </span>
      ) : (
        <span className="sr-only">Dane na żywo</span>
      )}
    </span>
  );
}
