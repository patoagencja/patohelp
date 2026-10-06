import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { Card } from "@/components/ui/card";
import { SegmentedTrack, segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { plPlural } from "@/lib/dashboard/story";
import type { NewsCategory } from "@/lib/news/fetch";
import { cn } from "@/lib/utils";

// Shared by the live Newsy page and the demo: one quiet list grouped by day
// (2026 pastel: mono day kicker, one glass card per day). Category is a chip
// with a small pastel dot - decoration only, the word carries the meaning -
// the summary is clamped to two lines and the source link carries the rest.

// Pastel dot per platform (fills only, never text colour).
const CATEGORY_DOT: Record<NewsCategory, string> = {
  meta: "bg-violet",
  google: "bg-amber",
  tiktok: "bg-coral",
  ai: "bg-lime",
  other: "bg-mint",
};

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
    <SegmentedTrack
      as="nav"
      aria-label={en ? "Filter by category" : "Filtruj według kategorii"}
      className={segmentedTrack}
    >
      {NEWS_FILTERS.map((f) => (
        <Link
          key={f}
          href={hrefFor(f)}
          scroll={false}
          aria-current={active === f ? "page" : undefined}
          className={segmentedItem(active === f, "min-h-11 px-4 text-[15px]")}
        >
          {f === "all" ? (en ? "All" : "Wszystkie") : NEWS_CATEGORY_LABEL[lang][f]}
        </Link>
      ))}
    </SegmentedTrack>
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
    <div className="space-y-9">
      {Array.from(byDate.entries()).map(([date, dayItems], di) => (
        <section key={date} aria-labelledby={`news-${date}`} className="animate-rise" style={{ "--d": `${Math.min(di, 4) * 0.08}s` } as React.CSSProperties}>
          <h2 id={`news-${date}`} className="kick mb-3 flex items-center gap-3 px-1">
            {dayLabel(date, lang)}
            <span aria-hidden className="h-px flex-1 bg-line" />
            <span className="normal-case tracking-normal">
              {dayItems.length}{" "}
              {en ? (dayItems.length === 1 ? "item" : "items") : plPlural(dayItems.length, "news", "newsy", "newsów")}
            </span>
          </h2>
          <Card className="overflow-hidden rounded-glass">
            <ul className="divide-y divide-line">
              {dayItems.map((item) => {
                const cat = NEWS_CATEGORY_LABEL[lang][item.category] ? item.category : "other";
                return (
                  <li key={item.id}>
                    <article className="flex flex-col gap-2 px-5 py-5 sm:flex-row sm:gap-6 sm:px-7">
                      <span className="inline-flex h-7 w-fit shrink-0 items-center gap-2 rounded-full bg-chip px-3 text-xs font-medium text-ink-2 sm:mt-0.5 sm:w-32 sm:bg-transparent sm:px-0">
                        <span aria-hidden className={cn("size-2 rounded-full", CATEGORY_DOT[cat])} />
                        {NEWS_CATEGORY_LABEL[lang][cat]}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-balance text-[17px] font-medium leading-snug tracking-[-0.015em]">
                          {item.title}
                        </h3>
                        <p className="mt-1.5 line-clamp-2 max-w-3xl text-[15px] leading-relaxed text-ink-2" title={item.summary}>
                          {item.summary}
                        </p>
                        {item.sourceUrl ? (
                          <a
                            href={item.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="-mx-3 mt-1.5 inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-primary transition-colors hover:bg-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {item.sourceName || (en ? "Source" : "Źródło")}
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                            <span className="sr-only">
                              {en ? "(opens in a new tab)" : "(otwiera się w nowej karcie)"}
                            </span>
                          </a>
                        ) : item.sourceName ? (
                          <p className="mt-2 text-[13px] text-ink-3">{item.sourceName}</p>
                        ) : null}
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
          </Card>
        </section>
      ))}
    </div>
  );
}
