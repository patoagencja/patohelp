import { format, getDaysInMonth, startOfMonth } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

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

  const [budgetRes, spendRes] = await Promise.all([
    supabase
      .from("client_budgets")
      .select("budget_minor_units")
      .eq("client_id", clientId)
      .eq("month", monthStart)
      .eq("platform", "total")
      .maybeSingle(),
    supabase
      .from("ads_daily")
      .select("spend_minor_units")
      .eq("client_id", clientId)
      .gte("date", monthStart)
      .lte("date", todayStr),
  ]);

  const budget = Number(budgetRes.data?.budget_minor_units ?? 0);
  const spent = (spendRes.data ?? []).reduce(
    (sum, r) => sum + Number(r.spend_minor_units),
    0
  );

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

/** Human "updated X minutes ago" from the freshest successful sync. */
export async function getLastSyncLabel(clientId: string): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("sync_runs")
    .select("finished_at")
    .eq("client_id", clientId)
    .eq("status", "success")
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.finished_at) return null;

  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(data.finished_at).getTime()) / 60000)
  );
  if (minutes < 1) return "Zaktualizowano przed chwilą";
  if (minutes < 60) return `Zaktualizowano ${minutes} min temu`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Zaktualizowano ${hours} godz. temu`;
  return `Zaktualizowano ${formatInTimeZone(
    new Date(data.finished_at),
    WARSAW_TZ,
    "d.MM.yyyy HH:mm"
  )}`;
}
