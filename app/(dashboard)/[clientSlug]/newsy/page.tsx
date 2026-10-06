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
        <Card className="flex flex-col items-center px-6 py-14 text-center">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Newspaper className="h-6 w-6 text-muted-foreground" aria-hidden />
          </span>
          <p className="text-section-title">Brak newsów</p>
          <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
            Lista wypełnia się automatycznie raz dziennie. Kliknij ikonę
            odświeżania, aby pobrać pierwszą porcję (potrwa ~1 min).
          </p>
        </Card>
      ) : (
        <NewsList items={items} />
      )}
    </div>
  );
}
