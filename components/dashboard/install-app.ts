"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * "Zainstaluj aplikację": puts the panel on the phone's home screen.
 * Chrome / Android (and desktop Chrome, Edge) fire `beforeinstallprompt`
 * once, often before any menu is open - it is caught here at module load
 * and replayed when the item is tapped. iPhone Safari has no such event:
 * there the item explains the two taps in the share sheet instead.
 */

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    // Our menu item offers the install; the browser's own bar would ask twice.
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

export type InstallMode = "prompt" | "ios" | null;

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch points give it away.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** null = nothing to offer (already installed, or the browser can't install). */
export function useInstallApp(): { mode: InstallMode; install: () => void } {
  const [mode, setMode] = useState<InstallMode>(null);

  useEffect(() => {
    const update = () => setMode(isStandalone() ? null : deferred ? "prompt" : isIos() ? "ios" : null);
    update();
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);

  const install = useCallback(() => {
    if (deferred) {
      const ev = deferred;
      deferred = null;
      void ev
        .prompt()
        .then(() => ev.userChoice)
        .then(({ outcome }) => {
          if (outcome === "accepted") toast.success("Kaleido jest na ekranie głównym.");
        })
        .catch(() => undefined)
        .finally(notify);
      return;
    }
    toast("Dodaj Kaleido do ekranu głównego", {
      description: "Stuknij „Udostępnij” (kwadrat ze strzałką w górę) na dole ekranu, a potem „Do ekranu początkowego”.",
      duration: 9000,
    });
  }, []);

  return { mode, install };
}
