import { plPlural } from "@/lib/dashboard/story";
import type { SearchTermRow } from "@/lib/dashboard/search-terms";
import { cn, formatMoneyPLN, formatNumberPL } from "@/lib/utils";

type Lang = "pl" | "en";

const TOP_TERMS = 15;
const TOP_TOPICS = 8;
const MIN_WORD_LENGTH = 4;

// Only words of MIN_WORD_LENGTH+ chars can reach the chips, so this lists the
// longer Polish function words and web noise that would otherwise crowd out
// real topics. Intent words like "cena", "opinie", "sklep" stay on purpose -
// they ARE the market research.
const STOPWORDS = new Set([
  "albo", "oraz", "przez", "przy", "przed", "jest", "jako", "czyli", "tylko",
  "bardzo", "można", "mozna", "jaki", "jaka", "jakie", "jakiej", "jakich",
  "jakim", "który", "ktory", "która", "ktora", "które", "ktore", "gdzie",
  "kiedy", "dlaczego", "sobie", "swoje", "moje", "twoje", "tego", "tych",
  "taki", "takie", "będzie", "bedzie", "między", "miedzy", "http", "https",
  "html",
]);

/** Distinct meaningful words of a phrase (lowercase, letters/digits only). */
function wordsOf(term: string): string[] {
  const words = term.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return Array.from(
    new Set(
      words.filter(
        (w) => w.length >= MIN_WORD_LENGTH && !STOPWORDS.has(w) && !/^\d+$/.test(w)
      )
    )
  );
}

interface Topic {
  word: string;
  weight: number;
}

/**
 * Most frequent words weighted by clicks, so "montaż" in one phrase with 300
 * clicks outranks a word sprinkled across ten phrases nobody clicked. Falls
 * back to impressions when the period has no clicks at all.
 */
function topTopics(terms: SearchTermRow[], byClicks: boolean): Topic[] {
  const weights = new Map<string, number>();
  let total = 0;
  for (const t of terms) {
    const w = byClicks ? t.clicks : t.impressions;
    if (w <= 0) continue;
    total += w;
    for (const word of new Set(wordsOf(t.term))) {
      weights.set(word, (weights.get(word) ?? 0) + w);
    }
  }
  // A word in nearly every phrase ("drzwi" for a door maker) is the client's
  // own category - a chip for it is noise.
  return Array.from(weights, ([word, weight]) => ({ word, weight }))
    .filter((t) => total === 0 || t.weight / total <= 0.8)
    .sort((a, b) => b.weight - a.weight || a.word.localeCompare(b.word, "pl"))
    .slice(0, TOP_TOPICS);
}

/**
 * "Every 12th showing ends in a click" lands better than "CTR 8,3%". Counted
 * per showing, not per person - one searcher can see the ad several times.
 */
function clickRateInWords(t: SearchTermRow, en: boolean): string {
  if (t.clicks <= 0 || t.impressions <= 0) return en ? "no clicks yet" : "jeszcze bez kliknięć";
  const every = Math.round(t.impressions / t.clicks);
  if (every <= 1) return en ? "clicked almost every time" : "klikana prawie za każdym razem";
  return en ? `1 click per ${every} showings` : `kliknięcie co ${every}. wyświetlenie`;
}

function takeaway(
  terms: SearchTermRow[],
  topics: Topic[],
  totalWeight: number,
  byClicks: boolean,
  en: boolean
): string {
  const top = terms[0];
  const quoted = en ? `"${top.term}"` : `„${top.term}”`;
  if (!byClicks) {
    return en
      ? `Your ads showed for ${formatNumberPL(terms.length)} different searches - most often ${quoted}.`
      : `Twoje reklamy pokazały się przy ${formatNumberPL(terms.length)} różnych wyszukiwaniach - najczęściej ${quoted}.`;
  }
  // A word present in nearly every phrase ("drzwi" for a door maker) is
  // obvious to the client; prefer the first topic that actually tells them
  // something, and only mention it if it carries a real share.
  const topic = topics.find((t) => t.weight / totalWeight < 0.75) ?? topics[0];
  const share = topic ? Math.round((topic.weight / totalWeight) * 100) : 0;
  const lead = en
    ? `The most clicked search was ${quoted}`
    : `Najczęściej klikana fraza to ${quoted}`;
  if (!topic || share < 10) return `${lead}.`;
  return en
    ? `${lead}, and ${share}% of all clicks came from searches about "${topic.word}".`
    : `${lead}, a ${share}% wszystkich kliknięć dotyczyło tematu „${topic.word}”.`;
}

/**
 * "Czego szukają Twoi klienci" - the Google searches that triggered the
 * client's ads. Free market research in their customers' own words, so it's
 * phrased as plain sentences rather than a metrics table. Renders nothing
 * without data (no Search campaigns, or not synced yet).
 */
