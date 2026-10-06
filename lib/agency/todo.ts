import { RECONNECT_PATH } from "@/components/dashboard/integration-health-banner";
import type { GoalMetric } from "@/lib/dashboard/goals";
import { getEngagementGoals } from "@/lib/dashboard/goals";
import type { ExpiringToken, ProviderHealth } from "@/lib/dashboard/integration-health";
import { getAgencyWorkEntries, getBudgetStatus } from "@/lib/dashboard/overview";
import { plPlural } from "@/lib/dashboard/story";
import { addDays, getEcomSettings, getMonthPacing, todayWarsaw } from "@/lib/ecom/insights";
import { createAdminClient } from "@/lib/supabase/admin";

// "Dziś do zrobienia" for the agency client picker: every client's open loose
// ends in one list, so nobody has to open ten dashboards to find the one with
// a dead GA4 token or a budget running hot. Reads only what we already sync
// (Supabase), never the ad APIs.

export type TodoSeverity = "pilne" | "wazne" | "wskazowka";

export const TODO_SEVERITIES: readonly TodoSeverity[] = ["pilne", "wazne", "wskazowka"];

export interface AgencyTodoItem {
  clientSlug: string;
  clientName: string;
  severity: TodoSeverity;
  text: string;
  actionHref: string;
  actionLabel: string;
}

export interface AgencyTodoClient {
  id: string;
  slug: string;
  name: string;
  /** Already fetched by the page for the tiles - reused, not refetched. */
  health?: { down: ProviderHealth[]; expiring: ExpiringToken[] };
  /** Critical anomaly + spend spike count, also already on the page. */
  criticalAlerts?: number;
}

export interface AgencyTodo {
  items: AgencyTodoItem[];
  /** Checks that threw or timed out - shown so a quiet list isn't mistaken
   *  for "all good" when half the checks silently failed. */
  failedChecks: number;
}

/** Clients checked at once: each runs ~5 queries, so 4 keeps the pool calm. */
const CONCURRENCY = 4;
/** One slow check must not hold the whole list hostage. */
const CHECK_TIMEOUT_MS = 8_000;
/** Pacing deviation (relative to the pro-rata spend) worth a human look. */
const PACING_THRESHOLD = 0.15;
/** Above this the overspend is no longer "watch it" but "act today". */
const PACING_URGENT = 0.3;
/** First days of a month are too noisy for a pacing verdict. */
const PACING_MIN_DAY = 4;
const ACTIVITY_WINDOW_DAYS = 14;

const GOAL_LABEL: Record<GoalMetric, string> = {
  sessions: "wizyty na stronie",
  clicks: "kliknięcia w reklamy",
  impressions: "wyświetlenia reklam",
  conversions: "działania na stronie",
};

const SEVERITY_RANK: Record<TodoSeverity, number> = { pilne: 0, wazne: 1, wskazowka: 2 };

const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;

/** Run `fn` over `items` with at most `limit` in flight, keeping order. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Defensive per-client data: one batched query each instead of N. */
async function getClientMeta(ids: string[]) {
  const admin = createAdminClient();
  const types = new Map<string, "engagement" | "ecommerce">();
  // null = notification_settings (migration 0022) unavailable: skip the tip
  // rather than nag every client about a toggle that does not exist yet.
  let digest: Map<string, boolean> | null = null;
  const [typeRes, digestRes] = await Promise.all([
    admin.from("clients").select("id, client_type").in("id", ids),
    admin
      .from("notification_settings")
      .select("client_id, weekly_digest_enabled")
      .in("client_id", ids),
  ]);
  if (!typeRes.error) {
    for (const r of (typeRes.data ?? []) as { id: string; client_type?: string | null }[]) {
      types.set(r.id, r.client_type === "ecommerce" ? "ecommerce" : "engagement");
    }
  }
  if (!digestRes.error) {
    digest = new Map();
    for (const r of (digestRes.data ?? []) as {
      client_id: string;
      weekly_digest_enabled?: boolean | null;
    }[]) {
      digest.set(r.client_id, r.weekly_digest_enabled === true);
    }
  }
  return { types, digest };
}

