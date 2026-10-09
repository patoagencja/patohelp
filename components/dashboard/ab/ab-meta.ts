import {
  BatteryLow,
  Eye,
  Hourglass,
  Power,
  RefreshCw,
  Scale,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { FATIGUE_RECENT_DAYS } from "@/lib/ab/stats";
import type { AbAction, AbActionKind, AbAd, AbVerdictKind, AbWindowKey } from "@/lib/ab/types";
import { guessFormat, type CreativeFormat } from "@/lib/dashboard/creatives";
import { plPlural } from "@/lib/dashboard/story";
import { formatDateWarsaw, formatMoneyPLN, formatNumberPL, formatPlnWhole } from "@/lib/utils";

// Shared by the server sections and the client explorer of "Testy kreacji":
// labels, tag tones and number formats, so a verdict reads the same in the
// action list, the test cards and the compare panel. Server-safe.
//
// Written for the shop owner, not a marketer: the actions are the agency's
// proposals ("Proponujemy wyłączyć"), certainty is said in words ("prawie
// na pewno"), and an ad set is "test" - the page explains the Meta term once.

export const AB_WINDOWS = ["today", "3d", "7d", "14d", "30d", "season"] as const satisfies readonly AbWindowKey[];

export interface KindMeta {
  label: string;
  icon: LucideIcon;
  /** Label text colour, AA on the glass cards in both themes. */
  text: string;
  /** The small icon disc: tint + icon colour. */
  disc: string;
}

// Words + icon on every tag: the colour is never the only cue.
export const VERDICT: Record<AbVerdictKind, KindMeta> = {
  winner: { label: "Wygrywa", icon: TrendingUp, text: "text-positive", disc: "bg-lime text-lime-foreground" },
  loser: { label: "Przegrywa", icon: TrendingDown, text: "text-negative", disc: "bg-negative-soft text-negative" },
  fatigue: { label: "Męczy się", icon: BatteryLow, text: "text-warning", disc: "bg-warning-soft text-warning" },
  too_early: { label: "Za wcześnie", icon: Hourglass, text: "text-ink-2", disc: "bg-chip text-ink-2" },
  steady: { label: "Na równi", icon: Scale, text: "text-ink-2", disc: "bg-chip text-ink-2" },
  preview: { label: "Podgląd", icon: Eye, text: "text-ink-2", disc: "bg-chip text-ink-2" },
};

/**
 * The agency's proposal per action. `impact` is the line under the amount;
 * `plus` marks amounts that are extra sales ("~+1 240 zł"), as opposed to
 * sales to win back or spend.
 */
export const ACTION: Record<AbActionKind, KindMeta & { impact: string; plus: boolean }> = {
  scale: {
    label: "Proponujemy dołożyć budżet",
    icon: TrendingUp,
    text: "text-positive",
    disc: "bg-lime text-lime-foreground",
    impact: "więcej sprzedaży dziennie",
    plus: true,
  },
  cut: {
    label: "Proponujemy wyłączyć",
    icon: Power,
    text: "text-negative",
    disc: "bg-negative-soft text-negative",
    impact: "więcej sprzedaży dziennie",
    plus: true,
  },
  refresh: {
    label: "Proponujemy nową wersję",
    icon: RefreshCw,
    text: "text-warning",
    disc: "bg-warning-soft text-warning",
    impact: "sprzedaży dziennie do odzyskania",
    plus: false,
  },
  watch: {
    label: "Obserwujemy",
    icon: Eye,
    text: "text-ink-2",
    disc: "bg-chip text-ink-2",
    impact: "dziennie na tej reklamie",
    plus: false,
  },
};

/**
 * The tag already names the move, so the title drops its verb lead-in
 * ("Wyłącz „X”: ..." -> "„X”: ...") - only right before the quoted name, so
 * a title that is a sentence of its own stays whole.
 */
export function stripKindPrefix(title: string): string {
  return title.replace(/^(Wyłącz|Odśwież|Obserwuj|Daj więcej budżetu|Zwiększ budżet)\s*:?\s+(?=„)/, "");
}

/**
 * How sure a call is, in words: "prawie na pewno" reads to an owner where
 * "99% szans" reads like a betting slip. null below 90% (no word claims it).
 */
export function sureText(p: number | null | undefined): string | null {
  if (p == null) return null;
  if (p > 0.99) return "prawie na pewno";
  if (p >= 0.95) return "z dużą pewnością";
  if (p >= 0.9) return "najpewniej";
  return null;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Sales per 1 zł of ads: 4.83 -> "4,8 zł". */
const perZl = (r: number) =>
  `${r.toLocaleString("pl-PL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} zł`;

/** "2 razy", "2,5 raza" (a fraction takes the genitive). */
function times(r: number): string {
  const v = Math.round(r * 10) / 10;
  return Number.isInteger(v) ? `${v} razy` : `${v.toLocaleString("pl-PL")} raza`;
}

/**
 * One action in the owner's words, from the numbers the statistics already
 * used (AbAction.facts) - nothing is recomputed. Views cached before facts
 * existed fall back to the marketer sentence.
 */
export function actionCopy(a: AbAction, ad: AbAd | undefined): { title: string; detail: string } {
  const f = a.facts;
  if (!f || !ad) return { title: stripKindPrefix(a.title), detail: a.detail };
  const name = `„${ad.adName}”`;
  const roas = ad.rates.roas;
  const versus =
    roas != null && f.restRoas != null
      ? ` (z każdej złotówki na tę reklamę ${perZl(roas)} sprzedaży, na pozostałe ${perZl(f.restRoas)})`
      : "";
  const sure = cap(sureText(ad.verdict.probability) ?? "wyraźnie");

  switch (a.kind) {
    case "cut":
      return {
        title:
          f.cpaRatio != null && f.cpaRatio >= 1.05
            ? `${name}: zakup ${times(f.cpaRatio)} droższy niż z pozostałych reklam w tym teście`
            : `${name} sprzedaje słabiej niż pozostałe reklamy w tym teście`,
        detail: `${sure} to nie przypadek${versus}. Kosztuje ok. ${fmtMoney(f.dailySpend)} dziennie - po wyłączeniu Meta wyda te pieniądze na lepsze reklamy z tego testu, więc sprzedaż wzrośnie.`,
      };
    case "scale":
      return {
        title: `${name} sprzedaje lepiej niż pozostałe reklamy w tym teście`,
        detail: `${sure} to nie przypadek${versus}. Dołożenie jej ok. ${fmtMoney(f.extraSpend ?? 0)} dziennie, zabranych słabszym reklamom, to ok. +${fmtEstimate(a.impactPerDay)} sprzedaży dziennie - liczymy ostrożnie, bo dodatkowy budżet zwykle sprzedaje trochę gorzej.`,
      };
    case "refresh": {
      const drop =
        f.roasBefore != null && f.roasRecent != null
          ? `W ostatnich ${FATIGUE_RECENT_DAYS} dniach z każdej złotówki wraca ${perZl(f.roasRecent)} sprzedaży, tydzień wcześniej wracało ${perZl(f.roasBefore)}`
          : "Sprzedaje coraz słabiej, szybciej niż pozostałe reklamy w tym teście";
      return {
        title: `${name} się opatrzyła - sprzedaje coraz słabiej`,
        detail: `${drop}${f.frequencyRising ? ", a te same osoby widzą ją coraz częściej" : ""}. Bez nowej wersji to ok. ${fmtEstimate(a.impactPerDay)} sprzedaży mniej dziennie.`,
      };
    }
    case "watch": {
      const p = ad.totals.purchases;
      const needed = ad.verdict.purchasesNeeded;
      const share = f.spendShare != null ? `To ${Math.max(1, Math.round(f.spendShare * 100))}% wydatków, a ma` : "Ma";
      return {
        title: `${name}: wydaje ${fmtMoney(f.dailySpend)} dziennie, a wynik jest jeszcze niepewny`,
        detail: `${share} dopiero ${p} ${purchasesWord(p)} - za mało, żeby ją ocenić. ${
          needed ? `Ocenimy ją po ok. ${needed} ${needed === 1 ? "kolejnym zakupie" : "kolejnych zakupach"}.` : "Ocenimy ją, gdy zbierze więcej danych."
        }`,
      };
    }
  }
}

/** Videos report 3-second plays; anything else falls back to the name. */
export function formatOf(ad: AbAd): CreativeFormat {
  return ad.totals.video3s ? "video" : guessFormat(ad.adName);
}

export const fmtMoney = (minor: number) => formatPlnWhole(minor);

/**
 * Estimates ("~1 240 zł dziennie") rounded to 10 zł: "~3 197 zł" would
 * claim a precision the estimate doesn't have.
 */
export const fmtEstimate = (minor: number) => {
  const zl = minor / 100;
  return fmtMoney((zl >= 100 ? Math.round(zl / 10) * 10 : Math.round(zl)) * 100);
};

/** Cost per purchase keeps grosze: 8,40 zł vs 9,10 zł is the story. */
export const fmtCpa = (minor: number | null) => (minor == null ? "-" : formatMoneyPLN(Math.round(minor)));

export const fmtRoas = (r: number | null) =>
  r == null ? "-" : `${r.toLocaleString("pl-PL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×`;

/** 0.0185 -> "1,85%". */
export const fmtRate = (r: number | null, digits = 2) =>
  r == null ? "-" : `${(r * 100).toLocaleString("pl-PL", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;

/** Probability for cells: never "0%" or "100%" - nothing is certain. */
export function fmtProb(p: number | null): string {
  if (p == null) return "-";
  if (p < 0.01) return "<1%";
  if (p > 0.99) return ">99%";
  return `${Math.round(p * 100)}%`;
}

export const fmtCount = (n: number) => formatNumberPL(n);

export const adsWord = (n: number) => plPlural(n, "reklama", "reklamy", "reklam");
export const purchasesWord = (n: number) => plPlural(n, "zakup", "zakupy", "zakupów");
export const changesWord = (n: number) => plPlural(n, "zmianę", "zmiany", "zmian");
/** Locative after "w": "w 1 teście", "w 6 testach". */
export const inTests = (n: number) => `w ${n} ${n === 1 ? "teście" : "testach"}`;

/** "PL · Rodzice 25-45": market + the audience part of an ad set name. */
export function setShort(adsetName: string, market: string | null): string {
  const parts = adsetName.split("|").map((s) => s.trim()).filter(Boolean);
  const tail = parts.length > 1 ? parts[parts.length - 1] : adsetName;
  return market && parts[0] !== tail ? `${market} · ${tail}` : tail;
}

/**
 * "od 12 dni" / "od wczoraj" / "dodana dziś", counted to today. The ad's
 * creation time when known: the loaded history may start long after it.
 */
export function ageText(ad: Pick<AbAd, "createdTime" | "firstDate">, today: string): string | null {
  const first = ad.createdTime ? formatDateWarsaw(ad.createdTime, "yyyy-MM-dd") : ad.firstDate;
  if (!first) return null;
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000);
  if (days <= 0) return "dodana dziś";
  if (days === 1) return "od wczoraj";
  return `od ${days} dni`;
}
