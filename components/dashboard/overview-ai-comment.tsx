"use client";

import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The weekly AI comment, folded to two lines so the summary stays a glance.
 * "Czytaj dalej" only appears when the text actually overflows; print always
 * gets the full text (the PDF has no buttons).
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
    <div>
      <p className="text-sm text-muted-foreground">{meta}</p>
      <p
        id={id}
        ref={ref}
        className={cn(
          "mt-1 max-w-3xl text-[15px] leading-relaxed text-foreground",
          !open && "line-clamp-2 print:line-clamp-none"
        )}
      >
        {text}
      </p>
      {overflows || open ? (
        <button
          type="button"
          data-print-hide
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
          className="mt-1 rounded-sm text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
  );
}
