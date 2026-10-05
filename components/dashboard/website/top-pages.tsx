import { Card } from "@tremor/react";

import { formatNumberPL, formatPercent } from "@/lib/utils";

/** "/" -> "Strona główna", "/blog/poradnik-montazu" -> "Poradnik montazu". */
export function prettyPath(path: string): string {
  const clean = path.split("?")[0].replace(/\/+$/, "");
  if (clean === "" || clean === "/") return "Strona główna";
  const last = decodeURIComponent(clean.split("/").filter(Boolean).pop() ?? clean)
    .replace(/\.(html?|php)$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return last ? last.charAt(0).toUpperCase() + last.slice(1) : clean;
}

// TODO: avg session duration per page (not stored in ga4_daily yet).
export function TopPages({
  pages,
  lang = "pl",
}: {
  pages: Array<{ path: string; views: number; engagementRate: number }>;
  lang?: "pl" | "en";
}) {
  const en = lang === "en";
  const max = Math.max(1, ...pages.map((p) => p.views));
  return (
    <Card className="flex flex-col">
      <h3 className="text-base font-semibold">
        {en ? "Top pages" : "Co oglądają najchętniej"}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {en
          ? "Most viewed pages and how engaging they are."
          : "Najczęściej odwiedzane podstrony i jak bardzo wciągają."}
      </p>
      <ol className="mt-5 space-y-3">
        {pages.map((p, i) => (
          <li key={p.path} className="flex items-center gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums text-muted-foreground">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-sm font-medium" title={p.path}>
                  {en ? p.path : prettyPath(p.path)}
                </p>
                <p className="shrink-0 text-sm font-semibold tabular-nums">
                  {formatNumberPL(p.views)}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    {en ? "views" : "wyśw."}
                  </span>
                </p>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${(p.views / max) * 100}%` }}
                  />
                </div>
                <span
                  className="shrink-0 text-xs tabular-nums text-muted-foreground"
                  title={en ? "Engagement rate" : "Odsetek zainteresowanych wizyt"}
                >
                  {formatPercent(p.engagementRate, 0)} {en ? "engaged" : "zainteres."}
                </span>
              </div>
              {!en && p.path.replace(/\/+$/, "") !== "" ? (
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">{p.path}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
