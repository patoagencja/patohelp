"use client";

import { useEffect, useId, useState } from "react";
import { ArrowUp, Sparkles } from "lucide-react";

import { openCommandPalette } from "@/components/dashboard/header-menu";
import type { QuickAnswer } from "@/lib/dashboard/quick-answers";
import { cn } from "@/lib/utils";

const SEEN_KEY = "pato:ai-comment-seen";
// Comments already revealed in this tab: a soft navigation back to the
// overview mounts without hydration and can skip the reveal right away.
const revealedThisTab = new Set<string>();

/** Cheap stable id for a text (the reveal is "first view per comment"). */
function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** The text as word spans that fade in one after another (CSS only). */
function Reveal({ text, delay = 0.6 }: { text: string; delay?: number }) {
  const words = text.split(/(\s+)/);
  let i = 0;
  return (
    <>
      {words.map((w, k) =>
        /^\s+$/.test(w) || w === "" ? (
          w
        ) : (
          <span
            key={k}
            className="reveal-word"
            style={{ "--i": i++, "--d": `${delay}s` } as React.CSSProperties}
          >
            {w}
          </span>
        )
      )}
    </>
  );
}

/**
 * The hero's AI card (Przeglad-pastel): the pastel orb, the agency's weekly
 * comment (generated once a day server-side - this component makes NO API
 * calls) revealed word by word on first view, quick-question chips and the
 * "Zapytaj o swoje dane… ⌘K" bar, which opens the command palette.
 *
 * Chips are answered deterministically from numbers already on the page
 * (lib/dashboard/quick-answers.ts) and labelled as such, never as Claude.
 * SSR paints the full text; reduced motion and print skip every animation;
 * the reveal plays once per comment (localStorage, applied before paint by
 * a tiny inline script so a returning visitor never sees it replay).
 */
export function OverviewAiCard({
  summary,
  questions,
  className,
}: {
  summary: { text: string; meta: string } | null;
  questions: QuickAnswer[];
  className?: string;
}) {
  const pid = useId().replace(/:/g, "");
  const [picked, setPicked] = useState<number>(-1);
  const [thinking, setThinking] = useState(false);
  const [isMac, setIsMac] = useState(true);

  const weekly =
    summary?.text ??
    "Komentarz tygodnia pojawi się, gdy zbierzemy pierwszy pełny tydzień danych. Do tego czasu odpowiemy na pytania poniżej.";
  const hash = hashText(weekly);
  // Hydration: false on both sides (the set is empty on a fresh load).
  const [revealed] = useState(() => typeof window !== "undefined" && revealedThisTab.has(hash));

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
    revealedThisTab.add(hash);
    try {
      localStorage.setItem(SEEN_KEY, hash);
    } catch {
      // Blocked storage: the reveal simply plays again next time.
    }
  }, [hash]);

  useEffect(() => {
    if (!thinking) return;
    const t = setTimeout(() => setThinking(false), 650);
    return () => clearTimeout(t);
  }, [thinking]);

  const answer = picked >= 0 ? questions[picked] : null;

  function pick(i: number) {
    if (i === picked) {
      setPicked(-1);
      setThinking(false);
      return;
    }
    setPicked(i);
    setThinking(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  return (
    <section
      aria-label="Komentarz tygodnia i szybkie odpowiedzi"
      className={cn(
        "glass glass-blur flex min-w-0 flex-col gap-[18px] rounded-glass p-6 animate-rise sm:p-[26px]",
        className
      )}
      style={{ "--d": ".3s" } as React.CSSProperties}
    >
      <div className="flex items-center gap-4">
        <span aria-hidden className="orb h-[52px] w-[52px] sm:h-[60px] sm:w-[60px]" data-busy={thinking}>
          <span className="orb-halo" />
          <span className="orb-ring" />
          <span className="orb-core" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold">{answer ? "Szybka odpowiedź" : summary ? "Claude" : "Komentarz tygodnia"}</p>
          <p className="text-[13px] text-ink-3">
            {thinking
              ? "liczy z danych na tej stronie…"
              : answer
                ? "Wyliczona z liczb na tej stronie, bez AI"
                : summary?.meta ?? "pisze go agencja z pomocą AI"}
          </p>
        </div>
        <span className="kick text-[10.5px]">{answer ? "Dane" : "AI"}</span>
      </div>

      {answer ? (
        <p className="max-w-[85%] self-end rounded-[18px_18px_6px_18px] bg-anchor px-3.5 py-2.5 text-sm text-anchor-foreground">
          {answer.question}
        </p>
      ) : null}

      <div aria-live="polite" className="min-h-[7.5rem] sm:min-h-[132px]">
        {thinking ? (
          <span aria-label="Liczymy" role="status" className="inline-flex gap-1 py-1.5">
            {[0, 1, 2].map((k) => (
              <i
                key={k}
                className="block h-1.5 w-1.5 rounded-full bg-[var(--ink-3)] animate-bob"
                style={{ animationDelay: `${k * 0.15}s` }}
              />
            ))}
          </span>
        ) : answer ? (
          <p key={answer.id} className="text-pretty text-[17px] leading-[1.55] tracking-[-0.01em]">
            <Reveal text={answer.answer} delay={0} />
          </p>
        ) : (
          <>
            <p
              id={pid}
              data-revealed={revealed ? "" : undefined}
              suppressHydrationWarning
              className="text-pretty text-[17px] leading-[1.55] tracking-[-0.01em]"
            >
              <Reveal text={weekly} />
            </p>
            {/* Before first paint: skip the reveal for a comment this
                browser has already seen (no flash, no replay). */}
            <script
              dangerouslySetInnerHTML={{
                __html: `try{if(localStorage.getItem(${JSON.stringify(SEEN_KEY)})===${JSON.stringify(
                  hash
                )})document.getElementById(${JSON.stringify(pid)}).setAttribute("data-revealed","")}catch(e){}`,
              }}
            />
          </>
        )}
      </div>

      {questions.length > 0 ? (
        <div className="flex flex-wrap gap-2" data-print-hide>
          {questions.map((q, i) => (
            <button
              key={q.id}
              type="button"
              aria-pressed={picked === i}
              onClick={() => pick(i)}
              className={cn(
                "inline-flex min-h-11 items-center gap-2 rounded-full px-[15px] text-[13.5px] transition-[background-color,color,transform] duration-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:active:scale-100",
                picked === i
                  ? "bg-anchor text-anchor-foreground"
                  : "bg-chip text-ink-2 hover:bg-anchor hover:text-anchor-foreground"
              )}
            >
              <Sparkles className="h-[13px] w-[13px]" strokeWidth={1.8} aria-hidden />
              {q.question}
            </button>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        data-print-hide
        onClick={openCommandPalette}
        className="mt-auto flex min-h-14 w-full items-center gap-3 rounded-full bg-chip py-1.5 pl-5 pr-1.5 text-left text-[15px] text-ink-3 transition-colors hover:bg-[var(--chip-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <span className="min-w-0 flex-1 truncate">Zapytaj o swoje dane…</span>
        <kbd className="hidden rounded-[7px] bg-chip px-[7px] py-[3px] font-mono text-xs text-ink-3 sm:inline">
          {isMac ? "⌘K" : "Ctrl K"}
        </kbd>
        <span
          aria-hidden
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-lime text-lime-foreground"
        >
          <ArrowUp className="h-4 w-4" strokeWidth={2.2} />
        </span>
      </button>
    </section>
  );
}
