"use client";

import { Children, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, RotateCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { ContentSlide } from "@/components/dashboard/report/deck";
import { Button } from "@/components/ui/button";
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
        <div className="space-y-4 text-[15px] leading-relaxed text-foreground/85">
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
      <div className="mx-auto mb-4 flex max-w-5xl flex-wrap items-center gap-2 print:hidden">
        {!shareMode ? (
          <Button onClick={generate} disabled={loading} className="gap-1.5">
            <Sparkles className={cn("h-4 w-4", loading && "animate-pulse")} />
            {loading ? "Generuję…" : summary ? "Wygeneruj ponownie" : "Generuj opis AI"}
          </Button>
        ) : null}
        <Button variant="outline" onClick={() => window.print()} className="gap-1.5">
          <Download className="h-4 w-4" />
          Pobierz PDF
        </Button>
        <span className="flex-1" />
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setIndex((i) => Math.max(i - 1, 0))}
            disabled={active === 0}
            aria-label="Poprzedni slajd"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="w-14 text-center text-sm tabular-nums text-muted-foreground">
            {active + 1} / {total}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setIndex((i) => Math.min(i + 1, total - 1))}
            disabled={active === total - 1}
            aria-label="Następny slajd"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
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
      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground sm:hidden landscape:hidden print:hidden">
        <RotateCw className="h-3.5 w-3.5" aria-hidden />
        Obróć telefon poziomo, żeby powiększyć slajd.
      </p>

      {/* Dots */}
      <div className="mt-5 flex flex-wrap justify-center gap-1.5 print:hidden">
        {slides.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Slajd ${i + 1}`}
            aria-current={i === active ? "step" : undefined}
            className={cn(
              "h-2 w-2 rounded-full transition-[width,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              i === active
                ? "w-5 bg-anchor"
                : "bg-muted-foreground/30 hover:bg-muted-foreground/60"
            )}
          />
        ))}
      </div>
    </div>
  );
}
