"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";
import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

// Percentages in the comment ("o 16%", "+60%") become small tinted chips,
// like the key-number chips of the benchmark's AI banner (2.webp).
const PCT = /([+\-−]?\d+(?:[.,]\d+)?\s?%)/g;

function withChips(text: string) {
  return text.split(PCT).map((part, i) =>
    i % 2 === 1 ? (
      <span
        key={i}
        className="whitespace-nowrap rounded-md bg-ai-soft px-1 py-px font-semibold tabular-nums text-ai print:bg-transparent print:p-0"
      >
        {part}
      </span>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  );
}

/**
 * The weekly AI comment as the "Analiza AI" banner (v2 skin, benchmark 2):
 * a soft lavender -> pink wash, a chip saying it is AI-written, the text
 * folded to two lines. "Czytaj dalej" only appears when the text actually
 * overflows; print always gets the full text (the PDF has no buttons) and
 * no wash.
 */
export function AiComment({
  text,
  meta,
  lang = "pl",
}: {
  text: string;
  /** Muted line above: what this is and which days it covers. */
  meta: string;
  lang?: "pl" | "en";
}) {
  const id = useId();
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // Measured only while clamped; once open the button must stay.
      if (!el.classList.contains("line-clamp-2")) return;
      setOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  return (
    <div className="bg-ai-wash flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-start sm:gap-5 sm:p-5 print:border print:border-border">
      <span className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-xl bg-card/70 px-2.5 py-1.5 text-[13px] font-semibold text-ai shadow-sm dark:bg-card/40 print:shadow-none">
        <Sparkles className="h-4 w-4" aria-hidden />
        {lang === "en" ? "AI analysis" : "Analiza AI"}
      </span>
      <div className="min-w-0 sm:border-l sm:border-ai/15 sm:pl-5">
        <p className="text-[13px] text-muted-foreground">{meta}</p>
        <p
          id={id}
          ref={ref}
          className={cn(
            "mt-1 max-w-3xl text-[15px] leading-relaxed text-foreground",
            !open && "line-clamp-2 print:line-clamp-none"
          )}
        >
          {withChips(text)}
        </p>
        {overflows || open ? (
          <button
            type="button"
            data-print-hide
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen((v) => !v)}
            className="mt-1.5 rounded-sm text-sm font-semibold text-ai underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {open
              ? lang === "en"
                ? "Show less"
                : "Zwiń"
              : lang === "en"
                ? "Read more"
                : "Czytaj dalej"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
