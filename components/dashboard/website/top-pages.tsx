import { Card } from "@tremor/react";

import { formatNumberPL, formatPercent } from "@/lib/utils";

function segments(path: string): string[] {
  return path
    .split(/[?#]/)[0]
    .split("/")
    .filter(Boolean)
    .map((seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        return seg; // malformed %-escape: show it as-is rather than crash
      }
    });
}

/**
 * A slug turned into words ("jesien-2026" -> "Jesien 2026"), or null when
 * that would be gibberish (ids, hashes, "p,123,abc") - then the caller shows
 * the segment as-is. Slugs have no Polish letters; we can't restore them.
 */
function slugToWords(seg: string): string | null {
  const words = seg
    .replace(/\.(html?|php|aspx?)$/i, "")
    .replace(/[-_+]+/g, " ")
    .trim();
  if (!/^[\p{L}\d ]+$/u.test(words)) return null;
  const letters = (words.match(/\p{L}/gu) ?? []).length;
  const digits = (words.match(/\d/g) ?? []).length;
  if (letters < 3 || digits > letters) return null;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "/" -> "Strona główna", "/blog/poradnik-montazu" -> "Poradnik montazu". */
export function prettyPath(path: string): string {
  const segs = segments(path);
  if (segs.length === 0) return "Strona główna";
  const last = segs[segs.length - 1];
  return slugToWords(last) ?? last;
}

/**
 * Where the page sits ("/kategoria/swetry" -> "Kategoria"), shown under the
 * name. Null for top-level pages: repeating "/kontakt" under "Kontakt" adds
 * nothing. The raw path stays available on hover.
 */
function pathContext(path: string): string | null {
  // Skip "pl"/"en"-style locale prefixes - they say nothing to a client.
  const parents = segments(path)
    .slice(0, -1)
    .filter((s) => s.length > 2);
  if (parents.length === 0) return null;
  return parents.map((s) => slugToWords(s) ?? s).join(" › ");
}

// TODO: avg session duration per page (not stored in ga4_daily yet).
export function TopPages({
  pages,
  lang = "pl",
  headingLevel = 2,
}: {
  pages: Array<{ path: string; views: number; engagementRate: number }>;
  lang?: "pl" | "en";
  /** 3 when nested under a section heading (Sprzedaż). */
  headingLevel?: 2 | 3;
}) {
  const en = lang === "en";
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const max = Math.max(1, ...pages.map((p) => p.views));
  return (
    <Card className="flex flex-col">
      <Heading className="text-base font-semibold">
        {en ? "Top pages" : "Co oglądają najchętniej"}
      </Heading>
      <p className="mt-1 text-sm text-muted-foreground">
        {en
          ? "Most viewed pages and how engaging they are."
          : "Najczęściej odwiedzane podstrony i jak bardzo wciągają."}
      </p>
      {pages.length === 0 ? (
        <p className="mt-5 text-sm text-muted-foreground">
          {en
            ? "Page data appears after the next Google Analytics sync."
            : "Lista podstron pojawi się po najbliższej synchronizacji Google Analytics."}
        </p>
      ) : null}
      <ol className="mt-5 space-y-3 empty:hidden">
        {pages.map((p, i) => {
          const context = en ? null : pathContext(p.path);
          return (
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
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
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
              {context ? (
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={p.path}>
                  {context}
                </p>
              ) : null}
            </div>
          </li>
          );
        })}
      </ol>
    </Card>
  );
}
