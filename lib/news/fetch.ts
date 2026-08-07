import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import Anthropic from "@anthropic-ai/sdk";

// Daily industry-news sweep for the "Newsy" tab: one Claude+web-search research
// pass PER CATEGORY (run in parallel), so every filter tab has content - a
// single combined pass tended to skip whole categories. Each category is
// topped up from a wider date window when the freshest pass comes up short, so
// no tab (e.g. Google/YT, which has fewer daily stories) is ever left empty.

export type NewsCategory = "meta" | "google" | "tiktok" | "ai" | "other";

export interface NewsItem {
  category: NewsCategory;
  title: string;
  summary: string;
  source_name: string | null;
  source_url: string | null;
}

// Every category should show at least this many items; if the fresh pass finds
// fewer, we widen the date window and top it up.
const MIN_PER_CATEGORY = 4;
const MAX_PER_CATEGORY = 8;

const CATEGORY_BRIEFS: Array<{ key: NewsCategory; brief: string }> = [
  {
    key: "meta",
    brief:
      "Meta Ads / Facebook / Instagram: nowe funkcje reklamowe, zmiany algorytmu i zasięgów, polityki reklamowe, Advantage+, awarie, zmiany w Ads Managerze i API",
  },
  {
    key: "google",
    brief:
      "Google Ads i YouTube: nowe funkcje kampanii (PMax, Demand Gen, YouTube Ads), zmiany w wyszukiwarce i AI Overviews wpływające na ruch, polityki, Google Marketing Platform. KONIECZNIE poszukaj też osobno newsów o samym YouTube (reklamy, monetyzacja, algorytm, funkcje dla twórców)",
  },
  {
    key: "tiktok",
    brief:
      "TikTok i TikTok Ads: funkcje reklamowe, algorytm, regulacje/bany, TikTok Shop, trendy istotne dla reklamodawców",
  },
  {
    key: "ai",
    brief:
      "AI dla marketerów: OpenAI/ChatGPT, Anthropic/Claude, Google Gemini - nowe modele, narzędzia do reklam/kreacji, AI w platformach reklamowych, wpływ AI na SEO/ruch",
  },
];

/** Why a category came back empty - surfaced by /api/debug/news. */
export interface CategoryDiag {
  category: NewsCategory;
  pass: "fresh" | "backfill";
  stop_reason?: string | null;
  text_len?: number;
  parsed?: number;
  dropped_stale?: number;
  kept?: number;
  repaired_json?: boolean;
  error?: string;
}

/**
 * Parse the model's JSON array, tolerating a response truncated by max_tokens:
 * trim back to the last complete object and close the array.
 */
function parseItemsJson(text: string): {
  parsed: Array<Record<string, unknown>>;
  repaired: boolean;
} {
  const start = text.indexOf("[");
  if (start === -1) return { parsed: [], repaired: false };
  const end = text.lastIndexOf("]");

  if (end > start) {
    try {
      return { parsed: JSON.parse(text.slice(start, end + 1)), repaired: false };
    } catch {
      // fall through to repair
    }
  }

  // Truncated (or malformed tail): keep everything up to the last closed object.
  const body = text.slice(start);
  const lastObj = body.lastIndexOf("}");
  if (lastObj === -1) return { parsed: [], repaired: false };
  try {
    return {
      parsed: JSON.parse(`${body.slice(0, lastObj + 1)}]`),
      repaired: true,
    };
  } catch {
    return { parsed: [], repaired: false };
  }
}