async function checkClient(
  c: AgencyTodoClient,
  clientType: "engagement" | "ecommerce",
  digestEnabled: boolean | undefined,
  onFail: () => void
): Promise<AgencyTodoItem[]> {
  const items: AgencyTodoItem[] = [];
  const base = { clientSlug: c.slug, clientName: c.name };
  const add = (
    severity: TodoSeverity,
    text: string,
    actionHref: string,
    actionLabel: string
  ) => items.push({ ...base, severity, text, actionHref, actionLabel });

  const safe = async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), CHECK_TIMEOUT_MS);
        }),
      ]);
    } catch {
      onFail();
      return undefined;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  // ---- reused from the page: integration health + critical alerts ----
  for (const h of c.health?.down ?? []) {
    const reconnect = RECONNECT_PATH[h.provider];
    const days =
      h.hoursSinceSuccess === null ? null : Math.floor(h.hoursSinceSuccess / 24);
    const why = h.tokenExpired
      ? "token wygasł, dane nie spływają"
      : days === null
        ? "jeszcze nigdy się nie zsynchronizowało"
        : days >= 1
          ? `brak danych od ${days} ${days === 1 ? "dnia" : "dni"}`
          : "ostatnia synchronizacja się nie udała";
    if (h.tokenExpired && reconnect) {
      add("pilne", `${h.label}: ${why}`, `${reconnect}?client=${c.slug}`, "Połącz ponownie");
    } else {
      add("pilne", `${h.label}: ${why}`, `/${c.slug}/settings#polaczenia`, "Sprawdź");
    }
  }
  for (const e of c.health?.expiring ?? []) {
    add(
      e.daysLeft <= 3 ? "pilne" : "wazne",
      `${e.label}: token wygasa za ${e.daysLeft} ${e.daysLeft === 1 ? "dzień" : "dni"}`,
      `/${c.slug}/settings#polaczenia`,
      "Odnów token"
    );
  }
  const critical = c.criticalAlerts ?? 0;
  if (critical > 0) {
    add(
      "pilne",
      `${critical} ${plPlural(
        critical,
        "krytyczny alert",
        "krytyczne alerty",
        "krytycznych alertów"
      )} w kampaniach`,
      `/${c.slug}/alerty`,
      "Zobacz alerty"
    );
  }

  // ---- new checks, in parallel within the client ----
  const today = todayWarsaw();
  const isShop = clientType === "ecommerce";
  const [budget, goals, pacing, work, ecom] = await Promise.all([
    safe(() => getBudgetStatus(c.id)),
    isShop ? Promise.resolve(undefined) : safe(() => getEngagementGoals(c.id, today)),
    isShop ? safe(() => getMonthPacing(c.id, today)) : Promise.resolve(undefined),
    safe(() =>
      getAgencyWorkEntries(
        c.id,
        addDays(today, -(ACTIVITY_WINDOW_DAYS - 1)),
        today,
        createAdminClient()
      )
    ),
    isShop ? safe(() => getEcomSettings(c.id)) : Promise.resolve(undefined),
  ]);

  if (budget?.hasBudget && budget.dayOfMonth >= PACING_MIN_DAY) {
    const expected = (budget.budgetMinorUnits * budget.monthPercent) / 100;
    const dev = expected > 0 ? budget.spentMinorUnits / expected - 1 : 0;
    if (Math.abs(dev) > PACING_THRESHOLD) {
      const over = dev > 0;
      add(
        over && dev > PACING_URGENT ? "pilne" : "wazne",
        `Budżet ${over ? "za szybko" : "za wolno"}: wydano ${pct(
          budget.spentPercent / 100
        )} przy ${pct(budget.monthPercent / 100)} miesiąca (${over ? "+" : "−"}${pct(
          Math.abs(dev)
        )} vs plan)`,
        `/${c.slug}#budzet`,
        "Sprawdź budżet"
      );
    }
  }

  const behind = (goals ?? []).filter((g) => g.status === "behind");
  if (behind.length > 0) {
    const worst = behind.reduce((a, b) =>
      (a.forecastPct ?? 1) <= (b.forecastPct ?? 1) ? a : b
    );
    const others = behind.length - 1;
    add(
      "wazne",
      `Cel „${GOAL_LABEL[worst.metric]}” zagrożony: prognoza ${pct(
        worst.forecastPct ?? 0
      )} celu${others > 0 ? ` (+${others} ${others === 1 ? "inny" : "inne"})` : ""}`,
      `/${c.slug}/settings#cele`,
      "Zobacz cele"
    );
  }
  if (pacing?.status === "behind" && pacing.forecastPct !== null) {
    add(
      "wazne",
      `Cel sprzedaży zagrożony: prognoza ${pct(pacing.forecastPct)} celu na ${pacing.monthLabel}`,
      `/${c.slug}/settings#ecommerce`,
      "Zobacz cel"
    );
  }

  // Only entries the client can see count: a hidden note doesn't change the
  // client's impression that nothing is happening.
  if (work && !work.some((w) => w.visibleToClient)) {
    add(
      "wazne",
      `Brak wpisu w „Co dla Ciebie zrobiliśmy” od ${ACTIVITY_WINDOW_DAYS} dni`,
      `/${c.slug}#dzialania`,
      "Dodaj wpis"
    );
  }

  if (ecom && (!ecom.available || ecom.marginPct === null)) {
    add(
      "wskazowka",
      "Brak marży w ustawieniach e-commerce - zysk po reklamie się nie liczy",
      `/${c.slug}/settings#ecommerce`,
      "Uzupełnij marżę"
    );
  }

  if (digestEnabled === false) {
    add(
      "wskazowka",
      "Cotygodniowe podsumowanie e-mail jest wyłączone",
      `/${c.slug}/settings#powiadomienia`,
      "Włącz"
    );
  }

  return items;
}

