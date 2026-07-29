"use client";

import { useEffect, useState } from "react";
import { ExternalLink, ImageOff, X } from "lucide-react";

import { cn, formatMoneyPLN, formatNumberPL, formatPercent } from "@/lib/utils";

export interface CreativeItem {
  adId: string;
  name: string;
  thumbnailUrl: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
}

type SortKey = "spend" | "ctr" | "cpc" | "clicks";

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "spend", label: "Wydatki" },
  { key: "clicks", label: "Kliknięcia" },
  { key: "ctr", label: "CTR" },
  { key: "cpc", label: "CPC" },
];

function Thumb({ c, className }: { c: CreativeItem; className?: string }) {
  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-md bg-muted",
        className
      )}
    >
      {c.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={c.thumbnailUrl}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-muted-foreground">
          <ImageOff className="h-4 w-4" />
        </span>
      )}
    </div>
  );
}

// Modal preview of a single creative - the "click a row, see which ad it is".
function CreativeModal({
  c,
  onClose,
  en = false,
}: {
  c: CreativeItem;
  onClose: () => void;
  en?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Lock scroll while open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={en ? "Close" : "Zamknij"}
          className="absolute right-3 top-3 z-10 rounded-full bg-black/40 p-1.5 text-white transition-colors hover:bg-black/60"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex max-h-[55vh] items-center justify-center bg-black/90">
          {c.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={c.thumbnailUrl}
              alt={c.name}
              className="max-h-[55vh] w-auto max-w-full object-contain"
            />
          ) : (
            <div className="flex h-48 w-full items-center justify-center text-muted-foreground">
              <ImageOff className="h-8 w-8" />
            </div>
          )}
        </div>

        <div className="space-y-3 p-4">
          <p className="text-sm font-semibold leading-snug">{c.name}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: en ? "Spend" : "Wydatki", value: formatMoneyPLN(c.spend) },
              { label: en ? "Impressions" : "Wyświetlenia", value: formatNumberPL(c.impressions) },
              { label: en ? "Clicks" : "Kliknięcia", value: formatNumberPL(c.clicks) },
              { label: "CTR", value: formatPercent(c.ctr ?? 0) },
            ].map((s) => (
              <div key={s.label} className="rounded-lg bg-muted/50 p-2.5">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {s.label}
                </p>
                <p className="font-mono text-sm font-semibold tabular-nums">
                  {s.value}
                </p>
              </div>
            ))}
          </div>
          {c.thumbnailUrl ? (
            <a
              href={c.thumbnailUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {en ? "Open full-size image" : "Otwórz grafikę w pełnym rozmiarze"}
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function CreativesTable({
  creatives,
  lang = "pl",
}: {
  creatives: CreativeItem[];
  lang?: "pl" | "en";
}) {
  const en = lang === "en";
  const sortLabel: Record<SortKey, string> = en
    ? { spend: "Spend", clicks: "Clicks", ctr: "CTR", cpc: "CPC" }
    : { spend: "Wydatki", clicks: "Kliknięcia", ctr: "CTR", cpc: "CPC" };
  const [sort, setSort] = useState<SortKey>("spend");
  const [selected, setSelected] = useState<CreativeItem | null>(null);

  const table = [...creatives]
    .sort((a, b) => {
      if (sort === "ctr") return (b.ctr ?? -1) - (a.ctr ?? -1);
      if (sort === "cpc") return (a.cpc ?? Infinity) - (b.cpc ?? Infinity);
      if (sort === "clicks") return b.clicks - a.clicks;
      return b.spend - a.spend;
    })
    .slice(0, 50);

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-semibold">
          {en ? "All creatives" : "Wszystkie kreacje"} ({Math.min(creatives.length, 50)}
          {creatives.length > 50 ? `${en ? " of " : " z "}${creatives.length}` : ""})
          <span className="ml-2 font-normal text-muted-foreground">
            {en ? "· click a row to view the creative" : "· kliknij wiersz, by zobaczyć kreację"}
          </span>
        </h2>
        <div className="flex rounded-lg bg-muted p-1">
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSort(s.key)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                sort === s.key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {sortLabel[s.key]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border text-left font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-3 font-medium">{en ? "Creative" : "Kreacja"}</th>
              <th className="py-2 pr-3 text-right font-medium">{en ? "Spend" : "Wydatki"}</th>
              <th className="py-2 pr-3 text-right font-medium">{en ? "Impr." : "Wyśw."}</th>
              <th className="py-2 pr-3 text-right font-medium">{en ? "Clicks" : "Klik."}</th>
              <th className="py-2 pr-3 text-right font-medium">CTR</th>
              <th className="py-2 text-right font-medium">CPC</th>
            </tr>
          </thead>
          <tbody>
            {table.map((c) => (
              <tr
                key={c.adId}
                onClick={() => setSelected(c)}
                className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/40"
              >
                <td className="max-w-[22rem] py-2 pr-3">
                  <div className="flex items-center gap-2.5">
                    <Thumb c={c} className="h-9 w-9" />
                    <span className="truncate text-sm" title={c.name}>
                      {c.name}
                    </span>
                  </div>
                </td>
                <td className="py-2 pr-3 text-right font-mono text-sm tabular-nums">
                  {formatMoneyPLN(c.spend)}
                </td>
                <td className="py-2 pr-3 text-right font-mono text-sm tabular-nums text-muted-foreground">
                  {formatNumberPL(c.impressions)}
                </td>
                <td className="py-2 pr-3 text-right font-mono text-sm tabular-nums text-muted-foreground">
                  {formatNumberPL(c.clicks)}
                </td>
                <td className="py-2 pr-3 text-right font-mono text-sm tabular-nums text-muted-foreground">
                  {formatPercent(c.ctr ?? 0)}
                </td>
                <td className="py-2 text-right font-mono text-sm tabular-nums text-muted-foreground">
                  {c.cpc != null ? formatMoneyPLN(Math.round(c.cpc)) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected ? (
        <CreativeModal c={selected} onClose={() => setSelected(null)} en={en} />
      ) : null}
    </section>
  );
}
