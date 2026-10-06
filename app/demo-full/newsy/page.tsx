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
        eyebrow={<span className="kick">{en ? "Industry · updated every morning" : "Branża · co rano nowe"}</span>}
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
        <Card className="flex flex-col items-center rounded-glass px-6 py-14 text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-chip">
            <Newspaper className="h-6 w-6 text-ink-3" aria-hidden />
          </span>
          <p className="text-[22px] font-medium tracking-[-0.03em]">
            {en ? "Nothing new in this category" : "Nic nowego w tej kategorii"}
          </p>
          <Link
            href={hrefFor("all")}
            scroll={false}
            className="mt-5 inline-flex min-h-11 items-center rounded-full bg-anchor px-5 text-[15px] font-medium text-anchor-foreground transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:active:scale-100"
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
