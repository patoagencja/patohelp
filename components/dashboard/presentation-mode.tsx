"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatInTimeZone } from "date-fns-tz";
import { pl } from "date-fns/locale";
import { ChevronLeft, ChevronRight, MonitorPlay, Pause, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
 * - `data-present-current` - set on the slide being shown (entrance motion,
 *   dimming the others); removed on exit.
 *
 * 2026 look (Prezentacja-2030): the show always runs on the dark cinematic
 * canvas - the page switches to the dark theme for its duration (restored
 * on exit), a stage of drifting blobs + grain sits behind the sections, a
 * header names the client and the month with a slide counter and
 * "Zakończ", and a footer carries a segmented progress bar (one segment per
 * slide, click to jump), "Autoodtwarzanie" and round prev/next buttons.
 */

const SLIDE_ATTR = "data-present-slide";
const CURRENT_ATTR = "data-present-current";
// One slide every 9 s while autoplay runs (the board's timing).
const AUTOPLAY_MS = 9000;

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
  if (!(el instanceof HTMLElement) || el.hasAttribute("data-present-hide")) return false;
  if (el.getClientRects().length === 0) return false;
  // An sr-only page heading (1px) is not a slide.
  const rect = el.getBoundingClientRect();
  return rect.height > 2 && rect.width > 2;
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

function markCurrent(slides: HTMLElement[], index: number) {
  const current = slides[index];
  document.querySelectorAll(`[${CURRENT_ATTR}]`).forEach((el) => {
    if (el !== current) el.removeAttribute(CURRENT_ATTR);
  });
  // Only (re)set when it changes: re-adding restarts the entrance motion.
  if (current && !current.hasAttribute(CURRENT_ATTR)) current.setAttribute(CURRENT_ATTR, "");
}

function clearSlides() {
  document
    .querySelectorAll(`[${SLIDE_ATTR}], [${CURRENT_ATTR}]`)
    .forEach((el) => {
      el.removeAttribute(SLIDE_ATTR);
      el.removeAttribute(CURRENT_ATTR);
    });
}

const pad = (n: number) => String(n).padStart(2, "0");

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

export function PresentationMode({
  brand,
  className,
  labelClassName = "hidden sm:inline",
}: {
  /** The client's mark, shown top-left while presenting so the TV shows
   *  whose report this is once the sidebar and header are gone. */
  brand?: React.ReactNode;
  /** Trigger styling (the 2026 chrome sizes it per breakpoint). */
  className?: string;
  /** Where the "Prezentuj" word shows; the icon always does. */
  labelClassName?: string;
} = {}) {
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
  const goToRef = useRef<((index: number) => void) | null>(null);
  const [autoplay, setAutoplay] = useState(false);
  // Bumped on every move so the autoplay timer (and the running segment)
  // restarts from zero after a manual step too.
  const [moves, setMoves] = useState(0);
  const [stageHost, setStageHost] = useState<Element | null>(null);

  const exit = useCallback(() => {
    setActive(false);
    setAutoplay(false);
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
    // The show always runs on the dark canvas; the viewer's own theme comes
    // back on exit (the theme toggle is hidden meanwhile).
    const addedDark = !root.classList.contains("dark");
    if (addedDark) root.classList.add("dark");
    // The stage goes inside the shell's stacking context (it is `isolate`
    // with its own background), right behind the sections.
    setStageHost(document.querySelector("main")?.parentElement ?? document.body);
    // The trigger is about to be hidden; a lingering focus there would make
    // Space press an invisible button instead of advancing.
    (document.activeElement as HTMLElement | null)?.blur?.();

    return () => {
      root.removeAttribute("data-present");
      if (addedDark) root.classList.remove("dark");
      setStageHost(null);
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
      markCurrent(slides, index);
      setPosition((p) => (p.index === index && p.total === slides.length ? p : { index, total: slides.length }));
      return slides;
    }

    function goTo(slides: HTMLElement[], index: number) {
      const target = slides[index];
      if (!target) return;
      navRef.current = { index, until: Date.now() + 900 };
      markCurrent(slides, index);
      setPosition({ index, total: slides.length });
      setMoves((m) => m + 1);
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
            setMoves((m) => m + 1);
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
        case "ArrowRight":
        case "PageDown":
          e.preventDefault();
          step(1);
          break;
        case "ArrowUp":
        case "ArrowLeft":
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
    goToRef.current = (index: number) => goTo(refresh(), index);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
      stepRef.current = null;
      goToRef.current = null;
    };
  }, [active, exit]);

  // Autoplay: one step per AUTOPLAY_MS; from the last slide it starts over.
  useEffect(() => {
    if (!active || !autoplay) return;
    const id = window.setTimeout(() => {
      if (position.total > 0 && position.index >= position.total - 1 && atPageBottom()) {
        goToRef.current?.(0);
      } else {
        stepRef.current?.(1);
      }
    }, AUTOPLAY_MS);
    return () => window.clearTimeout(id);
  }, [active, autoplay, moves, position.index, position.total]);

  const month = active
    ? formatInTimeZone(new Date(), "Europe/Warsaw", "LLLL yyyy", { locale: pl })
    : "";
  const segments = Array.from({ length: position.total }, (_, i) => i);
  const roundGlass =
    "glass glass-blur grid size-11 shrink-0 place-items-center !rounded-full transition-[transform,background-color] hover:bg-[var(--chip-hover)] active:scale-95 motion-reduce:active:scale-100 sm:size-[clamp(2.75rem,3.75vw,4.5rem)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background";

  const bar =
    active && typeof document !== "undefined"
      ? createPortal(
          <>
            {/* Header: whose report, which month, where we are, the way out. */}
            <div
              className="fixed inset-x-0 top-0 z-[60] bg-gradient-to-b from-black/70 via-black/35 to-transparent pb-8 text-foreground print:hidden"
            >
              <div className="mx-auto flex max-w-[120rem] items-center gap-3 px-4 pt-3 sm:gap-[18px] sm:px-[clamp(1.5rem,5vw,6rem)] sm:pt-[clamp(1rem,4vh,4rem)]">
                {brand ? (
                  <div className="flex min-w-0 max-w-[45%] shrink items-center [&_img]:max-h-8 sm:max-w-[16rem]">
                    {brand}
                  </div>
                ) : null}
                <span className="hidden truncate font-mono text-[clamp(.75rem,.85vw,1rem)] uppercase tracking-[.1em] text-ink-3 md:inline">
                  · Raport · {month}
                </span>
                <span className="flex-1" />
                <span className="font-mono text-[clamp(.8rem,.95vw,1.1rem)] tabular-nums text-ink-3" aria-live="polite">
                  <span className="sr-only">Slajd </span>
                  <b className="font-medium text-foreground">{position.total > 0 ? pad(position.index + 1) : "–"}</b>
                  {" / "}
                  {position.total > 0 ? pad(position.total) : "–"}
                </span>
                <button
                  type="button"
                  onClick={exit}
                  title="Zakończ prezentację (Esc)"
                  className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-chip px-[22px] text-[15px] transition-colors hover:bg-[var(--chip-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-[52px] sm:text-[17px]"
                >
                  Zakończ
                </button>
              </div>
            </div>

            {/* Footer: progress per slide, autoplay, prev / next. */}
            <div
              role="toolbar"
              aria-label="Sterowanie prezentacją"
              className="fixed inset-x-0 bottom-0 z-[60] bg-gradient-to-t from-black/70 via-black/35 to-transparent pt-10 text-foreground print:hidden"
            >
              <div className="mx-auto flex max-w-[120rem] items-center gap-2 px-4 pb-4 sm:gap-[clamp(1rem,2vw,2.5rem)] sm:px-[clamp(1.5rem,5vw,6rem)] sm:pb-[clamp(1rem,5vh,3.5rem)]">
                <div className="flex min-w-0 flex-1 gap-1.5 sm:gap-3">
                  {segments.map((i) => {
                    const state = i < position.index ? "done" : i === position.index ? "current" : "next";
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => goToRef.current?.(i)}
                        aria-label={`Slajd ${i + 1}`}
                        aria-current={state === "current" ? "step" : undefined}
                        className="group flex h-11 min-w-0 flex-1 items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="block h-1 w-full overflow-hidden rounded-full bg-foreground/15 transition-colors group-hover:bg-foreground/25">
                          <i
                            // Remount restarts the 9 s fill on every move.
                            key={state === "current" && autoplay ? `run-${moves}` : state}
                            className={cn(
                              "block h-full rounded-full bg-lime shadow-[0_0_12px_var(--lime-glow)]",
                              state === "done" && "w-full",
                              state === "next" && "w-0",
                              state === "current" &&
                                (autoplay
                                  ? "w-full origin-left motion-safe:animate-[grow_9s_linear_both]"
                                  : "w-full")
                            )}
                          />
                        </span>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAutoplay((a) => !a);
                    setMoves((m) => m + 1);
                  }}
                  aria-pressed={autoplay}
                  aria-label={autoplay ? "Zatrzymaj autoodtwarzanie" : "Włącz autoodtwarzanie"}
                  className="glass glass-blur inline-flex h-11 shrink-0 items-center justify-center gap-2.5 !rounded-full px-3.5 text-[15px] transition-[transform,background-color] hover:bg-[var(--chip-hover)] active:scale-95 motion-reduce:active:scale-100 sm:h-[clamp(2.75rem,3.75vw,4.5rem)] sm:px-[26px] sm:text-[17px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
                >
                  {autoplay ? (
                    <Pause className="size-[18px]" aria-hidden />
                  ) : (
                    <Play className="size-[18px]" aria-hidden />
                  )}
                  <span className="hidden sm:inline">{autoplay ? "Pauza" : "Autoodtwarzanie"}</span>
                </button>
                <button
                  type="button"
                  className={roundGlass}
                  onClick={() => stepRef.current?.(-1)}
                  aria-label="Poprzedni slajd"
                  title="Poprzedni slajd (↑ / ←)"
                >
                  <ChevronLeft className="size-[22px] sm:size-[26px]" aria-hidden strokeWidth={2} />
                </button>
                <button
                  type="button"
                  className="grid size-11 shrink-0 place-items-center rounded-full bg-lime text-lime-foreground shadow-[0_16px_50px_-12px_var(--lime-glow)] transition-transform active:scale-95 motion-reduce:active:scale-100 sm:size-[clamp(2.75rem,3.75vw,4.5rem)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
                  onClick={() => stepRef.current?.(1)}
                  aria-label="Następny slajd"
                  title="Następny slajd (↓ / → / spacja)"
                >
                  <ChevronRight className="size-[22px] sm:size-[26px]" aria-hidden strokeWidth={2.2} />
                </button>
              </div>
            </div>
          </>,
          document.body
        )
      : null;

  // The cinematic canvas: dark, three drifting blobs and a grain of dots.
  // Behind the sections, above the shell's own background; decorative.
  const stage =
    active && stageHost
      ? createPortal(
          <div aria-hidden className="pointer-events-none fixed inset-0 -z-[9] overflow-hidden bg-background print:hidden">
            <span className="absolute inset-0 bg-black/55" />
            <span className="sky-blob left-[-16%] top-[-33%] h-[74vh] w-[57vw] bg-lime/40 [animation-duration:24s]" />
            <span className="sky-blob right-[-14%] top-[-24%] h-[65vh] w-[47vw] bg-coral/25 [animation-duration:30s]" />
            <span className="sky-blob bottom-[-39%] left-[40%] h-[65vh] w-[52vw] bg-violet/30 [animation-duration:36s]" />
            <span className="absolute inset-0 bg-[radial-gradient(var(--dots)_1px,transparent_1.3px)] bg-[length:30px_30px] [mask-image:radial-gradient(80%_80%_at_50%_40%,black,transparent)]" />
          </div>,
          stageHost
        )
      : null;

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        // The header's one dark "anchor" pill (v2 skin).
        variant="default"
        size="pill"
        className={cn("gap-2", className)}
        onClick={() => (active ? exit() : void enter())}
        aria-pressed={active}
        aria-label="Prezentuj"
        title="Tryb prezentacji - pełny ekran na TV/rzutnik"
      >
        <MonitorPlay className="!h-[17px] !w-[17px]" aria-hidden strokeWidth={1.8} />
        <span className={labelClassName}>Prezentuj</span>
      </Button>
      {stage}
      {bar}
    </>
  );
}
