import { ExternalLink } from "lucide-react";

import { getDemoDashboard } from "@/lib/demo/data";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const CAT = {
  meta: { label: "Meta", cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  google: { label: "Google / YT", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  tiktok: { label: "TikTok", cls: "bg-pink-500/10 text-pink-600 dark:text-pink-400" },
  ai: { label: "AI", cls: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
} as const;

export default function DemoFullNewsy() {
  const d = getDemoDashboard();
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">Newsy — reklama & AI</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Codzienny przegląd: Meta, Google/YouTube, TikTok i AI — zbierane
          automatycznie z sieci.
        </p>
      </div>

      <div className="space-y-3">
        {d.news.map((n, i) => {
          const c = CAT[n.category];
          return (
            <article key={i} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", c.cls)}>{c.label}</span>
                <span className="text-xs text-muted-foreground">{n.publishedOn}</span>
              </div>
              <h2 className="mt-2 text-sm font-semibold">{n.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{n.summary}</p>
              <a href={n.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                {n.sourceName}
                <ExternalLink className="h-3 w-3" />
              </a>
            </article>
          );
        })}
      </div>
    </>
  );
}
