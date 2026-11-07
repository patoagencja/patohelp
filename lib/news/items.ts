/**
 * Turning the research model's answer into feed rows: parse its JSON array
 * (also when the answer was cut off) and keep the fresh, well-formed items.
 *
 * Keep runtime imports out of this file: its unit tests run it directly under
 * Node's type stripping, which can't resolve the "@/" alias.
 */

export type NewsCategory = "meta" | "google" | "tiktok" | "ai" | "other";

export interface NewsItem {
  category: NewsCategory;
  title: string;
  summary: string;
  source_name: string | null;
  source_url: string | null;
}

/** Items asked for per category. Fewer, shorter items keep the call short. */
export const MIN_PER_CATEGORY = 4;
export const MAX_PER_CATEGORY = 6;

/** How many closing braces the repair walks back over before giving up. */
const REPAIR_TRIES = 12;

/**
 * Parse the model's JSON array, tolerating an answer that stopped mid-array -
 * max_tokens, or the research deadline cutting the stream: trim back to the
 * last complete object and close the array. Those items cost as much as the
 * rest, so they are kept rather than thrown away with the tail.
 */
export function parseItemsJson(text: string): {
  parsed: Array<Record<string, unknown>>;
  repaired: boolean;
} {
  // The array starts at "[{"; a lone "[" may sit in the narration before it.
  const match = /\[\s*\{/.exec(text);
  const start = match ? match.index : text.indexOf("[");
  if (start === -1) return { parsed: [], repaired: false };
  const end = text.lastIndexOf("]");

  if (end > start) {
    try {
      const parsed: unknown = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(parsed)) return { parsed: objectsOnly(parsed), repaired: false };
    } catch {
      // fall through to repair
    }
  }

  // Cut off (or a malformed tail): keep everything up to the last object that
  // closes cleanly. A "}" inside a half-written string is skipped by trying
  // the previous one.
  const body = text.slice(start);
  let close = body.lastIndexOf("}");
  for (let tries = 0; close !== -1 && tries < REPAIR_TRIES; tries += 1) {
    try {
      const parsed: unknown = JSON.parse(`${body.slice(0, close + 1)}]`);
      if (Array.isArray(parsed)) return { parsed: objectsOnly(parsed), repaired: true };
    } catch {
      // try the previous closing brace
    }
    close = body.lastIndexOf("}", close - 1);
  }
  return { parsed: [], repaired: false };
}

function objectsOnly(list: unknown[]): Array<Record<string, unknown>> {
  return list.filter(
    (i): i is Record<string, unknown> => typeof i === "object" && i !== null && !Array.isArray(i)
  );
}

/**
 * Parsed objects -> feed rows of `category`: title and summary required,
 * published between `freshCutoff` and `today` (yyyy-MM-dd), long dashes
 * flattened, lengths capped, at most MAX_PER_CATEGORY.
 */
export function normalizeItems(
  parsed: ReadonlyArray<Record<string, unknown>>,
  category: NewsCategory,
  today: string,
  freshCutoff: string
): { items: NewsItem[]; dropped_stale: number; date_gate_bypassed: boolean } {
  const withFields = parsed.filter(
    (i) => typeof i.title === "string" && i.title.trim() !== "" && typeof i.summary === "string"
  );
  // Freshness gate: publish date must be within the requested window.
  const fresh = withFields.filter((i) => {
    const pub = typeof i.published === "string" ? i.published.slice(0, 10) : "";
    return /^\d{4}-\d{2}-\d{2}$/.test(pub) && pub >= freshCutoff && pub <= today;
  });

  // If the gate rejected EVERYTHING (unparseable or slightly older dates), keep
  // what the model actually found rather than leaving the category empty: an
  // empty category costs another paid research call, while a story a few days
  // past the cutoff is still worth showing.
  const usable = fresh.length > 0 ? fresh : withFields;

  const items = usable
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

  return {
    items,
    dropped_stale: withFields.length - fresh.length,
    date_gate_bypassed: fresh.length === 0 && withFields.length > 0,
  };
}
