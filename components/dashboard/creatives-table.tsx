"use client";

import { useEffect, useState } from "react";
import { ExternalLink, X } from "lucide-react";

import { CreativeThumb } from "@/components/dashboard/creatives/creative-thumb";
import {
  verdictLabel,
  verdictReason,
  type CreativeItem,
  type CreativeScore,
} from "@/lib/dashboard/creatives";
import { cn, formatMoneyPLN, formatNumberPL, formatPercent } from "@/lib/utils";

// Re-exported so existing imports (demo data, pages) keep working.
export type { CreativeItem } from "@/lib/dashboard/creatives";

type SortKey = "spend" | "ctr" | "cpc" | "clicks";

const SORT_KEYS: SortKey[] = ["spend", "clicks", "ctr", "cpc"];

// Modal preview of a single creative - "click an ad, see it big".
export function CreativeModal({
  c,
  onClose,
  en = false,
  score,
}: {
  c: CreativeItem;
  onClose: () => void;
  en?: boolean;
  /** Optional verdict vs the client's average, shown under the name. */
  score?: CreativeScore;
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

  const lang = en ? "en" : "pl";
  const reason = score ? verdictReason(score, lang) : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={c.name}
    >
      <div
        className="relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
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

        <CreativeThumb
          src={c.thumbnailUrl}
          name={c.name}
          lang={lang}
          fit="contain"
          className="h-[50vh] max-h-[28rem] min-h-48 w-full rounded-none bg-black/90"
        />

        <div className="space-y-3 overflow-y-auto p-4">
          <div>
            <p className="break-words text-sm font-semibold leading-snug">{c.name}</p>
            {score ? (
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {verdictLabel(score, lang)}
                </span>
                {reason ? ` · ${reason}` : ""}
              </p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              { label: en ? "Spend" : "Wydatki", value: formatMoneyPLN(c.spend) },
              { label: en ? "Views" : "Wyświetlenia", value: formatNumberPL(c.impressions) },
              { label: en ? "Clicks" : "Kliknięcia", value: formatNumberPL(c.clicks) },
              {
                label: en ? "Click rate (CTR)" : "Klikalność (CTR)",
                value: c.ctr != null ? formatPercent(c.ctr) : "-",
              },
              {
                label: en ? "Cost per click" : "Koszt kliknięcia",
                value: c.cpc != null ? formatMoneyPLN(Math.round(c.cpc)) : "-",
              },
            ].map((s) => (
              <div key={s.label} className="rounded-lg bg-muted/50 p-2.5">
                <p className="text-[11px] text-muted-foreground">{s.label}</p>
                <p className="tabular-nums text-sm font-semibold">
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

/**
 * Dense table for agency power users. Embedded under the gallery's "Tabela"
 * toggle, so it carries no card chrome of its own when `embedded`.
 */
export function CreativesTable({
  creatives,
  lang = "pl",
  embedded = false,
}: {
  creatives: CreativeItem[];
  lang?: "pl" | "en";
  embedded?: boolean;
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
    <section
      className={cn(
        "min-w-0",
        embedded ? "" : "rounded-xl border border-border bg-card p-4"
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-semibold">
          {en ? "All creatives" : "Wszystkie kreacje"} ({Math.min(creatives.length, 50)}
          {creatives.length > 50 ? `${en ? " of " : " z "}${creatives.length}` : ""})
          <span className="ml-2 font-normal text-muted-foreground">
            {en ? "· click a row to view the creative" : "· kliknij wiersz, by zobaczyć kreację"}
          </span>
        </h2>
        <div className="flex self-start rounded-lg bg-muted p-1 sm:self-auto">
          {SORT_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setSort(key)}
              aria-pressed={sort === key}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                sort === key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {sortLabel[key]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[34rem]">
          <thead>
            <tr className="border-b border-border text-left tabular-nums text-[11px] uppercase tracking-wide text-muted-foreground">
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
                    <CreativeThumb
                      src={c.thumbnailUrl}
                      name={c.name}
                      lang={lang}
                      compact
                      className="h-9 w-9 rounded-md"
                    />
                    <span className="truncate text-sm" title={c.name}>
                      {c.name}
                    </span>
                  </div>
                </td>
                <td className="py-2 pr-3 text-right text-sm tabular-nums">
                  {formatMoneyPLN(c.spend)}
                </td>
                <td className="py-2 pr-3 text-right text-sm tabular-nums text-muted-foreground">
                  {formatNumberPL(c.impressions)}
                </td>
                <td className="py-2 pr-3 text-right text-sm tabular-nums text-muted-foreground">
                  {formatNumberPL(c.clicks)}
                </td>
                <td className="py-2 pr-3 text-right text-sm tabular-nums text-muted-foreground">
                  {c.ctr != null ? formatPercent(c.ctr) : "-"}
                </td>
                <td className="py-2 text-right text-sm tabular-nums text-muted-foreground">
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