export function SearchTerms({
  terms,
  lang = "pl",
}: {
  terms: SearchTermRow[];
  lang?: Lang;
}) {
  if (terms.length === 0) return null;
  const en = lang === "en";

  const totalClicks = terms.reduce((a, t) => a + t.clicks, 0);
  const byClicks = totalClicks > 0;
  const ranked = [...terms]
    .sort((a, b) =>
      byClicks ? b.clicks - a.clicks || b.impressions - a.impressions : b.impressions - a.impressions
    )
    .slice(0, TOP_TERMS);
  const topics = topTopics(terms, byClicks);
  const totalWeight = byClicks ? totalClicks : terms.reduce((a, t) => a + t.impressions, 0);
  const maxTopic = topics[0]?.weight ?? 0;
  const maxRow = byClicks ? ranked[0].clicks : ranked[0].impressions;

  return (
    <section aria-labelledby="search-terms-heading" className="glass min-w-0 rounded-glass p-6 sm:p-7">
      <p className="kick">{en ? "Google search · last 30 days" : "Wyszukiwarka Google · ostatnie 30 dni"}</p>
      <h2 id="search-terms-heading" className="mt-2 text-[22px] font-medium tracking-[-0.03em] text-foreground">
        {en ? "What your customers search for" : "Czego szukają Twoi klienci"}
      </h2>
      <p className="mt-1.5 text-sm text-ink-3">
        {en
          ? "Phrases typed into Google that showed your ads - last 30 days"
          : "Frazy wpisane w Google, po których pokazały się Twoje reklamy - ostatnie 30 dni"}
      </p>
      <p className="mt-4 max-w-3xl text-[15px] leading-relaxed text-ink-2">{takeaway(ranked, topics, totalWeight, byClicks, en)}</p>

      {topics.length > 0 ? (
        <div className="mt-5">
          <h3 className="kick text-[11px]">
            {en ? "Most popular topics" : "Najpopularniejsze tematy"}
          </h3>
          <ul className="mt-3 flex flex-wrap items-center gap-2">
            {topics.map((t) => {
              // Three size steps read as "big / medium / small" at a glance;
              // a continuous scale just looks uneven. Only the big topics
              // get the signature lime; the rest stay quiet.
              const ratio = maxTopic > 0 ? t.weight / maxTopic : 0;
              return (
                <li
                  key={t.word}
                  className={cn(
                    "rounded-full",
                    ratio >= 0.6
                      ? "bg-lime px-3.5 py-1.5 text-base font-semibold text-lime-foreground"
                      : ratio >= 0.3
                        ? "bg-lime-soft px-3 py-1 text-sm font-medium text-foreground"
                        : "bg-chip px-2.5 py-0.5 text-xs text-foreground"
                  )}
                  title={
                    byClicks
                      ? `${formatNumberPL(t.weight)} ${en ? "clicks" : plPlural(t.weight, "kliknięcie", "kliknięcia", "kliknięć")}`
                      : `${formatNumberPL(t.weight)} ${en ? "impressions" : plPlural(t.weight, "wyświetlenie", "wyświetlenia", "wyświetleń")}`
                  }
                >
                  {t.word}
                  <span className="ml-1.5 text-[0.8em] font-normal tabular-nums opacity-75">
                    {formatNumberPL(t.weight)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <h3 className="kick mt-7 text-[11px]">
        {en ? `Top ${ranked.length} searches` : `${ranked.length} najczęstszych fraz`}
      </h3>
      {/* CSS columns (not grid) so the ranking reads down the first column
          and continues in the second, like a printed list. */}
      <ol className="mt-2 lg:columns-2 lg:gap-10">
        {ranked.map((t, i) => {
          const value = byClicks ? t.clicks : t.impressions;
          const width = maxRow > 0 ? Math.max(4, Math.round((value / maxRow) * 100)) : 0;
          const cpc = t.clicks > 0 ? Math.round(t.costMinorUnits / t.clicks) : null;
          return (
            <li
              key={t.term}
              className="flex break-inside-avoid items-start gap-3 border-b border-line py-3 last:border-b-0"
            >
              {/* Rank chip (board `.rk`): the winner in lime, the digit
                  carries the place either way. */}
              <span
                className={cn(
                  "grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full text-[13px] font-semibold tabular-nums",
                  i === 0 ? "bg-lime text-lime-foreground" : "bg-chip text-ink-2"
                )}
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-[15px] font-medium">
                  {en ? `"${t.term}"` : `„${t.term}”`}
                </p>
                {/* The top phrase is the highlighted (striped lime) bar,
                    everything else quiet grey - its rank number says the
                    same without colour. */}
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-chip" aria-hidden>
                  <div
                    className={cn(
                      "h-2 origin-left rounded-full animate-grow",
                      i === 0 ? "share-fill" : "bg-prev"
                    )}
                    style={{ width: `${width}%`, "--d": `${0.2 + i * 0.04}s` } as React.CSSProperties}
                  />
                </div>
                <p className="mt-1.5 text-xs tabular-nums text-ink-3">
                  {clickRateInWords(t, en)}
                  {cpc != null
                    ? ` · ${formatMoneyPLN(cpc)} ${en ? "per click" : "za kliknięcie"}`
                    : null}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <span className="block text-[15px] font-medium tabular-nums">
                  {formatNumberPL(value)}
                </span>
                <span className="block text-[11px] text-ink-3">
                  {byClicks
                    ? en
                      ? "clicks"
                      : plPlural(value, "kliknięcie", "kliknięcia", "kliknięć")
                    : en
                      ? "impressions"
                      : plPlural(value, "wyświetlenie", "wyświetlenia", "wyświetleń")}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
