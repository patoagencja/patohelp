import { ShowMoreList } from "@/components/dashboard/show-more-list";
import { Card } from "@/components/ui/card";

import { cn, formatNumberPL, formatPercent } from "@/lib/utils";

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
  const cols = "grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-x-3 sm:grid-cols-[30px_minmax(0,1fr)_7rem_8.5rem] sm:gap-x-4";
  return (
    <Card className="flex flex-col p-6 sm:p-[28px_30px]">
      <p className="kick">{en ? "Pages" : "Podstrony"}</p>
      <Heading className="mt-2 text-[22px] font-medium leading-tight tracking-[-0.03em] text-foreground">
        {en ? "Top pages" : "Najczęściej oglądane strony"}
      </Heading>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
        {en
          ? "Most viewed pages and how engaging they are."
          : "Ile razy je wyświetlono i jaka część wizyt była zainteresowana."}
      </p>
      {periodNote ? <p className="mt-1 text-[13px] text-ink-3">{periodNote}</p> : null}
      {pages.length === 0 ? (
        <p className="mt-5 text-sm text-ink-2">
          {en
            ? "Page data appears after the next Google Analytics sync."
            : "Lista podstron pojawi się po najbliższej synchronizacji Google Analytics."}
        </p>
      ) : (
        // Column heads (sm+): on phones the engaged share rides under the
        // views instead, so the row never scrolls sideways.
        <div aria-hidden className={cn(cols, "mt-5 hidden pb-3 sm:grid [&>span]:kick [&>span]:text-[10.5px] [&>span]:tracking-[0.1em]")}>
          <span>#</span>
          <span>{en ? "Page" : "Podstrona"}</span>
          <span className="text-right">{en ? "Views" : "Wyświetlenia"}</span>
          <span className="text-right">{en ? "Engaged" : "Zainteresowani"}</span>
        </div>
      )}
      <ShowMoreList
        initial={limit}
        className="mt-2 empty:hidden sm:mt-0"
        moreLabel={en ? "Show all" : "Pokaż wszystkie"}
        lessLabel={en ? "Show less" : "Pokaż mniej"}
      >
        {pages.map((p, i) => {
          const name = en ? p.path : prettyPath(p.path);
          const context = en ? null : pathContext(p.path);
          const engaged = formatPercent(p.engagementRate, 0);
          return (
          <li key={p.path} className={cn(cols, "border-t border-line py-3.5 first:border-t-0 sm:first:border-t")}>
            {/* Rank chip: the leader in lime, the rest quiet chips. */}
            <span
              className={cn(
                "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                i === 0 ? "bg-lime text-lime-foreground shadow-lime-glow" : "bg-chip text-ink-2"
              )}
            >
              <span className="sr-only">{en ? "Rank " : "Miejsce "}</span>
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-medium" title={p.path}>
                {name}
              </p>
              {/* The raw address in mono, like the board; the parent
                  section in words when the slug is deep. */}
              {!en ? (
                <p className="mt-1 truncate font-mono text-xs text-ink-3" title={p.path}>
                  {p.path}
                  {context ? <span className="font-sans"> · {context}</span> : null}
                </p>
              ) : null}
            </div>
            <p className="text-right text-[15px] font-medium tabular-nums">
              {formatNumberPL(p.views)}
              <span className="sr-only"> {en ? "views" : "wyświetleń"}</span>
              <span className="block text-xs font-normal text-ink-3 sm:hidden">
                {engaged} {en ? "engaged" : "zainteres."}
              </span>
            </p>
            <p
              className="hidden text-right text-[15px] tabular-nums text-ink-2 sm:block"
              title={en ? "Engagement rate" : "Odsetek zainteresowanych wizyt"}
            >
              {engaged}
              <span className="sr-only"> {en ? "engaged" : "zainteresowanych"}</span>
            </p>
          </li>
          );
        })}
      </ShowMoreList>
    </Card>
  );
}
