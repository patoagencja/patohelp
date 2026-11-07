import { CalendarRange, Target } from "lucide-react";

import { ACTION, actionCopy, fmtEstimate, formatOf, type KindMeta } from "@/components/dashboard/ab/ab-meta";
import { explainAlert, SEVERITY_LABEL } from "@/components/dashboard/alert-explained";
import { METRIC_LABEL } from "@/components/dashboard/goal-tiles";
import { paceWords } from "@/components/dashboard/season/budget-page";
import type { AbAd, AbView } from "@/lib/ab/types";
import type { Anomaly } from "@/lib/alerts/anomalies";
import { GOAL_STATUS_WORDS, type GoalTile } from "@/lib/dashboard/campaign-goals";
import { guessFormat, type CreativeFormat } from "@/lib/dashboard/creatives";
import { distinctAdsetName } from "@/lib/dashboard/goal-names";
import type { SeasonBudget } from "@/lib/season/budget";
import { compactPln } from "@/lib/season/format";
import {
  groupNumber,
  pickActions,
  pickAttention,
  plural,
  zl,
  type ActionSource,
  type BriefKind,
  type BriefSource,
} from "@/lib/today/brief";
import type { YesterdayBest } from "@/lib/today/load";
import { formatPlnWhole } from "@/lib/utils";

// Turns what the other tabs already compute (alerts, creative tests, goal
// tiles, the season budget, yesterday's best) into the short rows of the
// "Dziś" view. Shared by the live page and the demo, so both say the same
// things in the same words. Every row links to the page that has the rest.

export interface TodayThumb {
  src: string | null;
  name: string;
  format: CreativeFormat;
}

export interface TodayAlertItem {
  id: string;
  severity: "critical" | "high";
  /** "Pilne" / "Ważne" - the Alerty page's words. */
  label: string;
  /** The plain-language headline the Alerty card leads with. */
  title: string;
  where: string;
}

/** "Na co uważać": the alerts that need a look, at most three. */
export function alertItems(alerts: readonly Anomaly[]): { items: TodayAlertItem[]; rest: number } {
  const { shown, rest } = pickAttention(alerts);
  return {
    items: shown.map((a) => ({
      id: a.id,
      severity: a.severity === "critical" ? "critical" : "high",
      label: SEVERITY_LABEL.pl[a.severity],
      title: explainAlert(a).headline,
      where: a.scopeLabel,
    })),
    rest,
  };
}

export interface TodayActionItem {
  key: string;
  source: ActionSource;
  tag: KindMeta;
  title: string;
  detail: string | null;
  /** The amount to scan for, top right ("~+1 240 zł", "62%"). */
  figure: { value: string; caption: string } | null;
  href: string;
  thumb: TodayThumb | null;
}

const GOAL_TAG: KindMeta = {
  label: `Cel ${GOAL_STATUS_WORDS.at_risk}`,
  icon: Target,
  text: "text-negative",
  disc: "bg-negative-soft text-negative",
};

/** A daily pace in the goal's unit: "412", "140 zł" (the metric is named before it). */
function perDay(g: GoalTile, v: number, up = false): string {
  if (g.metric === "spend") return formatPlnWhole((up ? Math.ceil(v / 100) : Math.round(v / 100)) * 100);
  return groupNumber(up ? Math.ceil(v) : v);
}

/** "2026-11-14" -> "14.11" (as on the goal tiles). */
const shortDate = (iso: string) => `${Number(iso.slice(8, 10))}.${iso.slice(5, 7)}`;

/** Running goals the pace says won't make it (soonest deadline first, as the tiles sort them). */
export function goalActions(goals: readonly GoalTile[], base: string): TodayActionItem[] {
  return goals
    .filter((g) => g.status === "at_risk")
    .map((g) => {
      const name = g.adsetName ? distinctAdsetName(g.adsetName, g.campaignName) : g.campaignName;
      // "Wyświetlenia do 14.11: potrzeba ok. 29 418 dziennie (dotąd 10 589), zostało 7 dni."
      const pace =
        g.neededPerDay !== null
          ? `: potrzeba ok. ${perDay(g, g.neededPerDay, true)} dziennie (dotąd ${perDay(g, g.avgPerDay)})`
          : "";
      return {
        key: `goal-${g.id}`,
        source: "goal" as const,
        tag: GOAL_TAG,
        title: name,
        detail: `${METRIC_LABEL[g.metric]} do ${shortDate(g.endDate)}${pace}, zostało ${g.daysRemaining} ${plural(
          g.daysRemaining,
          "dzień",
          "dni",
          "dni"
        )}.`,
        figure: {
          value: `${Math.round(g.realizedPct * 100)}%`,
          caption: `celu · plan na dziś ${Math.round(g.expectedPct * 100)}%`,
        },
        href: `${base}/alerty#cel-${g.id}`,
        thumb: null,
      };
    });
}

/**
 * The creative test proposals the Testy kreacji page leads with (its
 * default 7-day period, decisions only - "Obserwujemy" is not a to-do), in
 * the page's order: most sales at stake first.
 */
export function testActions(view: AbView, base: string): TodayActionItem[] {
  if (!view.available || view.monitor) return [];
  const ads = new Map<string, AbAd>();
  for (const t of view.tests) for (const ad of t.ads) ads.set(ad.adId, ad);
  return view.actions
    .filter((a) => a.kind !== "watch")
    .map((a) => {
      const ad = ads.get(a.adId);
      const meta = ACTION[a.kind];
      const { title, detail } = actionCopy(a, ad);
      return {
        key: `test-${a.kind}-${a.adId}`,
        source: "test" as const,
        tag: meta,
        title,
        detail,
        figure: { value: `~${meta.plus ? "+" : ""}${fmtEstimate(a.impactPerDay)}`, caption: meta.impact },
        href: `${base}/kreacje/testy#ad-${encodeURIComponent(a.adId)}`,
        thumb: ad ? { src: ad.thumbnailUrl, name: ad.adName, format: formatOf(ad) } : null,
      };
    });
}

