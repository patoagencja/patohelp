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
import type { AbActionKind, AbAd, AbVerdictKind, AbWindowKey } from "@/lib/ab/types";
import { guessFormat, type CreativeFormat } from "@/lib/dashboard/creatives";
import { formatMoneyPLN, formatNumberPL, formatPlnWhole } from "@/lib/utils";

// Shared by the server sections and the client explorer of "Testy kreacji":
// labels, chip tones and number formats, so a verdict reads the same in the
// action list, the ad set cards and the compare panel. Server-safe.

export const AB_WINDOWS = ["today", "3d", "7d", "14d", "30d", "season"] as const satisfies readonly AbWindowKey[];

export interface KindMeta {
  label: string;
  icon: LucideIcon;
  /** Chip fill + text, AA in both themes (Pill tones). */
  chip: string;
}

// Words + icon on every chip: the colour is never the only cue.
export const VERDICT: Record<AbVerdictKind, KindMeta> = {
  winner: { label: "Wygrywa", icon: TrendingUp, chip: "bg-lime text-lime-foreground" },
  loser: { label: "Przegrywa", icon: TrendingDown, chip: "bg-negative-soft text-negative" },
  fatigue: { label: "Męczy się", icon: BatteryLow, chip: "bg-warning-soft text-warning" },
  too_early: { label: "Za wcześnie", icon: Hourglass, chip: "bg-chip text-ink-2" },
  steady: { label: "Na równi", icon: Scale, chip: "bg-chip text-ink-2" },
};

export const ACTION: Record<AbActionKind, KindMeta & { impact: string }> = {
  scale: { label: "Skaluj", icon: TrendingUp, chip: "bg-lime text-lime-foreground", impact: "sprzedaży dziennie do zyskania" },
  cut: { label: "Wyłącz", icon: Power, chip: "bg-negative-soft text-negative", impact: "dziennie do oszczędzenia" },
  refresh: { label: "Odśwież", icon: RefreshCw, chip: "bg-warning-soft text-warning", impact: "sprzedaży dziennie do odzyskania" },
  watch: { label: "Obserwuj", icon: Eye, chip: "bg-chip text-ink-2", impact: "dziennie w grze" },
};

/** The chip already says "Wyłącz", so the title drops a "Wyłącz: " lead-in. */
export function stripKindPrefix(title: string): string {
  return title.replace(/^(Skaluj|Wyłącz|Odśwież|Obserwuj)\s*:\s*/i, "");
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

/** Probability for people: never "0%" or "100%" - nothing is certain. */
export function fmtProb(p: number | null): string {
  if (p == null) return "-";
  if (p < 0.01) return "<1%";
  if (p > 0.99) return ">99%";
  return `${Math.round(p * 100)}%`;
}

export const fmtCount = (n: number) => formatNumberPL(n);

function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const t = n % 10;
  const h = n % 100;
  return t >= 2 && t <= 4 && !(h >= 12 && h <= 14) ? few : many;
}

export const adsWord = (n: number) => plural(n, "reklama", "reklamy", "reklam");
export const purchasesWord = (n: number) => plural(n, "zakup", "zakupy", "zakupów");
export const setsWord = (n: number) => plural(n, "zestaw", "zestawy", "zestawów");

/** "PL · Rodzice 25-45": market + the audience part of an ad set name. */
export function setShort(adsetName: string, market: string | null): string {
  const parts = adsetName.split("|").map((s) => s.trim()).filter(Boolean);
  const tail = parts.length > 1 ? parts[parts.length - 1] : adsetName;
  return market && parts[0] !== tail ? `${market} · ${tail}` : tail;
}

/** "od 12 dni" / "od wczoraj" / "dodana dziś" from the ad's first day. */
export function ageText(firstDate: string | null, end: string): string | null {
  if (!firstDate) return null;
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${firstDate}T00:00:00Z`)) / 86_400_000);
  if (days <= 0) return "dodana dziś";
  if (days === 1) return "od wczoraj";
  return `od ${days} dni`;
}