/** One research pass for a single category, gated to `freshCutoff`. */
async function fetchCategoryNews(
  anthropic: Anthropic,
  category: NewsCategory,
  brief: string,
  today: string,
  freshCutoff: string,
  recentTitles: string[],
  pass: "fresh" | "backfill",
  diags: CategoryDiag[]
): Promise<NewsItem[]> {
  const avoid = recentTitles.length
    ? `\n\nTe tematy JUŻ opisaliśmy - pomiń, chyba że jest nowy rozwój:\n${recentTitles
        .slice(0, 25)
        .map((t) => `- ${t}`)
        .join("\n")}`
    : "";

  const diag: CategoryDiag = { category, pass };
  diags.push(diag);

  let response;
  try {
    response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      // Generous budget: the model narrates between web searches, so a tight
      // limit truncated the JSON mid-array and the whole category was silently
      // dropped (parse error -> empty feed).
      max_tokens: 5000,
      // Few searches on purpose: every extra one adds seconds, and the whole
      // request has to finish inside the serverless limit or it is killed
      // mid-flight (the UI then spins forever with no error).
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
      system:
        "Jesteś researcherem newsów dla polskiej agencji marketingowej (patoagencja). Piszesz po polsku, zwięźle, rzeczowo, bez clickbaitu i bez długich myślników.",
      messages: [
        {
          role: "user",
          content: `DZIŚ JEST ${today}. Poszukaj najważniejszych, NAJŚWIEŻSZYCH newsów w temacie:

${brief}

ŚWIEŻOŚĆ: preferuj newsy z ostatnich 2-3 dni. Dla każdego newsa USTAL datę publikacji. Nie dodawaj niczego starszego niż ${freshCutoff} ani bez potwierdzonej daty. Dodawaj do zapytań bieżący miesiąc i rok. Zrób KILKA RÓŻNYCH wyszukiwań (różne frazy), żeby zebrać szeroko i wypełnić kategorię.

Zwróć ${MIN_PER_CATEGORY}-${MAX_PER_CATEGORY} newsów. Dla każdego: data publikacji, rzeczowy tytuł PO POLSKU (max 90 znaków), 2-3 zdania podsumowania PO POLSKU (co się stało i CO TO ZNACZY dla agencji reklamowej), nazwa źródła i URL.${avoid}

WAŻNE: gdy skończysz wyszukiwać, napisz WYŁĄCZNIE tablicę JSON i nic poza nią (bez markdown, bez komentarza przed ani po):
[{"published":"yyyy-mm-dd","title":"...","summary":"...","source_name":"...","source_url":"https://..."}]`,
        },
      ],
    });
  } catch (err) {
    diag.error = err instanceof Error ? err.message : String(err);
    console.error("[news] category call failed", category, pass, diag.error);
    return [];
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  diag.stop_reason = response.stop_reason;
  diag.text_len = text.length;

  const { parsed, repaired } = parseItemsJson(text);
  diag.parsed = parsed.length;
  diag.repaired_json = repaired;

  const withFields = parsed.filter(
    (i) => i && typeof i.title === "string" && typeof i.summary === "string"
  );
  // Freshness gate: publish date must be within the requested window.
  const fresh = withFields.filter((i) => {
    const pub = typeof i.published === "string" ? i.published.slice(0, 10) : "";
    return /^\d{4}-\d{2}-\d{2}$/.test(pub) && pub >= freshCutoff && pub <= today;
  });
  diag.dropped_stale = withFields.length - fresh.length;

  const items = fresh
    .map((i) => ({
      category,
      title: String(i.title).replace(/[–—]/g, "-").slice(0, 200),
      summary: String(i.summary).replace(/[–—]/g, "-").slice(0, 1000),
      source_name: i.source_name ? String(i.source_name).slice(0, 120) : null,
      source_url:
        typeof i.source_url === "string" && /^https?:\/\//.test(i.source_url)
          ? i.source_url.slice(0, 500)
          : null,
    }))
    .slice(0, MAX_PER_CATEGORY);
  diag.kept = items.length;
  return items;
}

