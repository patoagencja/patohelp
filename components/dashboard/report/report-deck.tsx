"use client";

import { Children, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Sparkles } from "lucide-react";
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
 */
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

  // Inject the AI summary slide right after the cover once it exists.
  const slides = useMemo(() => {
    if (!summary) return staticSlides;
    const aiSlide = (
      <ContentSlide
        key="ai-summary"
        title="Podsumowanie"
        subtitle={rangeLabel}
        section="Executive summary"
        foot={foot}
      >
        <div className="space-y-4 text-[15px] leading-relaxed text-slate-700">
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
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
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
      <div className="deck relative">
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
          className="absolute inset-y-0 left-0 w-[8%] cursor-pointer disabled:cursor-default print:hidden"
        />
        <button
          type="button"
          aria-label="Następny slajd"
          onClick={() => setIndex((i) => Math.min(i + 1, total - 1))}
          disabled={active === total - 1}
          className="absolute inset-y-0 right-0 w-[8%] cursor-pointer disabled:cursor-default print:hidden"
        />
      </div>

      {/* Dots */}
      <div className="mt-5 flex flex-wrap justify-center gap-1.5 print:hidden">
        {slides.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Slajd ${i + 1}`}
            className={cn(
              "h-2 w-2 rounded-full transition-colors",
              i === active
                ? "bg-primary"
                : "bg-muted-foreground/30 hover:bg-muted-foreground/60"
            )}
          />
        ))}
      </div>
    </div>
  );
}