const BUDGET_TONE: Record<"good" | "bad" | "flat", Pick<KindMeta, "text" | "disc">> = {
  good: { text: "text-positive", disc: "bg-lime text-lime-foreground" },
  flat: { text: "text-warning", disc: "bg-warning-soft text-warning" },
  bad: { text: "text-negative", disc: "bg-negative-soft text-negative" },
};

/** The season budget's "Dziś według planu" (Sezon → Budżet), while the season runs. */
export function budgetAction(budget: SeasonBudget | null, base: string): TodayActionItem[] {
  if (!budget || budget.todayPlan <= 0) return [];
  const pace = paceWords(budget.pace);
  const so =
    budget.pace === null
      ? `Budżet sezonu: ${compactPln(budget.total)}.`
      : `Do wczoraj ${compactPln(budget.spentToDate)} z ${compactPln(budget.total)} - ${pace?.text ?? "zgodnie z planem"}.`;
  return [
    {
      key: "budget",
      source: "budget",
      tag: { label: "Budżet sezonu", icon: CalendarRange, ...BUDGET_TONE[pace?.tone ?? "good"] },
      title: "Wydatki na reklamy dziś według planu sezonu",
      detail: `${so}${budget.todaySpend > 0 ? ` Dziś wydano już ${formatPlnWhole(budget.todaySpend)}.` : ""}`,
      figure: { value: formatPlnWhole(budget.todayPlan), caption: "na dziś" },
      href: `${base}/sezon/budzet`,
      thumb: null,
    },
  ];
}

/** "Co dziś robimy": at most three, one of each kind first (lib/today/brief pickActions). */
export function todayActions(lists: Partial<Record<ActionSource, TodayActionItem[]>>): TodayActionItem[] {
  return pickActions(lists).map((p) => p.item);
}

export interface TodayBestItem {
  key: string;
  kind: "product" | "ad" | "campaign";
  kicker: string;
  name: string;
  /** The figure set in the foreground ink, then its caption. */
  figure: string;
  caption: string;
  href: string;
  thumb: TodayThumb | null;
}

/**
 * "Najlepiej wczoraj": the top product and the ad with the most sales for
 * shops; for everyone else the ad (or campaign) with the most clicks -
 * never a sales figure.
 */
export function bestItems(best: YesterdayBest | null, base: string, isShop: boolean): TodayBestItem[] {
  if (!best) return [];
  const out: TodayBestItem[] = [];
  if (isShop && best.product) {
    const p = best.product;
    out.push({
      key: "product",
      kind: "product",
      kicker: "Produkt",
      name: p.name,
      figure: zl(p.revenue),
      caption:
        p.count > 0
          ? p.unit === "orders"
            ? `sprzedaży w ${groupNumber(p.count)} ${plural(p.count, "zamówieniu", "zamówieniach", "zamówieniach")}`
            : `sprzedaży · ${groupNumber(p.count)} szt.`
          : "sprzedaży",
      href: `${base}/sprzedaz`,
      thumb: null,
    });
  }
  if (best.ad) {
    const a = best.ad;
    const thumb = { src: a.thumbnailUrl, name: a.name, format: a.video ? ("video" as const) : guessFormat(a.name) };
    out.push(
      isShop
        ? {
            key: "ad",
            kind: "ad",
            kicker: "Reklama",
            name: a.name,
            figure: zl(a.value),
            caption: `sprzedaży z ${groupNumber(a.purchases)} ${a.purchases === 1 ? "zakupu" : "zakupów"} (według Meta)`,
            href: `${base}/kreacje/testy#ad-${encodeURIComponent(a.adId)}`,
            thumb,
          }
        : {
            key: "ad",
            kind: "ad",
            kicker: "Reklama",
            name: a.name,
            figure: groupNumber(a.clicks),
            caption: plural(a.clicks, "kliknięcie w link", "kliknięcia w link", "kliknięć w link"),
            href: `${base}/kreacje`,
            thumb,
          }
    );
  } else if (!isShop && best.campaign) {
    const c = best.campaign;
    out.push({
      key: "campaign",
      kind: "campaign",
      kicker: c.provider === "google_ads" ? "Kampania · Google" : c.provider === "meta_ads" ? "Kampania · Meta" : "Kampania",
      name: c.name,
      figure: groupNumber(c.clicks),
      caption: plural(c.clicks, "kliknięcie", "kliknięcia", "kliknięć"),
      href: `${base}/reklamy`,
      thumb: null,
    });
  }
  return out;
}

/** One plain line under the brief: where its numbers come from. */
export function briefNote(kind: BriefKind | null, source: BriefSource | null, withVisits: boolean): string | null {
  if (!kind || !source) return null;
  if (kind === "sales") {
    return source === "shop" ? "Sprzedaż według danych z Twojego sklepu." : "Sprzedaż według Google Analytics.";
  }
  if (kind === "clicks") {
    return withVisits
      ? "Kliknięcia w reklamy ze wszystkich kampanii, wizyty według Google Analytics."
      : "Kliknięcia w reklamy ze wszystkich kampanii.";
  }
  return "Wizyty na stronie według Google Analytics.";
}

/** Where the brief's "more" link goes. */
export function briefLink(kind: BriefKind | null, base: string): { href: string; label: string } {
  if (kind === "sales") return { href: `${base}/sprzedaz`, label: "Sprzedaż" };
  if (kind === "visits") return { href: `${base}/witryna`, label: "Strona www" };
  return { href: base, label: "Przegląd" };
}
