"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, MonitorPlay, X } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * "Tryb prezentacji" - managers put the dashboard on a TV/projector for the
 * board. Entering sets `data-present="true"` on <html>; every visual change
 * lives in the "Presentation mode" section of globals.css so server
 * components need no client state to react to it.
 *
 * Attribute conventions (documented again in globals.css):
 * - `data-present="true"` on <html>   - set while presenting.
 * - `data-present-hide` on any element - hidden while presenting (admin
 *   controls, banners, navigation chrome).
 * - `data-present-deck` on a container - its element children are the
 *   "slides" for keyboard navigation. Without it we take the first container
 *   inside <main> that has more than one visible child.
 * - `data-present-slide` - set by this component on the detected slides (used
 *   for spacing/scroll margin); removed on exit.
 */

const SLIDE_ATTR = "data-present-slide";

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

function fullscreenElement(): Element | null {
  const doc = document as FullscreenDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

async function requestFullscreen(): Promise<boolean> {
  const el = document.documentElement as FullscreenElement;
  try {
    if (el.requestFullscreen) {
      await el.requestFullscreen({ navigationUI: "hide" });
      return true;
    }
    if (el.webkitRequestFullscreen) {
      await el.webkitRequestFullscreen();
      return true;
    }
  } catch {
    // Denied (iframe without allowfullscreen, iOS Safari, policy) - the
    // in-page presentation layout still works, just with browser chrome.
  }
  return false;
}

function exitFullscreen() {
  const doc = document as FullscreenDocument;
  if (!fullscreenElement()) return;
  try {
    const p = doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.();
    if (p && typeof (p as Promise<void>).catch === "function") {
      (p as Promise<void>).catch(() => undefined);
    }
  } catch {
    // Already left fullscreen - nothing to undo.
  }
}

function isVisible(el: Element): boolean {
  return (
    el instanceof HTMLElement &&
    !el.hasAttribute("data-present-hide") &&
    el.getClientRects().length > 0
  );
}

/**
 * Pages differ in nesting (the client layout wraps the page in a padded div,
 * the demo puts sections straight into <main>), so walk down single-child
 * wrappers until we hit the level where sections sit side by side.
 */
function findSlides(): HTMLElement[] {
  let container: Element | null =
    document.querySelector("[data-present-deck]") ?? document.querySelector("main");
  if (!container) return [];
  if (!container.hasAttribute("data-present-deck")) {
    for (let depth = 0; depth < 4; depth++) {
      const visible: Element[] = Array.from(container.children).filter(isVisible);
      if (visible.length !== 1) break;
      container = visible[0];
    }
  }
  return Array.from(container.children).filter(isVisible) as HTMLElement[];
}

function markSlides(slides: HTMLElement[]) {
  document.querySelectorAll(`[${SLIDE_ATTR}]`).forEach((el) => {
    if (!slides.includes(el as HTMLElement)) el.removeAttribute(SLIDE_ATTR);
  });
  slides.forEach((el) => el.setAttribute(SLIDE_ATTR, ""));
}

function clearSlides() {
  document
    .querySelectorAll(`[${SLIDE_ATTR}]`)
    .forEach((el) => el.removeAttribute(SLIDE_ATTR));
}

function atPageBottom(): boolean {
  const root = document.documentElement;
  return window.innerHeight + window.scrollY >= root.scrollHeight - 4;
}

/** Index of the slide the audience is currently looking at. */
function currentIndex(slides: HTMLElement[]): number {
  if (!slides.length) return 0;
  // Short last sections can never reach the top of the viewport.
  if (atPageBottom()) return slides.length - 1;
  const line = window.innerHeight * 0.3;
  let idx = 0;
  slides.forEach((el, i) => {
    if (el.getBoundingClientRect().top <= line) idx = i;
  });
  return idx;
}

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}

// Keys must keep their normal meaning inside form controls and widgets
// (date picker, selects, sortable tables with focusable buttons, etc.).
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest("input, textarea, select, [role='listbox'], [role='menu'], [role='combobox'], [role='slider']")) {
    return true;
  }
  return false;
}

