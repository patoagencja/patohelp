"use client";

import { useId, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Minus, Search, SearchX, X } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";

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
      <div className="relative max-w-md" data-print-hide>
        <label htmlFor={inputId} className="sr-only">
          Szukaj pojęcia
        </label>
        <Search
          className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id={inputId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Szukaj, np. CTR albo zasięg"
          autoComplete="off"
          className="border-hairline bg-card pl-10 pr-10 shadow-card hover:bg-card [&::-webkit-search-cancel-button]:hidden"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Wyczyść wyszukiwanie"
            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>

      <p className="sr-only" aria-live="polite">
        {q ? `Znaleziono: ${found}` : ""}
      </p>

      {visible.length === 0 ? (
        <Card className="flex flex-col items-center px-6 py-12 text-center">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <SearchX className="h-6 w-6 text-muted-foreground" aria-hidden />
          </span>
          <p className="text-section-title">Nie mamy takiego pojęcia</p>
          <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
            Spróbuj innego słowa albo zapytaj swojego opiekuna w Pato - chętnie
            wyjaśnimy.
          </p>
          <button
            type="button"
            onClick={() => setQuery("")}
            className="mt-4 inline-flex h-9 items-center rounded-full bg-muted px-4 text-sm font-medium transition-colors hover:bg-anchor hover:text-anchor-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Pokaż wszystkie pojęcia
          </button>
        </Card>
      ) : (
        visible.map((g, gi) => (
          // Index-based id: group titles contain spaces, which would split
          // aria-labelledby into two (missing) ids.
          <section key={g.title} aria-labelledby={`slownik-grupa-${gi}`}>
            <h2 id={`slownik-grupa-${gi}`} className="mb-3 text-section-title">
              {g.title}
            </h2>
            <Card>
              <dl className="divide-y divide-border">
                {g.entries.map((e) => (
                  <div key={e.key} id={`pojecie-${e.key}`} className="px-5 py-4 sm:px-6">
                    <dt className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold">{e.name}</span>
                      {e.short ? <Pill>{e.short}</Pill> : null}
                    </dt>
                    <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{e.explain}</dd>
                    {/* A hint, not a verdict: neutral chip, the arrow repeats
                        the words. */}
                    <dd className="mt-2">
                      <Pill>
                        <DirectionIcon direction={e.direction} />
                        {e.goodWhen}
                      </Pill>
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          </section>
        ))
      )}
    </div>
  );
}
