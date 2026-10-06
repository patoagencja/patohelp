import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import type { NewsCategory } from "@/lib/news/fetch";

// Shared by the live Newsy page and the demo: one quiet list grouped by day.
// Category is a neutral pill (colour is reserved for status), the summary is
// clamped to two lines and the source link carries the rest.

type Lang = "pl" | "en";

export interface NewsListItem {
  id: string;
  publishedOn: string; // yyyy-MM-dd
  category: NewsCategory;
  title: string;
  summary: string;
  sourceName?: string | null;
  sourceUrl?: string | null;
}

export const NEWS_CATEGORY_LABEL: Record<Lang, Record<NewsCategory, string>> = {
  pl: { meta: "Meta", google: "Google / YT", tiktok: "TikTok", ai: "AI", other: "Inne" },
  en: { meta: "Meta", google: "Google / YT", tiktok: "TikTok", ai: "AI", other: "Other" },
};

/** Filter keys in display order ("all" first). */
export const NEWS_FILTERS = ["all", "meta", "google", "tiktok", "ai"] as const;
export type NewsFilter = (typeof NEWS_FILTERS)[number];

export function parseNewsFilter(v: string | undefined): NewsFilter {
  return (NEWS_FILTERS as readonly string[]).includes(v ?? "") ? (v as NewsFilter) : "all";
}

/** "5 października" (year only when it isn't this year). */
function dayLabel(iso: string, lang: Lang): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const thisYear = new Date().getUTCFullYear() === y;
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "pl-PL", {
    day: "numeric",
    month: "long",
    year: thisYear ? undefined : "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** Category filter as a segmented control of links (works without JS). */
export function NewsFilterControl({
  active,
  hrefFor,
  lang = "pl",
}: {
  active: NewsFilter;
  hrefFor: (f: NewsFilter) => string;
  lang?: Lang;
}) {
  const en = lang === "en";
  return (
    <nav aria-label={en ? "Filter by category" : "Filtruj według kategorii"} className={segmentedTrack}>
      {NEWS_FILTERS.map((f) => (
        <Link
          key={f}
          href={hrefFor(f)}
          scroll={false}
          aria-current={active === f ? "page" : undefined}
          className={segmentedItem(active === f)}
        >
          {f === "all" ? (en ? "All" : "Wszystkie") : NEWS_CATEGORY_LABEL[lang][f]}
        </Link>
      ))}
    </nav>
  );
}

export function NewsList({ items, lang = "pl" }: { items: NewsListItem[]; lang?: Lang }) {
  const en = lang === "en";
  const byDate = new Map<string, NewsListItem[]>();
  for (const item of items) {
    const arr = byDate.get(item.publishedOn) ?? [];
    arr.push(item);
    byDate.set(item.publishedOn, arr);
  }

  return (
    <div className="space-y-8">
      {Array.from(byDate.entries()).map(([date, dayItems]) => (
        <section key={date} aria-labelledby={`news-${date}`}>
          <h2 id={`news-${date}`} className="mb-3 text-sm font-medium text-muted-foreground">
            {dayLabel(date, lang)}
          </h2>
          <Card className="divide-y divide-border overflow-hidden">
            {dayItems.map((item) => (
              <article key={item.id} className="px-5 py-4 sm:px-6">
                <Pill>{NEWS_CATEGORY_LABEL[lang][item.category] ?? NEWS_CATEGORY_LABEL[lang].other}</Pill>
                <h3 className="mt-2 text-balance text-[15px] font-semibold leading-snug">
                  {item.title}
                </h3>
                <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground" title={item.summary}>
                  {item.summary}
                </p>
                {item.sourceUrl ? (
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {item.sourceName || (en ? "Source" : "Źródło")}
                    <ExternalLink className="h-3 w-3" aria-hidden />
                    <span className="sr-only">
                      {en ? "(opens in a new tab)" : "(otwiera się w nowej karcie)"}
                    </span>
                  </a>
                ) : item.sourceName ? (
                  <p className="mt-2 text-xs text-muted-foreground">{item.sourceName}</p>
                ) : null}
              </article>
            ))}
          </Card>
        </section>
      ))}
    </div>
  );
}
