import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import Anthropic from "@anthropic-ai/sdk";

// Daily industry-news sweep for the "Newsy" tab: one Claude+web-search research
// pass PER CATEGORY (run in parallel), so every filter tab has content - a
// single combined pass tended to skip whole categories.

export type NewsCategory = "meta" | "google" | "tiktok" | "ai" | "other";

export interface NewsItem {
  category: NewsCategory;
  title: string;
  summary: string;
  source_name: string | null;
  source_url: string | null;
}

const CATEGORY_BRIEFS: Array<{ key: NewsCategory; brief: string }> = [
  {
    key: "meta",
    brief:
      "Meta Ads / Facebook / Instagram: nowe funkcje reklamowe, zmiany algorytmu i zasięgów, polityki reklamowe, Advantage+, awarie, zmiany w Ads Managerze i API",
  },
  {
    key: "google",
    brief:
      "Google Ads i YouTube: nowe funkcje kampanii (PMax, Demand Gen, YouTube Ads), zmiany w wyszukiwarce i AI Overviews wpływające na ruch, polityki, Google Marketing Platform. KONIECZNIE poszukaj też osobno newsów o samym YouTube (reklamy, monetyzacja, algorytm)",
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

/** One research pass for a single category. */
async function fetchCategoryNews(
  anthropic: Anthropic,
  category: NewsCategory,
  brief: string,
  today: string,
  freshCutoff: string,
  recentTitles: string[]
): Promise<NewsItem[]> {
  const avoid = recentTitles.length
    ? `\n\nTe tematy JUŻ opisaliśmy - pomiń, chyba że jest nowy rozwój:\n${recentTitles
        .slice(0, 25)
        .map((t) => `- ${t}`)
        .join("\n")}`
    : "";

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 3000,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
    system:
      "Jesteś researcherem newsów dla polskiej agencji marketingowej (patoagencja). Piszesz po polsku, zwięźle, rzeczowo, bez clickbaitu i bez długich myślników.",
    messages: [
      {
        role: "user",
        content: `DZIŚ JEST ${today}. Poszukaj najważniejszych newsów opublikowanych w OSTATNICH 2-3 DNIACH (absolutne maksimum: po ${freshCutoff}) w temacie:

${brief}

KRYTYCZNE - ŚWIEŻOŚĆ: dla każdego newsa USTAL datę publikacji. Artykuł starszy niż ${freshCutoff} albo bez potwierdzonej daty - POMIŃ. Dodawaj do zapytań bieżący miesiąc i rok. Zrób KILKA RÓŻNYCH wyszukiwań (różne frazy), żeby zebrać szeroko.

Zwróć 3-6 newsów (mniej tylko jeśli naprawdę brak świeżych). Dla każdego: data publikacji, rzeczowy tytuł PO POLSKU (max 90 znaków), 2-3 zdania podsumowania PO POLSKU (co się stało i CO TO ZNACZY dla agencji reklamowej), nazwa źródła i URL.${avoid}

Odpowiedz WYŁĄCZNIE poprawnym JSON (bez markdown):
[{"published":"yyyy-mm-dd","title":"...","summary":"...","source_name":"...","source_url":"https://..."}]`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const jsonStart = text.indexOf("[");
  const jsonEnd = text.lastIndexOf("]");
  if (jsonStart === -1 || jsonEnd === -1) return [];

  try {
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as Array<
      Record<string, unknown>
    >;
    return parsed
      .filter((i) => i && typeof i.title === "string" && typeof i.summary === "string")
      // Hard freshness gate: publish date must be within the last 7 days.
      .filter((i) => {
        const pub = typeof i.published === "string" ? i.published.slice(0, 10) : "";
        return /^\d{4}-\d{2}-\d{2}$/.test(pub) && pub >= freshCutoff && pub <= today;
      })
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
      .slice(0, 6);
  } catch {
    return [];
  }
}

/**
 * Fetch today's industry news: four category researches in parallel.
 * `recentTitles` lets the model skip stories covered on previous days.
 * One failed category doesn't sink the rest.
 */
export async function fetchDailyNews(recentTitles: string[]): Promise<NewsItem[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const today = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");
  const freshCutoff = formatInTimeZone(
    subDays(new Date(), 7),
    "Europe/Warsaw",
    "yyyy-MM-dd"
  );

  const results = await Promise.allSettled(
    CATEGORY_BRIEFS.map((c) =>
      fetchCategoryNews(anthropic, c.key, c.brief, today, freshCutoff, recentTitles)
    )
  );

  return results
    .filter(
      (r): r is PromiseFulfilledResult<NewsItem[]> => r.status === "fulfilled"
    )
    .flatMap((r) => r.value)
    .slice(0, 24);
}