export function PresentationMode() {
  const [active, setActive] = useState(false);
  const [position, setPosition] = useState({ index: 0, total: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Programmatic smooth scrolls emit scroll events mid-flight; while one runs
  // the indicator follows the target index instead of the scroll position.
  const navRef = useRef<{ index: number; until: number }>({ index: 0, until: 0 });
  const enteredFullscreenRef = useRef(false);
  // Lets the floating bar reuse the keyboard stepping logic, which lives in
  // the effect because it closes over the per-session listeners.
  const stepRef = useRef<((dir: 1 | -1) => void) | null>(null);

  const exit = useCallback(() => {
    setActive(false);
  }, []);

  const enter = useCallback(async () => {
    setActive(true);
    // Fullscreen must be requested inside the click's user activation.
    enteredFullscreenRef.current = await requestFullscreen();
  }, []);

  // Started from the ⌘K command palette ("Prezentuj"). Dispatched inside the
  // keypress/click, so the fullscreen request still has user activation.
  useEffect(() => {
    if (active) return;
    const onPresent = () => void enter();
    window.addEventListener("pato:present", onPresent);
    return () => window.removeEventListener("pato:present", onPresent);
  }, [active, enter]);

  // Apply / undo the page-wide state. Kept in one effect so every way out
  // (button, Escape, fullscreenchange, unmount on navigation) restores it.
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.setAttribute("data-present", "true");
    // The trigger is about to be hidden; a lingering focus there would make
    // Space press an invisible button instead of advancing.
    (document.activeElement as HTMLElement | null)?.blur?.();

    return () => {
      root.removeAttribute("data-present");
      clearSlides();
      exitFullscreen();
      enteredFullscreenRef.current = false;
      triggerRef.current?.focus();
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;

    function refresh() {
      const slides = findSlides();
      markSlides(slides);
      const nav = navRef.current;
      const index =
        Date.now() < nav.until
          ? Math.min(nav.index, Math.max(0, slides.length - 1))
          : currentIndex(slides);
      setPosition({ index, total: slides.length });
      return slides;
    }

    function goTo(slides: HTMLElement[], index: number) {
      const target = slides[index];
      if (!target) return;
      navRef.current = { index, until: Date.now() + 900 };
      setPosition({ index, total: slides.length });
      target.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    }

    function step(dir: 1 | -1) {
      const slides = refresh();
      if (!slides.length) return;
      const nav = navRef.current;
      const base = Date.now() < nav.until ? nav.index : currentIndex(slides);
      const current = slides[base];
      if (current) {
        const rect = current.getBoundingClientRect();
        // A section taller than the screen (long table) is paged through
        // first, otherwise half of it would never be shown.
        if (dir === 1 && rect.bottom > window.innerHeight + 8 && !atPageBottom()) {
          const next = slides[base + 1];
          const nextTop = next ? next.getBoundingClientRect().top : Infinity;
          if (nextTop > window.innerHeight) {
            navRef.current = { index: base, until: Date.now() + 900 };
            window.scrollBy({
              top: Math.min(window.innerHeight * 0.8, nextTop - 32),
              behavior: scrollBehavior(),
            });
            return;
          }
        }
        if (dir === -1 && rect.top < -8) {
          goTo(slides, base);
          return;
        }
      }
      goTo(slides, Math.min(slides.length - 1, Math.max(0, base + dir)));
    }

    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      // Escape inside a picker/input should close that widget, not the show.
      if (isInteractiveTarget(e.target)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        exit();
        return;
      }
      const onButton =
        e.target instanceof HTMLElement && e.target.closest("button, a, [role='button']");

      switch (e.key) {
        case " ":
        case "Spacebar":
          // Space on a focused button should still press it.
          if (onButton) return;
          e.preventDefault();
          step(e.shiftKey ? -1 : 1);
          break;
        case "ArrowDown":
        case "PageDown":
          e.preventDefault();
          step(1);
          break;
        case "ArrowUp":
        case "PageUp":
          e.preventDefault();
          step(-1);
          break;
        case "Home":
          e.preventDefault();
          goTo(refresh(), 0);
          break;
        case "End": {
          e.preventDefault();
          const slides = refresh();
          goTo(slides, slides.length - 1);
          break;
        }
      }
    }

    function onFullscreenChange() {
      // Leaving fullscreen (browser Esc, F11, swipe) ends the presentation;
      // entering also fires this event, hence the check.
      if (enteredFullscreenRef.current && !fullscreenElement()) exit();
    }

    let frame = 0;
    function onScroll() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(refresh);
    }

    // Data refreshes (AutoRefresh, date range) can add or drop sections.
    const main = document.querySelector("main");
    const observer = new MutationObserver(onScroll);
    if (main) observer.observe(main, { childList: true, subtree: true });

    // Wait a frame so the presentation CSS (hidden chrome, new font size) has
    // laid out before we measure.
    frame = requestAnimationFrame(refresh);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);

    stepRef.current = step;

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
      stepRef.current = null;
    };
  }, [active, exit]);

  const bar =
    active && typeof document !== "undefined"
      ? createPortal(
          <div
            role="toolbar"
            aria-label="Sterowanie prezentacją"
            className="fixed bottom-5 right-5 z-[60] flex items-center gap-1 rounded-full border border-border bg-card/90 p-1 text-sm text-foreground opacity-40 shadow-lg backdrop-blur transition-opacity duration-300 focus-within:opacity-100 hover:opacity-100 print:hidden"
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 rounded-full p-0"
              onClick={() => stepRef.current?.(-1)}
              aria-label="Poprzednia sekcja"
              title="Poprzednia sekcja (↑)"
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <span
              className="min-w-[3.5rem] text-center tabular-nums text-muted-foreground"
              aria-live="polite"
            >
              {position.total > 0
                ? `${position.index + 1} / ${position.total}`
                : "–"}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 rounded-full p-0"
              onClick={() => stepRef.current?.(1)}
              aria-label="Następna sekcja"
              title="Następna sekcja (↓ / spacja)"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-1 h-8 gap-1.5 rounded-full px-3"
              onClick={exit}
              title="Zakończ prezentację (Esc)"
            >
              <X className="h-3.5 w-3.5" />
              Zakończ
            </Button>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => (active ? exit() : void enter())}
        aria-pressed={active}
        aria-label="Prezentuj"
        title="Tryb prezentacji - pełny ekran na TV/rzutnik"
      >
        <MonitorPlay className="h-4 w-4" />
        <span className="hidden sm:inline">Prezentuj</span>
      </Button>
      {bar}
    </>
  );
}
