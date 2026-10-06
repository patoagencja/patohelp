import Link from "next/link";
import { redirect } from "next/navigation";
import { Newspaper } from "lucide-react";

import {
  NewsFilterControl,
  NewsList,
  parseNewsFilter,
  type NewsListItem,
} from "@/components/dashboard/news-list";
import { NewsRefreshButton } from "@/components/dashboard/news-refresh-button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getClientBySlug } from "@/lib/dashboard/context";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NewsCategory } from "@/lib/news/fetch";

export const dynamic = "force-dynamic";
// The on-demand refresh action waits for the news cron (Claude + web search,
// ~1-2 min) before revalidating, so give the route a generous budget.
export const maxDuration = 240;

export default async function NewsyPage({
  params,
  searchParams,
}: {
  params: { clientSlug: string };
  searchParams: { cat?: string };
}) {
  const filter = parseNewsFilter(searchParams.cat);

  // News are global (not per client) - read via admin (RLS, no policy).
  // Nothing here depends on the client, so it runs alongside the access
  // check below instead of after it; the rows are only used once that passes.
  let q = createAdminClient()
    .from("news_items")
    .select("id, published_on, category, title, summary, source_name, source_url")
    .order("published_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(120);
  if (filter !== "all") q = q.eq("category", filter);

  // Shared per-request lookup (the layout already asked for this client).
  const [client, { data }] = await Promise.all([
    getClientBySlug(params.clientSlug),
    q,
  ]);
  if (!client) redirect("/login");

  const items: NewsListItem[] = (data ?? []).map((r) => ({
    id: r.id as string,
    publishedOn: r.published_on as string,
    category: r.category as NewsCategory,
    title: r.title as string,
    summary: r.summary as string,
    sourceName: r.source_name as string | null,
    sourceUrl: r.source_url as string | null,
  }));
  const base = `/${params.clientSlug}/newsy`;

  return (
    <div className="space-y-8 px-4 pb-6 pt-6 sm:px-6 md:pt-8">
      <PageHeader
        eyebrow={<span className="kick">Branża · co rano nowe</span>}
        title="Newsy"
        description="Co nowego w reklamie Meta, Google, TikTok i w AI - zbierane automatycznie każdego ranka."
        actions={<NewsRefreshButton clientSlug={params.clientSlug} />}
      />

      <div data-print-hide>
        <NewsFilterControl
          active={filter}
          hrefFor={(f) => (f === "all" ? base : `${base}?cat=${f}`)}
        />
      </div>

      {items.length === 0 ? (
        <Card className="flex flex-col items-center rounded-glass px-6 py-14 text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-chip">
            <Newspaper className="h-6 w-6 text-ink-3" aria-hidden />
          </span>
          {filter === "all" ? (
            <>
              <p className="text-[22px] font-medium tracking-[-0.03em]">Brak newsów</p>
              <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
                Lista wypełnia się automatycznie każdego ranka. Kliknij ikonę
                odświeżania, aby pobrać pierwszą porcję (potrwa ok. 1 min).
              </p>
            </>
          ) : (
            <>
              <p className="text-[22px] font-medium tracking-[-0.03em]">Nic nowego w tej kategorii</p>
              <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
                W ostatnim czasie nie pojawiło się tu nic ważnego.
              </p>
              <Link
                href={base}
                scroll={false}
                className="mt-5 inline-flex min-h-11 items-center rounded-full bg-anchor px-5 text-[15px] font-medium text-anchor-foreground transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:active:scale-100"
              >
                Pokaż wszystkie newsy
              </Link>
            </>
          )}
        </Card>
      ) : (
        <NewsList items={items} />
      )}
    </div>
  );
}