/** Merge two item lists, dropping duplicates by normalized title. */
function mergeUnique(a: NewsItem[], b: NewsItem[]): NewsItem[] {
  const seen = new Set(a.map((i) => i.title.toLowerCase().trim()));
  const out = [...a];
  for (const item of b) {
    const key = item.title.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

/**
 * Research one category, guaranteeing it isn't left empty: a fresh pass (last
 * ~2 weeks) first, and if that comes up short, a wider top-up pass (last ~4
 * weeks) to reach MIN_PER_CATEGORY. Slower categories like Google/YT get filled
 * without dragging in genuinely stale (months-old) stories.
 */
async function fetchCategoryWithBackfill(
  anthropic: Anthropic,
  category: NewsCategory,
  brief: string,
  today: string,
  freshCutoff: string,
  widerCutoff: string,
  recentTitles: string[],
  diags: CategoryDiag[]
): Promise<NewsItem[]> {
  const fresh = await fetchCategoryNews(
    anthropic,
    category,
    brief,
    today,
    freshCutoff,
    recentTitles,
    "fresh",
    diags
  );
  if (fresh.length >= MIN_PER_CATEGORY) return fresh.slice(0, MAX_PER_CATEGORY);

  const backfill = await fetchCategoryNews(
    anthropic,
    category,
    brief,
    today,
    widerCutoff,
    // Avoid repeating what the fresh pass already returned.
    [...recentTitles, ...fresh.map((i) => i.title)],
    "backfill",
    diags
  );
  return mergeUnique(fresh, backfill).slice(0, MAX_PER_CATEGORY);
}

/**
 * Fetch today's industry news: four category researches in parallel, each
 * topped up so no tab is empty. `recentTitles` lets the model skip stories
 * covered on previous days. One failed category doesn't sink the rest.
 */
export async function fetchDailyNews(recentTitles: string[]): Promise<NewsItem[]> {
  return (await fetchDailyNewsWithDiag(recentTitles)).items;
}

/** The categories the daily sweep covers, in fill order. */
export const NEWS_CATEGORIES = CATEGORY_BRIEFS.map((c) => c.key);

/**
 * Research ONE category. Researching all four in a single request exceeded the
 * serverless time limit (each pass makes several web searches), which is why
 * the daily refresh silently produced nothing - so the cron now fills one
 * category per invocation instead.
 */
export async function fetchOneCategory(
  category: NewsCategory,
  recentTitles: string[],
  opts: { backfill?: boolean } = {}
): Promise<{ items: NewsItem[]; diags: CategoryDiag[] }> {
  const diags: CategoryDiag[] = [];
  if (!process.env.ANTHROPIC_API_KEY) return { items: [], diags };

  const brief = CATEGORY_BRIEFS.find((c) => c.key === category)?.brief;
  if (!brief) return { items: [], diags };

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const today = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");
  const freshCutoff = formatInTimeZone(subDays(new Date(), 14), "Europe/Warsaw", "yyyy-MM-dd");
  const widerCutoff = formatInTimeZone(subDays(new Date(), 30), "Europe/Warsaw", "yyyy-MM-dd");

  const fresh = await fetchCategoryNews(
    anthropic,
    category,
    brief,
    today,
    freshCutoff,
    recentTitles,
    "fresh",
    diags
  );
  if (fresh.length >= MIN_PER_CATEGORY || opts.backfill === false) {
    return { items: fresh.slice(0, MAX_PER_CATEGORY), diags };
  }

  const backfill = await fetchCategoryNews(
    anthropic,
    category,
    brief,
    today,
    widerCutoff,
    [...recentTitles, ...fresh.map((i) => i.title)],
    "backfill",
    diags
  );
  return { items: mergeUnique(fresh, backfill).slice(0, MAX_PER_CATEGORY), diags };
}

/** Same sweep, but also returns per-category diagnostics for /api/debug/news. */
export async function fetchDailyNewsWithDiag(
  recentTitles: string[]
): Promise<{ items: NewsItem[]; diags: CategoryDiag[] }> {
  const diags: CategoryDiag[] = [];
  if (!process.env.ANTHROPIC_API_KEY) return { items: [], diags };

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const today = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");
  const freshCutoff = formatInTimeZone(
    subDays(new Date(), 14),
    "Europe/Warsaw",
    "yyyy-MM-dd"
  );
  const widerCutoff = formatInTimeZone(
    subDays(new Date(), 30),
    "Europe/Warsaw",
    "yyyy-MM-dd"
  );

  const results = await Promise.allSettled(
    CATEGORY_BRIEFS.map((c) =>
      fetchCategoryWithBackfill(
        anthropic,
        c.key,
        c.brief,
        today,
        freshCutoff,
        widerCutoff,
        recentTitles,
        diags
      )
    )
  );

  for (const r of results) {
    if (r.status === "rejected") {
      console.error("[news] category rejected", r.reason);
    }
  }

  const items = results
    .filter(
      (r): r is PromiseFulfilledResult<NewsItem[]> => r.status === "fulfilled"
    )
    .flatMap((r) => r.value)
    .slice(0, MAX_PER_CATEGORY * CATEGORY_BRIEFS.length);

  return { items, diags };
}
