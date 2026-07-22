import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ExternalLink, Newspaper, RefreshCw } from "lucide-react";

import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { NewsCategory } from "@/lib/news/fetch";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
// The on-demand refresh action waits for the news cron (Claude + web search,
// ~1-2 min) before revalidating, so give the route a generous budget.
export const maxDuration = 240;

const CATEGORY_META: Record<
  NewsCategory,
  { label: string; chip: string; dot: string }
> = {
  meta: {
    label: "META",
    chip: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    dot: "bg-blue-500",
  },
  google: {
    label: "GOOGLE / YT",
    chip: "bg-red-500/10 text-red-600 dark:text-red-400",
    dot: "bg-red-500",
  },
  tiktok: {
    label: "TIKTOK",
    chip: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
    dot: "bg-slate-500",
  },
  ai: {
    label: "AI",
    chip: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    dot: "bg-violet-500",
  },
  other: {
    label: "INNE",
    chip: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
  },
};

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "all", label: "Wszystkie" },
  { key: "meta", label: "Meta" },
  { key: "google", label: "Google / YT" },
  { key: "tiktok", label: "TikTok" },
  { key: "ai", label: "AI" },
];

const MONTHS_PL = [
  "stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca",
  "lipca", "sierpnia", "września", "października", "listopada", "grudnia",
];

function dateLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS_PL[m - 1]} ${y}`;
}

// Server action: pull fresh news on demand (agency only).
async function refreshNews(formData: FormData) {
  "use server";
  const clientSlug = String(formData.get("client"));
  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) return;

  const base = process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;
  if (base && secret) {
    try {
      await fetch(`${base}/api/cron/refresh-news`, {
        headers: { Authorization: `Bearer ${secret}` },
        cache: "no-store",
      });
    } catch {
      // best-effort
    }
  }
  revalidatePath(`/${clientSlug}/newsy`);
}

export default async function NewsyPage({
  params,
  searchParams,
}: {
  params: { clientSlug: string };
  searchParams: { cat?: string };
}) {
  const supabase = createClient();
  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("slug", params.clientSlug)
    .single();
  if (!client) redirect("/login");

  const filter = FILTERS.find((f) => f.key === searchParams.cat)?.key ?? "all";

  // News are global (not per client) - read via admin (RLS, no policy).
  let q = createAdminClient()
    .from("news_items")
    .select("id, published_on, category, title, summary, source_name, source_url")
    .order("published_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(120);
  if (filter !== "all") q = q.eq("category", filter);
  const { data } = await q;

  const items = data ?? [];
  const byDate = new Map<string, typeof items>();
  for (const item of items) {
    const key = item.published_on as string;
    const arr = byDate.get(key) ?? [];
    arr.push(item);
    byDate.set(key, arr);
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Newspaper className="h-5 w-5 text-primary" />
            Newsy - reklama & AI
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Codzienny prasówka: Meta, Google/YouTube, TikTok i AI - mielone
            automatycznie z sieci.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-muted p-1">
            {FILTERS.map((f) => (
              <a
                key={f.key}
                href={`/${params.clientSlug}/newsy${f.key === "all" ? "" : `?cat=${f.key}`}`}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                  filter === f.key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {f.label}
              </a>
            ))}
          </div>
          <form action={refreshNews}>
            <input type="hidden" name="client" value={params.clientSlug} />
            <button
              type="submit"
              title="Pobierz świeże newsy teraz"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <Newspaper className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">Brak newsów</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Feed wypełnia się automatycznie raz dziennie. Kliknij ikonę
            odświeżania, aby pobrać pierwszą porcję (potrwa ~1 min).
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {Array.from(byDate.entries()).map(([date, dayItems]) => (
            <section key={date}>
              <h2 className="mb-3 flex items-center gap-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {dateLabel(date)}
                <span className="h-px flex-1 bg-border" />
              </h2>
              <div className="space-y-3">
                {dayItems.map((item) => {
                  const meta =
                    CATEGORY_META[item.category as NewsCategory] ??
                    CATEGORY_META.other;
                  return (
                    <article
                      key={item.id as string}
                      className="group rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/30"
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={cn(
                            "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                            meta.dot
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={cn(
                                "rounded px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wide",
                                meta.chip
                              )}
                            >
                              {meta.label}
                            </span>
                            <h3 className="text-sm font-semibold leading-snug">
                              {item.title as string}
                            </h3>
                          </div>
                          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                            {item.summary as string}
                          </p>
                          {item.source_url ? (
                            <a
                              href={item.source_url as string}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                            >
                              {(item.source_name as string) || "Źródło"}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : item.source_name ? (
                            <p className="mt-2 text-xs text-muted-foreground">
                              {item.source_name as string}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
