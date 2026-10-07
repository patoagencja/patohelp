import { addDays, format, getDaysInMonth, startOfMonth } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAdsSpendTotal } from "@/lib/dashboard/ads-totals";
import { createClient } from "@/lib/supabase/server";

const WARSAW_TZ = "Europe/Warsaw";

export type BudgetPace = "ok" | "slow" | "fast" | "none";

export interface BudgetStatus {
  hasBudget: boolean;
  budgetMinorUnits: number;
  spentMinorUnits: number;
  spentPercent: number;
  dayOfMonth: number;
  daysInMonth: number;
  monthPercent: number;
  pace: BudgetPace;
  paceLabel: string;
  month: string; // yyyy-MM-01
}

export interface ClientAlert {
  id: string;
  severity: "info" | "warning" | "critical";
  category: string;
  title: string;
  description: string;
  generatedAt: string;
}

export interface ClientEvent {
  id: string;
  eventDate: string;
  title: string;
  description: string | null;
  eventType: string | null;
}

export interface AiSummary {
  summaryText: string;
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
}

/** Current-month budget vs actual spend, with pacing verdict. */
export async function getBudgetStatus(clientId: string): Promise<BudgetStatus> {
  const supabase = createClient();

  const todayStr = formatInTimeZone(new Date(), WARSAW_TZ, "yyyy-MM-dd");
  const today = new Date(`${todayStr}T00:00:00`);
  const monthStart = format(startOfMonth(today), "yyyy-MM-dd");
  const dayOfMonth = today.getDate();
  const daysInMonth = getDaysInMonth(today);
  const monthPercent = (dayOfMonth / daysInMonth) * 100;

  const [budgetRes, spent] = await Promise.all([
    supabase
      .from("client_budgets")
      .select("budget_minor_units")
      .eq("client_id", clientId)
      .eq("month", monthStart)
      .eq("platform", "total")
      .maybeSingle(),
    // Month-to-date spend from the per-day totals (one row per day and
    // platform, read through RLS) - summing every campaign row passed
    // PostgREST's 1000-row cap late in the month and needed many pages.
    getAdsSpendTotal(supabase, clientId, monthStart, todayStr),
  ]);

  const budget = Number(budgetRes.data?.budget_minor_units ?? 0);

  if (!budget) {
    return {
      hasBudget: false,
      budgetMinorUnits: 0,
      spentMinorUnits: spent,
      spentPercent: 0,
      dayOfMonth,
      daysInMonth,
      monthPercent,
      pace: "none",
      paceLabel: "",
      month: monthStart,
    };
  }

  const spentPercent = (spent / budget) * 100;
  const deviation = spentPercent - monthPercent;

  let pace: BudgetPace = "ok";
  let paceLabel = "Tempo zgodne z planem.";
  if (deviation > 25) {
    pace = "fast";
    paceLabel = "Zbyt szybkie - wydajemy znacznie powyżej planu.";
  } else if (deviation > 10) {
    pace = "fast";
    paceLabel = "Lekko za szybkie - wydajemy powyżej planu.";
  } else if (deviation < -25) {
    pace = "slow";
    paceLabel = "Zbyt wolne - wydajemy znacznie poniżej planu.";
  } else if (deviation < -10) {
    pace = "slow";
    paceLabel = "Lekko za wolne - wydajemy poniżej planu.";
  }

  return {
    hasBudget: true,
    budgetMinorUnits: budget,
    spentMinorUnits: spent,
    spentPercent,
    dayOfMonth,
    daysInMonth,
    monthPercent,
    pace,
    paceLabel,
    month: monthStart,
  };
}

/** Active (not dismissed, not expired) alerts, most severe first. */
export async function getActiveAlerts(clientId: string): Promise<ClientAlert[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("client_alerts")
    .select("id, severity, category, title, description, generated_at, auto_expires_at")
    .eq("client_id", clientId)
    .is("dismissed_at", null)
    .order("generated_at", { ascending: false })
    .limit(20);

  const severityRank = { critical: 0, warning: 1, info: 2 } as const;
  const now = Date.now();

  return (data ?? [])
    .filter(
      (a) => !a.auto_expires_at || new Date(a.auto_expires_at).getTime() > now
    )
    .sort(
      (a, b) =>
        severityRank[a.severity as keyof typeof severityRank] -
        severityRank[b.severity as keyof typeof severityRank]
    )
    .slice(0, 5)
    .map((a) => ({
      id: a.id as string,
      severity: a.severity as ClientAlert["severity"],
      category: a.category as string,
      title: a.title as string,
      description: a.description as string,
      generatedAt: a.generated_at as string,
    }));
}

