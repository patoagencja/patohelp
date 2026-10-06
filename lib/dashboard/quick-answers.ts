import type { Anomaly } from "@/lib/alerts/anomalies";
import type { PlanRow } from "@/components/dashboard/plan-card";
import { plPlural, type Story } from "@/lib/dashboard/story";

/**
 * The AI card's quick-question chips, answered WITHOUT any model call: each
 * answer is a templated Polish sentence built from numbers already on the
 * overview (plan pacing, the story's facts, open alerts). The owner pays
 * per token; these questions have deterministic answers anyway. A chip is
 * left out when its data is missing, so it never answers "nie wiem".
 */
export interface QuickAnswer {
  id: "plan" | "board" | "alerts";
  question: string;
  answer: string;
}

const SHORT_NAME: Record<string, string> = {
  spend: "wydatki",
  impressions: "wyświetlenia",
  clicks: "kliknięcia",
  sessions: "wizyty na stronie",
  cpc: "koszt kliknięcia",
  revenue: "sprzedaż",
  orders: "zamówienia",
  roas: "zwrot z reklam",
};

const STATUS_WORDS: Record<PlanRow["tone"], string> = {
  good: "w planie",
  neutral: "za wcześnie, by ocenić",
  warn: "poniżej tempa",
  bad: "szybciej niż plan",
};

/** "Czy dowieziemy cel?" - plan rows with a "where we should be" marker. */
function planAnswer(rows: PlanRow[]): QuickAnswer | null {
  const judged = rows.filter((r) => r.marker !== null || r.pct >= 100);
  if (judged.length === 0) return null;
  const lines = judged.map((r) => {
    const name = r.label.replace(/\s*-\s*cel$/, "");
    const where =
      r.marker !== null ? ` przy ${Math.round(r.marker)}% miesiąca` : "";
    return `${name}: ${Math.round(r.pct)}%${where} (${r.value}) - ${r.short ?? STATUS_WORDS[r.tone]}`;
  });
  // "Most behind" = the widest gap between where we are and the plan tick,
  // not whichever row happens to come first.
  const gap = (r: PlanRow) => (r.marker ?? r.pct) - r.pct;
  const behind = judged.filter((r) => r.tone === "warn").sort((a, b) => gap(b) - gap(a));
  const fast = judged.filter((r) => r.tone === "bad");
  // Neutral rows ("za mało danych") can't back a "we'll make it" promise.
  const onPlan = judged.filter((r) => r.tone === "good");
  const verdict =
    behind.length === 0 && fast.length === 0
      ? onPlan.length > 0
        ? "W tym tempie dowieziemy plan."
        : "Za wcześnie, by ocenić tempo - wrócimy z tym za kilka dni."
      : behind.length > 0
        ? `Najbardziej odstaje: ${behind[0].label.replace(/\s*-\s*cel$/, "").toLowerCase()} - tu jest najwięcej do nadrobienia.`
        : "Budżet schodzi szybciej niż plan - pilnujemy dziennych limitów.";
  return {
    id: "plan",
    question: "Czy dowieziemy cel?",
    answer: `${lines.join(". ")}. ${verdict}`,
  };
}

/** "Co pokazać zarządowi?" - the story's top three judged numbers. */
function boardAnswer(story: Story): QuickAnswer | null {
  // Changes that are news (good/bad) first, then the rest; spend is a
  // decision, not a result, so it only fills in.
  const facts = [...story.facts]
    .filter((f) => f.change)
    .sort((a, b) => {
      const rank = (t: string, k: string) => (k === "spend" ? 2 : t === "flat" ? 1 : 0);
      return rank(a.change!.tone, a.key) - rank(b.change!.tone, b.key);
    })
    .slice(0, 3);
  if (facts.length < 2) return null;
  const parts = facts.map((f) => `${SHORT_NAME[f.key] ?? f.key} ${f.value} (${f.change!.text})`);
  const verdict = story.verdict ? ` ${story.verdict.text}.` : "";
  return {
    id: "board",
    question: "Co pokazać zarządowi?",
    answer: `${facts.length === 3 ? "Trzy" : "Dwie"} liczby: ${parts.join(", ")}.${verdict} Przycisk „Prezentuj” pokaże to na pełnym ekranie.`,
  };
}

/** "Co jest do sprawdzenia?" - open alerts worth a look (not the FYI ones). */
function alertsAnswer(alerts: Anomaly[] | null): QuickAnswer | null {
  if (!alerts) return null;
  const worth = alerts.filter((a) => a.severity !== "medium");
  const question = "Co jest do sprawdzenia?";
  if (worth.length === 0)
    return {
      id: "alerts",
      question,
      answer: "Nic pilnego - żadna kampania nie odbiega teraz mocno od normy. Pełna lista zmian jest w zakładce Alerty.",
    };
  const sorted = [...worth].sort((a, b) => (a.severity === "critical" ? -1 : 0) - (b.severity === "critical" ? -1 : 0));
  const top = sorted.slice(0, 2).map((a) => `${a.title} (${a.scopeLabel})`);
  const n = worth.length;
  const more = n > 2 ? ` i jeszcze ${n - 2}` : "";
  return {
    id: "alerts",
    question,
    answer: `${n} ${plPlural(n, "rzecz", "rzeczy", "rzeczy")}: ${top.join("; ")}${more}. Szczegóły są w zakładce Alerty - agencja widzi je u siebie.`,
  };
}

export function buildQuickAnswers({
  story,
  planRows,
  alerts,
}: {
  story: Story;
  planRows: PlanRow[];
  /** null while alerts are still loading (the chip waits). */
  alerts: Anomaly[] | null;
}): QuickAnswer[] {
  return [planAnswer(planRows), boardAnswer(story), alertsAnswer(alerts)].filter(
    (a): a is QuickAnswer => a !== null
  );
}
