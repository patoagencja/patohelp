import {
  NewsFilterControl,
  NewsList,
  parseNewsFilter,
} from "@/components/dashboard/news-list";
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
        <p className="text-sm text-muted-foreground">
          {en ? "No news in this category yet." : "Brak newsów w tej kategorii."}
        </p>
      ) : (
        <NewsList items={items} lang={lang} />
      )}
    </>
  );
}
