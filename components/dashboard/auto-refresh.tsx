"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";

// Background auto-refresh - re-fetches the server components on an interval so
// the numbers re-animate and "Zaktualizowano" stays live, without the user
// clicking Odśwież. Pauses while the tab is hidden to avoid pointless work.
export function AutoRefresh({ intervalSeconds = 30 }: { intervalSeconds?: number }) {
  const router = useRouter();
  const [pulse, setPulse] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    function start() {
      stop();
      timer.current = setInterval(() => {
        if (document.visibilityState === "visible") {
          setPulse(true);
          router.refresh();
          setTimeout(() => setPulse(false), 800);
        }
      }, intervalSeconds * 1000);
    }
    function stop() {
      if (timer.current) clearInterval(timer.current);
    }

    start();
    document.addEventListener("visibilitychange", start);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", start);
    };
  }, [router, intervalSeconds]);

  return (
    <span
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      title={`Auto-odświeżanie co ${intervalSeconds}s`}
    >
      <span className="relative flex h-1.5 w-1.5">
        <span
          className={cn(
            "absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75",
            pulse ? "animate-ping" : "animate-pulse"
          )}
        />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
      </span>
      LIVE
    </span>
  );
}
