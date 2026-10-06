"use client";

import { Children, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, RotateCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { ContentSlide } from "@/components/dashboard/report/deck";
import { Button } from "@/components/ui/button";
import { iconButton } from "@/components/ui/primitives";
import type { RangeKey } from "@/lib/dashboard/ranges";
import { cn } from "@/lib/utils";

/**
 * Presentation-style viewer for the report deck: one slide on screen at a time,
 * navigated with arrows / keyboard / dots. The AI summary slide is injected
 * after the cover once generated. Printing ("Pobierz PDF") reveals every slide
 * so the full deck exports, one slide per page.
 *
 * Slides are designed at a fixed 16:9 size (max-w-5xl). On narrower screens
 * they are laid out at that design width and scaled down with CSS `zoom`, so
 * a phone shows the same slide in miniature instead of clipping the bottom
 * half of every chart and table. Print resets the zoom.
 */
const DESIGN_WIDTH = 1024;

export function ReportDeck({
  clientSlug,
  range,
  rangeLabel,
  foot,
  shareMode = false,
  children,
}: {
  clientSlug: string;
  range: RangeKey;
  rangeLabel: string;
  foot: string;
  /** Public share view: hides the AI-generate button (auth-only endpoint). */
  shareMode?: boolean;
  children: React.ReactNode;
}) {
  const staticSlides = useMemo(() => Children.toArray(children), [children]);
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [index, setIndex] = useState(0);
  const deckRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = deckRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      setScale(w > 0 ? Math.min(1, w / DESIGN_WIDTH) : 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Inject the AI summary slide right after the cover once it exists.
  const slides = useMemo(() => {
    if (!summary) return staticSlides;
    const aiSlide = (
      <ContentSlide
        key="ai-summary"
        title="Podsumowanie"
        subtitle={rangeLabel}
        section="Analiza AI"
        foot={foot}
      >
        <div className="space-y-4 text-[17px] leading-relaxed text-ink-2">
          {summary
            .replace(/[–—]/g, "-")
            .split(/\n\s*\n/)
            .map((para, i) => (
              <p key={i}>{para}</p>
            ))}
        </div>
      </ContentSlide>
    );
    return [staticSlides[0], aiSlide, ...staticSlides.slice(1)];
  }, [staticSlides, summary, rangeLabel, foot]);

  const total = slides.length;
  const active = Math.min(index, total - 1);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Arrow keys inside a field (month picker, date range) belong to it.
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, total - 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total]);

  async function generate() {
    setLoading(true);
    toast.loading("Generuję opis AI…", { id: "report" });
    try {
      const res = await fetch(
        `/api/report/generate?client=${clientSlug}&range=${range}`,
        { method: "POST" }
      );
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? "");
      setSummary(body.summary as string);
      setIndex(1); // jump to the freshly generated summary slide
      toast.success("Opis gotowy", { id: "report" });
    } catch {
      toast.error("Nie udało się wygenerować opisu", { id: "report" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {/* Toolbar (not printed) */}
      <div className="mx-auto mb-5 flex max-w-5xl flex-wrap items-center gap-2 print:hidden">
        {!shareMode ? (
          <Button onClick={generate} disabled={loading} size="pill" className="gap-2">
            <Sparkles className={cn("h-4 w-4", loading && "animate-pulse motion-reduce:animate-none")} aria-hidden />
            {loading ? "Generuję…" : summary ? "Wygeneruj ponownie" : "Generuj opis AI"}
          </Button>
        ) : null}
        <Button variant="chip" size="pill" onClick={() => window.print()} className="gap-2">
          <Download className="h-4 w-4" aria-hidden />
          Pobierz PDF
        </Button>
        <span className="flex-1" />
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className={cn(iconButton, "disabled:pointer-events-none disabled:opacity-40")}
            onClick={() => setIndex((i) => Math.max(i - 1, 0))}
            disabled={active === 0}
            aria-label="Poprzedni slajd"
          >
            <ChevronLeft aria-hidden />
          </button>
          <span className="min-w-[4.5rem] text-center font-mono text-[13px] tabular-nums text-ink-3" aria-live="polite">
            <b className="font-medium text-foreground">{String(active + 1).padStart(2, "0")}</b> /{" "}
            {String(total).padStart(2, "0")}
          </span>
          <button
            type="button"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-lime text-lime-foreground shadow-lime-glow transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 motion-reduce:active:scale-100"
            onClick={() => setIndex((i) => Math.min(i + 1, total - 1))}
            disabled={active === total - 1}
            aria-label="Następny slajd"
          >
            <ChevronRight className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </div>
      </div>

      {/* Slides: only the active one on screen; all of them when printing */}
      <div ref={deckRef}>
      <div
        className="deck relative print:![zoom:1]"
        style={scale < 1 ? { zoom: scale } : undefined}
      >
        {slides.map((slide, i) => (
          <div
            key={i}
            className={cn("deck-item", i !== active && "deck-inactive")}
          >
            {slide}
          </div>
        ))}

        {/* On-slide click zones for prev/next (screen only) */}
        <button
          type="button"
          aria-label="Poprzedni slajd"
          onClick={() => setIndex((i) => Math.max(i - 1, 0))}
          disabled={active === 0}
          tabIndex={-1}
          className="absolute inset-y-0 left-0 w-[8%] cursor-pointer disabled:cursor-default print:hidden"
        />
        <button
          type="button"
          aria-label="Następny slajd"
          onClick={() => setIndex((i) => Math.min(i + 1, total - 1))}
          disabled={active === total - 1}
          tabIndex={-1}
          className="absolute inset-y-0 right-0 w-[8%] cursor-pointer disabled:cursor-default print:hidden"
        />
      </div>
      </div>

      {/* Portrait phones get the slide in miniature; landscape doubles it. */}
      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-ink-3 sm:hidden landscape:hidden print:hidden">
        <RotateCw className="h-3.5 w-3.5" aria-hidden />
        Obróć telefon poziomo, żeby powiększyć slajd.
      </p>

      {/* Segmented progress (one segment per slide, click to jump) - the
          same control as the presentation mode. */}
      <div className="mx-auto mt-3 flex max-w-5xl gap-1.5 print:hidden">
        {slides.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Slajd ${i + 1}`}
            aria-current={i === active ? "step" : undefined}
            className="group flex h-11 min-w-0 flex-1 items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              className={cn(
                "block h-1 w-full rounded-full transition-colors",
                i <= active ? "bg-lime-line" : "bg-chip group-hover:bg-[var(--chip-hover)]",
                i === active && "shadow-lime-glow"
              )}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
