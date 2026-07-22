import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import Anthropic from "@anthropic-ai/sdk";

// Daily industry-news sweep for the "Newsy" tab: Claude with the server-side
// web search tool finds what changed in Meta Ads / Google & YouTube Ads /
// TikTok Ads / AI (OpenAI, Anthropic, Google) and returns compact Polish
// summaries with sources.

export type NewsCategory = "meta" | "google" | "tiktok" | "ai" | "other";

export interface NewsItem {
  category: NewsCategory;
  title: string;
  summary: string;
  source_name: string | null;
  source_url: string | null;
}

const VALID_CATEGORIES: NewsCategory[] = ["meta", "google", "tiktok", "ai", "other"];

/**
 * Fetch today's industry news via Claude + web search. `recentTitles` lets the
 * model skip stories we already covered on previous days.
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

  const avoid = recentTitles.length
    ? `\n\nTe tematy JUŻ opisaliśmy w poprzednich dniach - pomiń je, chyba że jest istotny nowy rozwój:\n${recentTitles
        .slice(0, 40)
        .map((t) => `- ${t}`)
        .join("\n")}`
    : "";

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    tools: [
      {
        type: "web_search_20260209",
        name: "web_search",
        max_uses: 8,
      },
    ],
    system:
      "Jesteś researcherem newsów dla polskiej agencji marketingowej (patoagencja). Zbierasz najświeższe, KONKRETNE newsy istotne dla ludzi robiących płatne kampanie (Meta Ads, Google Ads, YouTube, TikTok Ads) oraz śledzisz rozwój AI (OpenAI/ChatGPT, Anthropic/Claude, Google Gemini) pod kątem wpływu na marketing. Piszesz po polsku, zwięźle, bez clickbaitu i bez długich myślników.",
    messages: [
      {
        role: "user",
        content: `DZIŚ JEST ${today}. Poszukaj w sieci najważniejszych newsów opublikowanych w OSTATNICH 2-3 DNIACH (absolutne maksimum: po ${freshCutoff}) w kategoriach:
1. "meta" - Meta Ads / Facebook / Instagram (nowe funkcje reklamowe, zmiany algorytmu, polityki, awarie)
2. "google" - Google Ads / YouTube / wyszukiwarka (funkcje, AI Overviews, zmiany w kampaniach)
3. "tiktok" - TikTok / TikTok Ads
4. "ai" - AI istotne dla marketerów (OpenAI, Anthropic/Claude, Gemini, nowe modele, narzędzia)

KRYTYCZNE - ŚWIEŻOŚĆ: dla każdego newsa USTAL datę publikacji artykułu. Jeśli artykuł jest starszy niż ${freshCutoff} albo nie możesz potwierdzić daty publikacji - POMIŃ go całkowicie. Lepiej zwrócić 4 świeże newsy niż 10 starych. Dodawaj do zapytań bieżący miesiąc i rok, żeby nie łapać archiwalnych tekstów.

Wybierz 6-12 najistotniejszych (mniej, jeśli mało świeżych). Dla każdego: kategoria, data publikacji, chwytliwy ale rzeczowy tytuł PO POLSKU (max 90 znaków), 2-3 zdania podsumowania PO POLSKU (co się stało i CO TO ZNACZY dla agencji reklamowej), nazwa źródła i URL.${avoid}

Odpowiedz WYŁĄCZNIE poprawnym JSON (bez markdown):
[{"category":"meta|google|tiktok|ai|other","published":"yyyy-mm-dd","title":"...","summary":"...","source_name":"...","source_url":"https://..."}]`,
      },
    ],
  });

  // The final text block carries the JSON (earlier blocks are search activity).
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
      // Hard freshness gate: the model must assert a publish date within the
      // last 7 days - anything older or undated is dropped, no exceptions.
      .filter((i) => {
        const pub = typeof i.published === "string" ? i.published.slice(0, 10) : "";
        return /^\d{4}-\d{2}-\d{2}$/.test(pub) && pub >= freshCutoff && pub <= today;
      })
      .map((i) => ({
        category: VALID_CATEGORIES.includes(i.category as NewsCategory)
          ? (i.category as NewsCategory)
          : "other",
        title: String(i.title).replace(/[–—]/g, "-").slice(0, 200),
        summary: String(i.summary).replace(/[–—]/g, "-").slice(0, 1000),
        source_name: i.source_name ? String(i.source_name).slice(0, 120) : null,
        source_url:
          typeof i.source_url === "string" && /^https?:\/\//.test(i.source_url)
            ? i.source_url.slice(0, 500)
            : null,
      }))
      .slice(0, 15);
  } catch {
    return [];
  }
}
