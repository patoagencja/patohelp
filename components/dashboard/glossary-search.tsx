"use client";

import { useId, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Minus, Search, SearchX, X } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface GlossaryGroupView {
  title: string;
  entries: Array<{
    key: string;
    name: string;
    short: string | null;
    explain: string;
    goodWhen: string;
    /** Which way is good news - picks the arrow on the hint chip. */
    direction: "higher" | "lower" | "neutral";
  }>;
}

function DirectionIcon({ direction }: { direction: "higher" | "lower" | "neutral" }) {
  const Icon = direction === "higher" ? ArrowUpRight : direction === "lower" ? ArrowDownRight : Minus;
  return <Icon aria-hidden strokeWidth={2.25} />;
}

// Case- and accent-insensitive, so "klikniecia" finds "Kliknięcia".
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ł/g, "l");
}

/** Search field + the filtered term list. */
export function GlossarySearch({ groups }: { groups: GlossaryGroupView[] }) {
  const [query, setQuery] = useState("");
  const inputId = useId();
  const q = norm(query.trim());

  const visible = groups
    .map((g) => ({
      ...g,
      entries: q
        ? g.entries.filter((e) => norm(`${e.name} ${e.short ?? ""} ${e.explain}`).includes(q))
        : g.entries,
    }))
    .filter((g) => g.entries.length > 0);
  const found = visible.reduce((n, g) => n + g.entries.length, 0);

  return (
    <div className="space-y-8">
      <div className="relative max-w-lg" data-print-hide>
        <label htmlFor={inputId} className="sr-only">
          Szukaj pojęcia
        </label>
        <Search
          className="pointer-events-none absolute left-5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-3"
          aria-hidden
        />
        <Input
          id={inputId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Szukaj, np. CTR albo zasięg"
          autoComplete="off"
          className="glass glass-blur h-14 rounded-full border-0 bg-transparent pl-12 pr-14 text-base hover:bg-transparent [&::-webkit-search-cancel-button]:hidden"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Wyczyść wyszukiwanie"
            className="absolute right-1.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-chip text-ink-2 hover:bg-[var(--chip-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>

      <p className="sr-only" aria-live="polite">
        {q ? `Znaleziono: ${found}` : ""}
      </p>

      {visible.length === 0 ? (
        <Card className="flex flex-col items-center rounded-glass px-6 py-14 text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-chip">
            <SearchX className="h-6 w-6 text-ink-3" aria-hidden />
          </span>
          <p className="text-[22px] font-medium tracking-[-0.03em]">Nie mamy takiego pojęcia</p>
          <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
            Spróbuj innego słowa albo zapytaj swojego opiekuna w Pato - chętnie
            wyjaśnimy.
          </p>
          <button
            type="button"
            onClick={() => setQuery("")}
            className="mt-5 inline-flex min-h-11 items-center rounded-full bg-anchor px-5 text-[15px] font-medium text-anchor-foreground transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:active:scale-100"
          >
            Pokaż wszystkie pojęcia
          </button>
        </Card>
      ) : (
        visible.map((g, gi) => (
          // Index-based id: group titles contain spaces, which would split
          // aria-labelledby into two (missing) ids.
          <section key={g.title} aria-labelledby={`slownik-grupa-${gi}`}>
            <h2 id={`slownik-grupa-${gi}`} className="mb-4 flex items-center gap-3 px-1">
              <span className="text-[22px] font-medium tracking-[-0.03em]">{g.title}</span>
              <span aria-hidden className="h-px flex-1 bg-line" />
              <span className="kick">{g.entries.length}</span>
            </h2>
            <dl className="grid gap-4 md:grid-cols-2">
              {g.entries.map((e) => (
                <div
                  key={e.key}
                  id={`pojecie-${e.key}`}
                  className="glass flex scroll-mt-28 flex-col rounded-card p-[22px] target:shadow-lime-ring"
                >
                  <dt className="flex flex-wrap items-center gap-2">
                    <span className="text-[17px] font-medium tracking-[-0.015em]">{e.name}</span>
                    {e.short ? (
                      <span className="rounded-full bg-chip px-2 py-0.5 font-mono text-[11px] tracking-[0.08em] text-ink-2">
                        {e.short}
                      </span>
                    ) : null}
                  </dt>
                  <dd className="mt-2 flex-1 text-[15px] leading-relaxed text-ink-2">{e.explain}</dd>
                  {/* A hint, not a verdict: neutral chip, the arrow repeats
                      the words. */}
                  <dd className="mt-4">
                    <span
                      className={cn(
                        "inline-flex min-h-8 items-center gap-1.5 rounded-full bg-chip py-1 pl-2 pr-3 text-[13px] font-medium text-ink-2 [&_svg]:size-3.5",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "grid size-5 place-items-center rounded-full",
                          e.direction === "higher"
                            ? "bg-lime text-lime-foreground"
                            : e.direction === "lower"
                              ? "bg-mint text-lime-foreground"
                              : "bg-chip text-ink-2"
                        )}
                      >
                        <DirectionIcon direction={e.direction} />
                      </span>
                      {e.goodWhen}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))
      )}
    </div>
  );
}
