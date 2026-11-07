import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import Anthropic from "@anthropic-ai/sdk";

import {
  MAX_PER_CATEGORY,
  MIN_PER_CATEGORY,
  normalizeItems,
  parseItemsJson,
  type NewsCategory,
  type NewsItem,
} from "./items";

export type { NewsCategory, NewsItem } from "./items";

// Industry-news research for the "Newsy" tab: ONE Claude + web search call
// per category. The callers (refresh-news cron, refresh button) decide which
// categories to research and give every call a deadline - lib/news/plan.ts.

const CATEGORY_BRIEFS: Array<{ key: NewsCategory; brief: string }> = [
  {
    key: "meta",
    brief:
      "Meta Ads / Facebook / Instagram: nowe funkcje reklamowe, zmiany algorytmu i zasięgów, polityki reklamowe, Advantage+, awarie, zmiany w Ads Managerze i API",
  },
  {
    key: "google",
    brief:
      "Google Ads i YouTube: nowe funkcje kampanii (PMax, Demand Gen, YouTube Ads), zmiany w wyszukiwarce i AI Overviews wpływające na ruch, polityki, Google Marketing Platform. KONIECZNIE jedno z wyszukiwań poświęć samemu YouTube (reklamy, monetyzacja, algorytm, funkcje dla twórców)",
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

/** The categories the daily feed covers, in fill order. */
export const NEWS_CATEGORIES = CATEGORY_BRIEFS.map((c) => c.key);

export function isNewsCategory(value: string | null | undefined): value is NewsCategory {
  return NEWS_CATEGORIES.includes(value as NewsCategory);
}

const MODEL = "claude-sonnet-4-6";

// The time of one call is mostly its search rounds and the JSON it writes.
// Two searches cover a category (the brief asks for one per sub-topic where
// it matters), and 4-6 items fit well inside max_tokens.
const MAX_SEARCHES = 2;
const MAX_TOKENS = 4000;

/** What one research call did - returned by the routes for diagnosis. */
export interface CategoryDiag {
  category: NewsCategory;
  ms?: number;
  stop_reason?: string | null;
  /** The deadline cut the call; items are whatever had streamed in by then. */
  timed_out?: boolean;
  text_len?: number;
  parsed?: number;
  dropped_stale?: number;
  kept?: number;
  repaired_json?: boolean;
  /** Every item failed the date gate, so the gate was ignored to avoid an
   *  empty category (which would cost another call). */
  date_gate_bypassed?: boolean;
  input_tokens?: number;
  output_tokens?: number;
  web_searches?: number;
  error?: string;
}

function textOf(message: Anthropic.Message | undefined): string {
  // Joined with "" on purpose: citations split one answer into several text
  // blocks, sometimes inside a JSON string, where a newline is invalid JSON.
  return (message?.content ?? [])
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * Research ONE category within `timeoutMs`. Streamed, so when the deadline
 * cuts the call the items written so far are still used (the answer is paid
 * for either way). Never throws: failures come back in `diag.error`.
 */
export async function fetchOneCategory(
  category: NewsCategory,
  recentTitles: string[],
  opts: { timeoutMs: number }
): Promise<{ items: NewsItem[]; diag: CategoryDiag }> {
  const diag: CategoryDiag = { category };
  if (!process.env.ANTHROPIC_API_KEY) {
    diag.error = "ANTHROPIC_API_KEY missing";
    return { items: [], diag };
  }
  const brief = CATEGORY_BRIEFS.find((c) => c.key === category)?.brief;
  if (!brief) {
    diag.error = `unknown category ${category}`;
    return { items: [], diag };
  }

  const now = new Date();
  const today = formatInTimeZone(now, "Europe/Warsaw", "yyyy-MM-dd");
  const freshCutoff = formatInTimeZone(subDays(now, 14), "Europe/Warsaw", "yyyy-MM-dd");
  const avoid = recentTitles.length
    ? `\n\nTe tematy JUŻ opisaliśmy - pomiń, chyba że jest nowy rozwój:\n${recentTitles
        .slice(0, 25)
        .map((t) => `- ${t}`)
        .join("\n")}`
    : "";

  // No SDK retries: a retry is a second paid call and doubles the wall time
  // past the deadline. The next scheduler tick is the retry (capped per day).
  // `timeout` only bounds the wait for the response to start; the timer below
  // bounds the whole streamed call.
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxRetries: 0,
    timeout: Math.max(1_000, opts.timeoutMs),
  });

  const started = Date.now();
  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: MAX_SEARCHES }],
    system:
      "Jesteś researcherem newsów dla polskiej agencji marketingowej (patoagencja). Piszesz po polsku, zwięźle, rzeczowo, bez clickbaitu i bez długich myślników.",
    messages: [
      {
        role: "user",
        content: `DZIŚ JEST ${today}. Poszukaj najważniejszych, NAJŚWIEŻSZYCH newsów w temacie:

${brief}

ŚWIEŻOŚĆ: preferuj newsy z ostatnich 2-3 dni. Dla każdego newsa USTAL datę publikacji. Nie dodawaj niczego starszego niż ${freshCutoff} ani bez potwierdzonej daty. Dodawaj do zapytań bieżący miesiąc i rok. Masz ${MAX_SEARCHES} wyszukiwania - użyj RÓŻNYCH fraz, żeby zebrać szeroko. Między wyszukiwaniami nic nie pisz.

Zwróć ${MIN_PER_CATEGORY}-${MAX_PER_CATEGORY} newsów. Dla każdego: data publikacji, rzeczowy tytuł PO POLSKU (max 90 znaków), 2 zdania podsumowania PO POLSKU (co się stało i CO TO ZNACZY dla agencji reklamowej), nazwa źródła i URL.${avoid}

WAŻNE: gdy skończysz wyszukiwać, napisz WYŁĄCZNIE tablicę JSON i nic poza nią (bez markdown, bez komentarza przed ani po):
[{"published":"yyyy-mm-dd","title":"...","summary":"...","source_name":"...","source_url":"https://..."}]`,
      },
    ],
  });
  const timer = setTimeout(() => {
    diag.timed_out = true;
    stream.abort();
  }, Math.max(0, opts.timeoutMs));

  let message: Anthropic.Message | undefined;
  try {
    message = await stream.finalMessage();
  } catch (err) {
    // Aborted at the deadline (or failed midway): keep the partial answer.
    message = stream.currentMessage;
    if (!diag.timed_out) diag.error = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
  }
  diag.ms = Date.now() - started;
  if (diag.error || diag.timed_out) {
    console.error("[news] research call cut short", category, diag.timed_out ? "deadline" : diag.error);
  }

  diag.stop_reason = message?.stop_reason ?? null;
  diag.input_tokens = message?.usage?.input_tokens;
  diag.output_tokens = message?.usage?.output_tokens;
  diag.web_searches = message?.usage?.server_tool_use?.web_search_requests;

  const text = textOf(message);
  diag.text_len = text.length;
  const { parsed, repaired } = parseItemsJson(text);
  diag.parsed = parsed.length;
  diag.repaired_json = repaired;

  const { items, dropped_stale, date_gate_bypassed } = normalizeItems(
    parsed,
    category,
    today,
    freshCutoff
  );
  diag.dropped_stale = dropped_stale;
  diag.date_gate_bypassed = date_gate_bypassed;
  diag.kept = items.length;
  return { items, diag };
}
