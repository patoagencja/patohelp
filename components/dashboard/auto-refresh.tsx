"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";

import { cn } from "@/lib/utils";

/** Fired by AutoSync when a manual/auto sync finishes, to check right away. */
export const SYNC_CHECK_EVENT = "pato:sync-check";
/** AutoRefresh -> <LiveStamp/>: a fresher sync stamp arrived. */
export const LIVE_STAMP_EVENT = "pato:live-stamp";
type LiveDetail = { stamp: string | null; pulse: boolean };

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
  headless = false,
}: {
  initialStamp: string | null;
  checkStamp: () => Promise<string | null>;
  pollSeconds?: number;
  /**
   * Poll only; the label is drawn by <LiveStamp/> wherever the chrome puts
   * it (desktop bar, phone header) - one poller, several labels.
   */
  headless?: boolean;
}) {
  const router = useRouter();
  const [stamp, setStamp] = useState(initialStamp);
  const [now, setNow] = useState(() => Date.now());
  const [pulse, setPulse] = useState(false);
  const [, startTransition] = useTransition();
  const stampRef = useRef(initialStamp);
  const busy = useRef(false);
  const lastRefreshAt = useRef(0);
  const pendingRefresh = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Providers land one after another (an "Odśwież"/AutoSync run moves the
  // stamp several times within a minute or two), and every refresh re-renders
  // the whole dashboard. Refresh at once for the first new stamp, then at
  // most once per MIN_GAP_MS - the last stamp in a burst still gets its
  // refresh, just coalesced with the ones before it.
  const refresh = useCallback(() => {
    const MIN_GAP_MS = 90_000;
    const run = () => {
      pendingRefresh.current = null;
      lastRefreshAt.current = Date.now();
      // Transition keeps the current screen interactive while fresh server
      // components stream in - no skeleton flash.
      startTransition(() => router.refresh());
    };
    if (pendingRefresh.current) return; // one is already scheduled
    const wait = lastRefreshAt.current + MIN_GAP_MS - Date.now();
    if (wait <= 0) run();
    else pendingRefresh.current = setTimeout(run, wait);
  }, [router]);

  useEffect(
    () => () => {
      if (pendingRefresh.current) clearTimeout(pendingRefresh.current);
    },
    []
  );

  // A server re-render (navigation, manual refresh) brings a fresher stamp.
  useEffect(() => {
    // A navigation already rendered the newest known stamp: a coalesced
    // refresh still waiting would only redo that work.
    if (initialStamp && initialStamp === stampRef.current && pendingRefresh.current) {
      clearTimeout(pendingRefresh.current);
      pendingRefresh.current = null;
      lastRefreshAt.current = Date.now();
    }
    if (initialStamp && initialStamp !== stampRef.current) {
      stampRef.current = initialStamp;
      setStamp(initialStamp);
      broadcast({ stamp: initialStamp, pulse: false });
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
        broadcast({ stamp: latest, pulse: true });
        setTimeout(() => {
          setPulse(false);
          broadcast({ stamp: latest, pulse: false });
        }, 1200);
        refresh();
      }
    } catch {
      // offline / transient - try again on the next tick
    } finally {
      busy.current = false;
    }
  }, [checkStamp, refresh]);

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

  if (headless) return null;

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

function broadcast(detail: LiveDetail) {
  window.dispatchEvent(new CustomEvent<LiveDetail>(LIVE_STAMP_EVENT, { detail }));
}

function liveLabel(iso: string | null, now: number): { text: string; fresh: boolean } {
  if (!iso) return { text: "Na żywo", fresh: true };
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return { text: "Na żywo · przed chwilą", fresh: true };
  if (minutes < 60) return { text: `Na żywo · ${minutes} min temu`, fresh: true };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { text: `Na żywo · ${hours} godz. temu`, fresh: hours <= 2 };
  return {
    text: `Dane z ${formatInTimeZone(new Date(iso), "Europe/Warsaw", "d.MM, HH:mm")}`,
    fresh: false,
  };
}

/**
 * 2026 chrome freshness cue: ping dot + "Na żywo · 5 min temu". Reads the
 * stamp <AutoRefresh headless/> broadcasts (SSR: `initialStamp`). `demo`
 * replaces the time with a fixed note (synthetic data has no sync).
 */
export function LiveStamp({
  initialStamp,
  demo,
  className,
  textClassName,
}: {
  initialStamp: string | null;
  demo?: string;
  className?: string;
  /** e.g. "hidden xl:inline" - the dot stays, the words fold away. */
  textClassName?: string;
}) {
  const [live, setLive] = useState<LiveDetail>({ stamp: initialStamp, pulse: false });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const onStamp = (e: Event) => setLive((e as CustomEvent<LiveDetail>).detail);
    window.addEventListener(LIVE_STAMP_EVENT, onStamp);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.removeEventListener(LIVE_STAMP_EVENT, onStamp);
      clearInterval(tick);
    };
  }, []);

  const { text, fresh } = demo
    ? { text: demo, fresh: true }
    : liveLabel(live.stamp, now);
  return (
    <span
      className={cn("flex items-center gap-2 whitespace-nowrap text-[13px] text-ink-3", className)}
      title="Dane odświeżają się same, gdy przyjdzie nowa synchronizacja"
    >
      <span
        aria-hidden
        className={cn("ping", !fresh && "ping-amber ping-still", live.pulse && "scale-125")}
      />
      <span className={textClassName} suppressHydrationWarning>
        {text}
      </span>
    </span>
  );
}
