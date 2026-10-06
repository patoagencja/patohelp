"use client";

import { ArrowRight, HelpCircle } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/utils";

/**
 * "Jak czytać ten panel" - a five-stop walkthrough for client users who are
 * marketing managers, not analysts. It points at real elements instead of
 * describing them, so it never drifts from what is on screen: a step whose
 * target isn't rendered (e.g. no date picker in the demo) is simply skipped.
 *
 * Hand-rolled (like InfoTip) because the stack has no tour/popover primitive
 * and a dependency for one onboarding flow isn't worth it.
 */

// Bump the suffix when the steps change enough to be worth showing again.
const STORAGE_KEY = "pato:guided-tour:v1";
// Below Tailwind's `sm` the card turns into a bottom sheet.
const MOBILE_MAX = 640;
const EDGE = 16;
const GAP = 14;
const DESKTOP_CARD_W = 352;

type Placement = "bottom" | "top" | "right" | "left";

type Step = {
  title: string;
  body: string;
  find: () => HTMLElement | null;
  /** Placement order to try; defaults to below, then above. */
  prefer?: Placement[];
  pad?: number;
};

function isShown(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function firstShown(selector: string): HTMLElement | null {
  for (const el of Array.from(document.querySelectorAll(selector))) {
    if (isShown(el)) return el;
  }
  return null;
}

const INFO_BUTTON = 'button[aria-label^="Co to znaczy"], button[aria-label^="What is"]';

/**
 * The ⓘ of the first KPI card. Other sections also carry ⓘ buttons, so look
 * for a Tremor card that sits in a grid of 3+ cards (the KPI row) first.
 */
function findKpiInfoButton(): HTMLElement | null {
  const cards = Array.from(document.querySelectorAll<HTMLElement>("main .tremor-Card-root"));
  for (const card of cards) {
    const parent = card.parentElement;
    if (!parent) continue;
    const siblingCards = Array.from(parent.children).filter((c) =>
      c.classList.contains("tremor-Card-root")
    ).length;
    if (siblingCards < 3) continue;
    const btn = card.querySelector(INFO_BUTTON);
    if (isShown(btn)) return btn;
  }
  return firstShown(`main :is(${INFO_BUTTON})`);
}

const STEPS: Step[] = [
  {
    title: "Najważniejsze w skrócie",
    body: "Tu w jednym zdaniu: ile wydaliśmy, co z tego mamy i czy to dobry wynik. Zacznij od tego miejsca.",
    find: () => firstShown('section[aria-label="Najważniejsze w skrócie"]'),
  },
  {
    title: "Wybierz okres",
    body: "Zmień okres - wszystko na stronie się przeliczy.",
    find: () => firstShown('[role="radiogroup"][aria-label="Zakres dat"]'),
  },
  {
    title: "Co znaczy ten wskaźnik?",
    body: "Najedź kursorem na ⓘ albo je kliknij - wyjaśnimy wskaźnik prostymi słowami.",
    find: findKpiInfoButton,
    pad: 8,
  },
  {
    title: "Tryb prezentacji",
    body: "Pokaż panel na spotkaniu - pełny ekran, duże liczby.",
    find: () => firstShown('button[aria-label="Prezentuj"]'),
  },
  {
    title: "Więcej szczegółów",
    body: "Reklamy, kreacje i ruch na stronie mają własne zakładki ze szczegółami.",
    // The top bar's section pill (md+) or the phone's floating tab bar,
    // whichever is visible.
    find: () => firstShown('nav[aria-label="Sekcje"], nav[aria-label="Nawigacja"]'),
    prefer: ["bottom", "top", "right", "left"],
  },
];

type Hole = { top: number; left: number; width: number; height: number; radius: number };
type CardPos =
  | { kind: "float"; top: number; left: number }
  | { kind: "sheet" }
  | { kind: "sheet-raised"; bottom: number };
type Layout = { step: number; mobile: boolean; hole: Hole | null; card: CardPos };

function presenting(): boolean {
  return document.documentElement.getAttribute("data-present") === "true";
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Elements in a fixed/sticky layer don't move with the page, so scrolling
// them "into view" would only yank the page around.
function inFixedLayer(el: HTMLElement): boolean {
  for (let n: HTMLElement | null = el; n && n !== document.body; n = n.parentElement) {
    const pos = getComputedStyle(n).position;
    if (pos === "fixed" || pos === "sticky") return true;
  }
  return false;
}

function holeFor(el: HTMLElement, pad: number): Hole {
  const r = el.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  // Keep the outline inside the viewport so edge targets (header button,
  // full-height sidebar) still show their whole ring.
  const top = Math.max(2, r.top - pad);
  const left = Math.max(2, r.left - pad);
  const width = Math.min(vw - 2, r.right + pad) - left;
  const height = r.bottom + pad - top;
  // Follow the target's own corner shape so the cut-out feels traced, not boxed.
  const own = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 8;
  return {
    top,
    left,
    width,
    height,
    radius: Math.min(own + pad, Math.min(width, height) / 2),
  };
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function placeCard(
  hole: Hole | null,
  w: number,
  h: number,
  vw: number,
  vh: number,
  prefer: Placement[]
): CardPos {
  if (!hole) {
    return { kind: "float", top: (vh - h) / 2, left: (vw - w) / 2 };
  }
  const bottom = hole.top + hole.height;
  const right = hole.left + hole.width;
  const centerX = hole.left + hole.width / 2;
  const xUnderOver = clamp(centerX - w / 2, EDGE, vw - w - EDGE);
  const ySide = clamp(hole.top, EDGE, vh - h - EDGE);

  for (const p of prefer) {
    if (p === "bottom" && bottom + GAP + h <= vh - EDGE) {
      return { kind: "float", top: bottom + GAP, left: xUnderOver };
    }
    if (p === "top" && hole.top - GAP - h >= EDGE) {
      return { kind: "float", top: hole.top - GAP - h, left: xUnderOver };
    }
    if (p === "right" && right + GAP + w <= vw - EDGE) {
      return { kind: "float", top: ySide, left: right + GAP };
    }
    if (p === "left" && hole.left - GAP - w >= EDGE) {
      return { kind: "float", top: ySide, left: hole.left - GAP - w };
    }
  }
  // Target fills the screen: pin the card to the bottom, still near its centre.
  return { kind: "float", top: vh - h - EDGE, left: xUnderOver };
}

function computeLayout(step: number, def: Step, el: HTMLElement | null, card: HTMLElement | null): Layout {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const mobile = vw < MOBILE_MAX;
  const hole = el ? holeFor(el, def.pad ?? 6) : null;
  const h = card?.offsetHeight ?? 180;

  if (mobile) {
    // The phone tab bar lives at the bottom; a sheet there would cover the
    // very thing we're pointing at, so lift the sheet above it.
    if (hole && hole.top > vh / 2 && hole.top - GAP - h >= EDGE) {
      return { step, mobile, hole, card: { kind: "sheet-raised", bottom: vh - hole.top + GAP } };
    }
    return { step, mobile, hole, card: { kind: "sheet" } };
  }
  const w = card?.offsetWidth ?? DESKTOP_CARD_W;
  return {
    step,
    mobile,
    hole,
    card: placeCard(hole, w, h, vw, vh, def.prefer ?? ["bottom", "top", "right", "left"]),
  };
}

/**
 * Scroll just enough that the target and the card are both readable.
 * Returns whether a scroll was started.
 */
function bringIntoView(el: HTMLElement, cardH: number): boolean {
  if (inFixedLayer(el)) return false;
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight;
  const mobile = document.documentElement.clientWidth < MOBILE_MAX;
  const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";

  if (mobile) {
    const free = vh - cardH - GAP;
    if (r.top >= EDGE && r.bottom <= free) return false;
    window.scrollTo({ top: Math.max(0, window.scrollY + r.top - 24), behavior });
    return true;
  }

  const roomBelow = r.bottom + GAP + cardH <= vh - EDGE;
  const roomAbove = r.top - GAP - cardH >= EDGE;
  if (r.top >= EDGE && r.bottom <= vh - EDGE && (roomBelow || roomAbove || r.height > vh / 2)) {
    return false;
  }
  const block = r.height + GAP + cardH;
  const top =
    block < vh - EDGE * 2
      ? window.scrollY + r.top - (vh - block) / 2
      : window.scrollY + r.top - 24;
  window.scrollTo({ top: Math.max(0, top), behavior });
  return true;
}

export function GuidedTour({
  isAgency,
  overviewPath,
}: {
  /** Agency staff know the panel; they get the button but no auto-start. */
  isAgency: boolean;
  /** The only route where the tour starts on its own, e.g. `/dre`. */
  overviewPath: string;
}) {
  const pathname = usePathname();
  const titleId = useId();
  const bodyId = useId();
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [index, setIndex] = useState(0);
  const [layout, setLayout] = useState<Layout | null>(null);
  // The spotlight glides between steps but must track scrolling 1:1, so
  // the CSS transition is only on for a moment after a step change.
  const [gliding, setGliding] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const layoutKeyRef = useRef("");

  const start = useCallback((): boolean => {
    const available = STEPS.filter((s) => s.find() !== null);
    if (!available.length) return false;
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
    targetRef.current = null;
    layoutKeyRef.current = "";
    setLayout(null);
    setSteps(available);
    setIndex(0);
    setOpen(true);
    return true;
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setLayout(null);
    targetRef.current = null;
    const back = returnFocusRef.current;
    returnFocusRef.current = null;
    if (back?.isConnected) back.focus({ preventScroll: true });
  }, []);

  const go = useCallback(
    (dir: 1 | -1) => {
      const next = index + dir;
      if (next < 0) return;
      // Finishing is the same as skipping, just friendlier wording.
      if (next >= steps.length) close();
      else setIndex(next);
    },
    [index, steps.length, close]
  );

  // Auto-start once per browser, on the overview only, for client users only.
  useEffect(() => {
    if (isAgency || pathname !== overviewPath) return;
    try {
      if (localStorage.getItem(STORAGE_KEY) !== null) return;
    } catch {
      // No storage means we can't remember it was shown - showing it on
      // every visit would be worse than not showing it at all.
      return;
    }
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      // Someone is mid-presentation on a TV; try again on a later visit.
      if (presenting()) return;
      // Sections stream in; wait (briefly) for the first ones to land.
      const ready = STEPS[0].find() ?? findKpiInfoButton();
      if (!ready && tries++ < 12) {
        timer = setTimeout(attempt, 400);
        return;
      }
      if (start()) {
        try {
          localStorage.setItem(STORAGE_KEY, new Date().toISOString());
        } catch {
          // Shown once this visit anyway.
        }
      }
    };
    timer = setTimeout(attempt, 900);
    return () => clearTimeout(timer);
  }, [isAgency, pathname, overviewPath, start]);

  // Replay from the ⌘K command palette ("Jak czytać panel").
  useEffect(() => {
    const onReplay = () => void start();
    window.addEventListener("pato:tour", onReplay);
    return () => window.removeEventListener("pato:tour", onReplay);
  }, [start]);

  // Navigating away mid-tour leaves nothing to point at.
  useEffect(() => {
    setOpen(false);
    setLayout(null);
  }, [pathname]);

  // Track the target every frame: covers scroll, resize, smooth-scroll in
  // flight and content shifting as data loads - with one cheap code path.
  useEffect(() => {
    if (!open) return;
    const def = steps[index];
    if (!def) return;
    let raf = 0;
    const tick = () => {
      if (presenting()) {
        close();
        return;
      }
      let el = targetRef.current;
      if (!el || !el.isConnected || !isShown(el)) {
        el = def.find();
        targetRef.current = el;
      }
      const next = computeLayout(index, def, el, cardRef.current);
      const key = JSON.stringify(next);
      if (key !== layoutKeyRef.current) {
        layoutKeyRef.current = key;
        setLayout(next);
      }
      raf = requestAnimationFrame(tick);
    };
    targetRef.current = null;
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, index, steps, close]);

  // On each step: scroll the target in, glide the spotlight, move focus.
  useEffect(() => {
    if (!open) return;
    const el = steps[index]?.find();
    const scrolled = el ? bringIntoView(el, cardRef.current?.offsetHeight ?? 180) : false;
    // While the page scrolls the spotlight must stick to the target; an
    // eased transition on top of a moving target would visibly trail it.
    setGliding(!scrolled);
    const glideTimer = setTimeout(() => setGliding(false), 450);
    primaryRef.current?.focus({ preventScroll: true });
    return () => clearTimeout(glideTimer);
  }, [open, index, steps]);

  // Keyboard: Esc closes, arrows step, Tab stays inside the card.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
        return;
      }
      if (e.key !== "Tab") return;
      const card = cardRef.current;
      if (!card) return;
      const focusables = Array.from(card.querySelectorAll<HTMLElement>("button:not([disabled])"));
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const inside = card.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    // Capture phase so page widgets (ⓘ bubbles, presentation keys) don't
    // also react while the tour owns the keyboard.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, close, go]);

  const def = steps[index];
  const isLast = index === steps.length - 1;
  const positioned = layout !== null && layout.step === index;
  const hole = positioned ? layout.hole : null;

  const overlay =
    open && def && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed inset-0 z-[80] print:hidden">
            {/* Swallows clicks so a stray tap can't change the page under
                the tour; scrolling still passes through to the page. */}
            <div
              aria-hidden
              className={cn(
                "absolute inset-0 animate-in fade-in-0 duration-300 motion-reduce:animate-none",
                !hole && "bg-black/50"
              )}
            />
            {hole ? (
              <div
                aria-hidden
                style={{
                  top: hole.top,
                  left: hole.left,
                  width: hole.width,
                  height: hole.height,
                  borderRadius: hole.radius,
                }}
                className={cn(
                  "pointer-events-none fixed shadow-[0_0_0_9999px_rgb(0_0_0/0.5)] ring-2 ring-lime ring-offset-0 animate-in fade-in-0 duration-300 motion-reduce:animate-none dark:shadow-[0_0_0_9999px_rgb(0_0_0/0.65)]",
                  gliding &&
                    "transition-[top,left,width,height,border-radius] duration-300 ease-out motion-reduce:transition-none"
                )}
              />
            ) : null}

            <p className="sr-only" aria-live="polite">
              {`Krok ${index + 1} z ${steps.length}: ${def.title}`}
            </p>

            <div
              key={index}
              ref={cardRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={bodyId}
              style={
                layout?.card.kind === "float"
                  ? { top: layout.card.top, left: layout.card.left }
                  : layout?.card.kind === "sheet-raised"
                    ? { bottom: layout.card.bottom }
                    : undefined
              }
              className={cn(
                "fixed border border-hairline bg-popover text-popover-foreground shadow-raised",
                layout?.mobile
                  ? layout.card.kind === "sheet-raised"
                    ? "inset-x-2 rounded-card p-5"
                    : "inset-x-0 bottom-0 rounded-t-card border-x-0 border-b-0 px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5"
                  : "w-[22rem] rounded-card p-6",
                positioned
                  ? cn(
                      "animate-in fade-in-0 duration-300 motion-reduce:animate-none",
                      layout?.mobile ? "slide-in-from-bottom-4" : "slide-in-from-bottom-1 zoom-in-[0.98]"
                    )
                  : "pointer-events-none opacity-0"
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <Pill tone="accent">
                  <HelpCircle aria-hidden />
                  Jak czytać panel
                </Pill>
                {!isLast ? (
                  <button
                    type="button"
                    onClick={close}
                    className="-mr-1.5 rounded-full px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Pomiń
                  </button>
                ) : null}
              </div>

              <h2 id={titleId} className="mt-3 text-section-title">
                {def.title}
              </h2>
              <p id={bodyId} className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {def.body}
              </p>

              <div className="mt-5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5" aria-hidden>
                  {steps.map((s, i) => (
                    <span
                      key={s.title}
                      className={cn(
                        "h-1.5 rounded-full transition-all duration-300 motion-reduce:transition-none",
                        i === index ? "w-4 bg-anchor" : "w-1.5 bg-muted-foreground/25"
                      )}
                    />
                  ))}
                </div>
                <span className="sr-only">{`Krok ${index + 1} z ${steps.length}`}</span>
                <div className="flex items-center gap-1.5">
                  {index > 0 ? (
                    <Button type="button" variant="ghost" size="sm" className="h-8 px-3" onClick={() => go(-1)}>
                      Wstecz
                    </Button>
                  ) : null}
                  <Button
                    ref={primaryRef}
                    type="button"
                    size="sm"
                    className="h-8 gap-1.5 px-3.5"
                    onClick={() => go(1)}
                  >
                    {isLast ? "Gotowe" : "Dalej"}
                    {!isLast ? <ArrowRight aria-hidden /> : null}
                  </Button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => (open ? close() : void start())}
        aria-label="Jak czytać panel"
        title="Jak czytać panel"
      >
        <HelpCircle className="h-4 w-4" aria-hidden />
      </Button>
      {overlay}
    </>
  );
}
