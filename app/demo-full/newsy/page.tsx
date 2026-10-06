import Link from "next/link";
import { Newspaper } from "lucide-react";

import {
  NewsFilterControl,
  NewsList,
  parseNewsFilter,
} from "@/components/dashboard/news-list";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getDemoDashboard } from "@/lib/demo/data";

export const dynamic = "force-dynamic";

export default function DemoFullNewsy({
  searchParams,
}: {
  searchParams: { lang?: string; cat?: string };
}) {
  const lang = searchParams.lang === "en" ? "en" : "pl";
  const en = lang === "en";
  const filter = parseNewsFilter(searchParams.cat);
  const d = getDemoDashboard(lang);
  const items = d.news
    .map((n, i) => ({ id: String(i), ...n }))
    .filter((n) => filter === "all" || n.category === filter);

  const hrefFor = (f: string) => {
    const p = new URLSearchParams();
    if (en) p.set("lang", "en");
    if (f !== "all") p.set("cat", f);
    const q = p.toString();
    return q ? `/demo-full/newsy?${q}` : "/demo-full/newsy";
  };

  return (
    <>
      <PageHeader
        title={en ? "News" : "Newsy"}
        description={
          en
            ? "What's new in Meta, Google, TikTok ads and in AI - gathered automatically every morning."
            : "Co nowego w reklamie Meta, Google, TikTok i w AI - zbierane automatycznie każdego ranka."
        }
      />

      <div data-print-hide>
        <NewsFilterControl active={filter} hrefFor={hrefFor} lang={lang} />
      </div>

      {items.length === 0 ? (
        // Same empty state as the live Newsy page.
        <Card className="flex flex-col items-center px-6 py-14 text-center">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Newspaper className="h-6 w-6 text-muted-foreground" aria-hidden />
          </span>
          <p className="text-section-title">
            {en ? "Nothing new in this category" : "Nic nowego w tej kategorii"}
          </p>
          <Link
            href={hrefFor("all")}
            scroll={false}
            className="mt-4 inline-flex h-9 items-center rounded-full bg-muted px-4 text-sm font-medium transition-colors hover:bg-anchor hover:text-anchor-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {en ? "Show all news" : "Pokaż wszystkie newsy"}
          </Link>
        </Card>
      ) : (
        <NewsList items={items} lang={lang} />
      )}
    </>
  );
}