/**
 * Today's to-do across all clients, most urgent first. Never throws: each
 * check is isolated, so one broken client or a missing migration only drops
 * its own items and bumps `failedChecks`.
 */
export async function getAgencyTodo(clients: AgencyTodoClient[]): Promise<AgencyTodo> {
  if (clients.length === 0) return { items: [], failedChecks: 0 };

  let failedChecks = 0;
  const onFail = () => {
    failedChecks += 1;
  };

  let meta: Awaited<ReturnType<typeof getClientMeta>> = {
    types: new Map(),
    digest: null,
  };
  try {
    meta = await getClientMeta(clients.map((c) => c.id));
  } catch {
    onFail();
  }

  const perClient = await mapWithConcurrency(clients, CONCURRENCY, async (c) => {
    try {
      return await checkClient(
        c,
        meta.types.get(c.id) ?? "engagement",
        // Missing row = never configured = digest off (the column defaults false).
        meta.digest ? (meta.digest.get(c.id) ?? false) : undefined,
        onFail
      );
    } catch {
      onFail();
      return [];
    }
  });

  const items = perClient
    .flat()
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        a.clientName.localeCompare(b.clientName, "pl")
    );
  return { items, failedChecks };
}

/** Per-client counts for the tile chips. */
export function countTodoByClient(
  items: AgencyTodoItem[]
): Map<string, Record<TodoSeverity, number>> {
  const out = new Map<string, Record<TodoSeverity, number>>();
  for (const it of items) {
    const c = out.get(it.clientSlug) ?? { pilne: 0, wazne: 0, wskazowka: 0 };
    c[it.severity] += 1;
    out.set(it.clientSlug, c);
  }
  return out;
}
