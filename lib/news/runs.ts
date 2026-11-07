import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchOneCategory, type CategoryDiag, type NewsCategory, type NewsItem } from "./fetch";
import type { NewsRunRow, NewsRunStatus, NewsTarget } from "./plan";

// Database side of the news schedule (lib/news/plan.ts): today's state,
// claiming a category before its paid research call, recording how the call
// ended, and writing the items. news_runs comes from migration 0044; until it
// is applied every reader falls back to "no rows" (no claims, no cap).

const RUNS = "news_runs";
const ITEMS = "news_items";

export interface NewsDayState {
  /** Categories with at least one news_items row for the day. */
  withItems: Set<string>;
  /** The day's news_runs rows; null = table unreadable (not migrated yet). */
  runs: NewsRunRow[] | null;
}

const STATUSES: readonly NewsRunStatus[] = ["running", "done", "failed"];

export async function readNewsDay(
  admin: SupabaseClient,
  day: string
): Promise<{ ok: true; state: NewsDayState } | { ok: false; error: string }> {
  const [items, runs] = await Promise.all([
    admin.from(ITEMS).select("category").eq("published_on", day),
    admin.from(RUNS).select("category, status, attempts, started_at").eq("published_on", day),
  ]);
  if (items.error) return { ok: false, error: items.error.message };
  if (runs.error) {
    console.warn("[news] news_runs unreadable (migration 0044?) - no claims, no cap", runs.error.message);
  }
  return {
    ok: true,
    state: {
      withItems: new Set((items.data ?? []).map((r) => String(r.category))),
      runs: runs.error
        ? null
        : (runs.data ?? []).map((r) => ({
            category: String(r.category),
            status: STATUSES.includes(r.status as NewsRunStatus) ? (r.status as NewsRunStatus) : "failed",
            attempts: Number(r.attempts) || 0,
            started_at: r.started_at ? String(r.started_at) : null,
          })),
    },
  };
}

export type ClaimResult = "claimed" | "taken" | "error";

/**
 * Make this call the owner of `target` for the day, atomically: a fresh
 * category is an INSERT (the primary key rejects a second one), a retry is an
 * UPDATE guarded by the row the plan saw (attempts + status), so of two
 * overlapping callers exactly one gets it and the other skips the paid call.
 */
export async function claimTarget(
  admin: SupabaseClient,
  day: string,
  target: NewsTarget,
  nowIso: string
): Promise<ClaimResult> {
  const row = {
    status: "running" as const,
    attempts: target.attempt,
    started_at: nowIso,
    finished_at: null,
    items: null,
    error: null,
  };
  try {
    if (!target.previous) {
      const { error } = await admin
        .from(RUNS)
        .insert({ published_on: day, category: target.category, ...row });
      if (!error) return "claimed";
      if (error.code === "23505") return "taken";
      console.warn("[news] claim insert failed", target.category, error.message);
      return "error";
    }
    const { data, error } = await admin
      .from(RUNS)
      .update(row)
      .eq("published_on", day)
      .eq("category", target.category)
      .eq("attempts", target.previous.attempts)
      .eq("status", target.previous.status)
      .select("category");
    if (error) {
      console.warn("[news] claim update failed", target.category, error.message);
      return "error";
    }
    return (data ?? []).length === 1 ? "claimed" : "taken";
  } catch (err) {
    console.warn("[news] claim failed", target.category, err instanceof Error ? err.message : err);
    return "error";
  }
}

/** Close our claim. Guarded by `attempt` so it never closes a later one. */
async function finishRun(
  admin: SupabaseClient,
  day: string,
  category: string,
  attempt: number,
  items: number,
  error: string | undefined
): Promise<void> {
  try {
    const { error: dbError } = await admin
      .from(RUNS)
      .update({
        status: items > 0 ? "done" : "failed",
        finished_at: new Date().toISOString(),
        items,
        error: error ? error.slice(0, 500) : null,
      })
      .eq("published_on", day)
      .eq("category", category)
      .eq("attempts", attempt);
    // Not fatal: items in news_items already count as done, and an open
    // claim expires after the lease.
    if (dbError) console.warn("[news] closing run failed", category, dbError.message);
  } catch (err) {
    console.warn("[news] closing run failed", category, err instanceof Error ? err.message : err);
  }
}

/**
 * Today's rows of the category replaced by `items`. The insert is one
 * statement (all rows or none); the delete only matters on a re-run of a
 * filled category, which the claim keeps to one writer at a time.
 */
async function storeItems(
  admin: SupabaseClient,
  day: string,
  category: string,
  items: NewsItem[]
): Promise<string | null> {
  const { error: deleteError } = await admin
    .from(ITEMS)
    .delete()
    .eq("published_on", day)
    .eq("category", category);
  if (deleteError) return deleteError.message;
  const { error } = await admin.from(ITEMS).insert(
    items.map((i) => ({
      published_on: day,
      category: i.category,
      title: i.title,
      summary: i.summary,
      source_name: i.source_name,
      source_url: i.source_url,
    }))
  );
  return error ? error.message : null;
}

/** Titles from recent days, so the model skips stories already covered. */
export async function recentNewsTitles(admin: SupabaseClient): Promise<string[]> {
  const { data } = await admin
    .from(ITEMS)
    .select("title")
    .order("published_on", { ascending: false })
    .limit(40);
  return (data ?? []).map((r) => String(r.title));
}

export interface NewsStepResult {
  category: NewsCategory;
  /** Rows written for the day (0 = nothing usable, see `error`). */
  items: number;
  error?: string;
  /** Items were found but could not be saved. */
  writeError?: string;
  diag: CategoryDiag;
}

/**
 * One step of the schedule: research `category` within `timeoutMs`, write
 * what it found and close the claim (`attempt`; null = unclaimed because
 * news_runs isn't there yet). Never throws.
 */
export async function researchAndStore(
  admin: SupabaseClient,
  day: string,
  category: NewsCategory,
  attempt: number | null,
  recentTitles: string[],
  timeoutMs: number
): Promise<NewsStepResult> {
  let diag: CategoryDiag = { category };
  let stored = 0;
  let error: string | undefined;
  let writeError: string | undefined;
  try {
    const research = await fetchOneCategory(category, recentTitles, { timeoutMs });
    diag = research.diag;
    if (research.items.length > 0) {
      writeError = (await storeItems(admin, day, category, research.items)) ?? undefined;
      if (writeError) error = `zapis do bazy: ${writeError}`;
      else stored = research.items.length;
    } else {
      error =
        diag.error ??
        (diag.timed_out
          ? "przekroczony czas researchu, zanim powstał jakikolwiek news"
          : "brak świeżych newsów w odpowiedzi");
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  if (attempt !== null) await finishRun(admin, day, category, attempt, stored, error);
  return { category, items: stored, error, writeError, diag };
}