/** Latest AI summary for the client, if any. */
export async function getLatestSummary(clientId: string): Promise<AiSummary | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("ai_summaries")
    .select("summary_text, generated_at, period_start, period_end")
    .eq("client_id", clientId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return {
    summaryText: data.summary_text as string,
    generatedAt: data.generated_at as string,
    periodStart: data.period_start as string,
    periodEnd: data.period_end as string,
  };
}

/** Events in a date range (annotations under the main chart). */
export async function getEvents(
  clientId: string,
  start: string,
  end: string
): Promise<ClientEvent[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("client_events")
    .select("id, event_date, title, description, event_type")
    .eq("client_id", clientId)
    .gte("event_date", start)
    .lte("event_date", end)
    .order("event_date", { ascending: false });

  return (data ?? []).map((e) => ({
    id: e.id as string,
    eventDate: e.event_date as string,
    title: e.title as string,
    description: e.description as string | null,
    eventType: e.event_type as string | null,
  }));
}

// ---- "Co dla Ciebie zrobiliśmy" (agency work log on client_events) ----

export const AGENCY_WORK_CATEGORIES = [
  "kampania",
  "kreacja",
  "optymalizacja",
  "raport",
  "strona",
  "inne",
] as const;

export type AgencyWorkCategory = (typeof AGENCY_WORK_CATEGORIES)[number];

export interface AgencyWorkEntry {
  id: string;
  date: string; // yyyy-MM-dd (Warsaw day)
  title: string;
  description: string | null;
  category: AgencyWorkCategory;
  visibleToClient: boolean;
}

export interface AgencyWork {
  /** Warsaw "today" the window was computed for. */
  today: string;
  /** First day of the window (inclusive). */
  since: string;
  entries: AgencyWorkEntry[];
}

/** Category the form writes -> event_type, so the chart marker keeps a tag. */
export function eventTypeForCategory(category: AgencyWorkCategory): string {
  if (category === "kampania") return "campaign_launch";
  if (category === "optymalizacja") return "strategy_change";
  return "other";
}

function categoryFor(category: unknown, eventType: unknown): AgencyWorkCategory | null {
  if (
    typeof category === "string" &&
    (AGENCY_WORK_CATEGORIES as readonly string[]).includes(category)
  ) {
    return category as AgencyWorkCategory;
  }
  // Rows from before 0029 only have event_type. A "sale_period" is the
  // client's own promotion, not something we did - keep it off the work log.
  switch (eventType) {
    case "campaign_launch":
      return "kampania";
    case "budget_change":
    case "strategy_change":
      return "optymalizacja";
    case "sale_period":
      return null;
    default:
      return "inne";
  }
}

/**
 * Manual work-log entries in [start, end], newest first. Works before
 * migration 0029 too (no category / visible_to_client columns): the first
 * select fails and the legacy one runs, every row counting as visible.
 * `supabase` lets the weekly e-mail cron pass its service-role client.
 */
export async function getAgencyWorkEntries(
  clientId: string,
  start: string,
  end: string,
  supabase: SupabaseClient = createClient()
): Promise<AgencyWorkEntry[]> {
  const query = (columns: string) =>
    supabase
      .from("client_events")
      .select(columns)
      .eq("client_id", clientId)
      .gte("event_date", start)
      .lte("event_date", end)
      .order("event_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200);

  let res = await query(
    "id, event_date, title, description, event_type, category, visible_to_client"
  );
  if (res.error) {
    res = await query("id, event_date, title, description, event_type");
  }

  const out: AgencyWorkEntry[] = [];
  for (const raw of (res.data ?? []) as unknown as Record<string, unknown>[]) {
    const category = categoryFor(raw.category, raw.event_type);
    if (!category) continue;
    out.push({
      id: raw.id as string,
      date: raw.event_date as string,
      title: raw.title as string,
      description: (raw.description as string | null) ?? null,
      category,
      visibleToClient: raw.visible_to_client !== false,
    });
  }
  return out;
}

/** The last 30 Warsaw days (today included) of the work log. */
export async function getRecentAgencyWork(clientId: string): Promise<AgencyWork> {
  const today = formatInTimeZone(new Date(), WARSAW_TZ, "yyyy-MM-dd");
  const since = format(addDays(new Date(`${today}T12:00:00`), -29), "yyyy-MM-dd");
  const entries = await getAgencyWorkEntries(clientId, since, today);
  return { today, since, entries };
}
