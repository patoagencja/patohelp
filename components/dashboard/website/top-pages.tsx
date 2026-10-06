import { ShowMoreList } from "@/components/dashboard/show-more-list";
import { Card } from "@/components/ui/card";

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
  periodNote,
  limit = 5,
}: {
  /** Rows shown before "Pokaż wszystkie". */
  limit?: number;
  pages: Array<{ path: string; views: number; engagementRate: number }>;
  /** Data window, when the page around it shows a different period. */
  periodNote?: string;
  lang?: "pl" | "en";
  /** 3 when nested under a section heading (Sprzedaż). */
  headingLevel?: 2 | 3;
}) {
  const en = lang === "en";
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const max = Math.max(1, ...pages.map((p) => p.views));
  return (
    <Card className="flex flex-col p-5 sm:p-6">
      <Heading className="text-section-title text-foreground">
        {en ? "Top pages" : "Najczęściej oglądane strony"}
      </Heading>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        {en
          ? "Most viewed pages and how engaging they are."
          : "Ile razy je wyświetlono i jaka część wizyt była zainteresowana."}
      </p>
      {periodNote ? <p className="mt-1 text-xs text-muted-foreground">{periodNote}</p> : null}
      {pages.length === 0 ? (
        <p className="mt-5 text-sm text-muted-foreground">
          {en
            ? "Page data appears after the next Google Analytics sync."
            : "Lista podstron pojawi się po najbliższej synchronizacji Google Analytics."}
        </p>
      ) : null}
      <ShowMoreList
        initial={limit}
        className="mt-5 space-y-3 empty:hidden"
        moreLabel={en ? "Show all" : "Pokaż wszystkie"}
        lessLabel={en ? "Show less" : "Pokaż mniej"}
      >
        {pages.map((p, i) => {
          const context = en ? null : pathContext(p.path);
          return (
          <li key={p.path} className="flex items-center gap-3">
            <span className="w-5 shrink-0 self-start pt-px text-right text-sm tabular-nums text-muted-foreground">
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
                    className="h-full rounded-full bg-primary/80"
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
      </ShowMoreList>
    </Card>
  );
}
