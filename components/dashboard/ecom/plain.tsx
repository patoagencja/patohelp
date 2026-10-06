import { formatInTimeZone } from "date-fns-tz";
import type { ReactNode } from "react";

import { GLOSSARY } from "@/lib/dashboard/glossary";
import { cn, formatNumberPL } from "@/lib/utils";

// Shared plain-language pieces for the "Sprzedaż" tab. Shop owners show these
// cards to their board, so every card opens with one sentence that says what
// the numbers mean, and every industry abbreviation (ROAS, POAS, AOV, CR...)
// gets a friendly name plus an ⓘ explanation instead of being the label.

export type TakeawayTone = "good" | "warn" | "bad" | "neutral";

const TONE_BAR: Record<TakeawayTone, string> = {
  good: "border-emerald-500",
  warn: "border-amber-500",
  bad: "border-rose-500",
  neutral: "border-primary/60",
};

/** The one-sentence "what this card tells you", shown above the numbers. */
export function Takeaway({
  tone = "neutral",
  children,
  className,
}: {
  tone?: TakeawayTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "border-l-2 pl-3 text-[15px] font-medium leading-snug text-foreground",
        TONE_BAR[tone],
        className
      )}
    >
      {children}
    </p>
  );
}

/** Small uppercase card eyebrow with an icon ("Cel sprzedaży - październik"). */
export function CardEyebrow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
      {icon}
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** Friendly names + ⓘ copy for the e-commerce terms the glossary lacks. */
export const ECOM_TERMS = {
  roas: {
    name: GLOSSARY.roas.name,
    tag: "ROAS",
    explain: GLOSSARY.roas.explain,
  },
  poas: {
    name: "Zysk z każdej złotówki reklam",
    tag: "POAS",
    explain:
      "Ile złotych marży (sprzedaż bez VAT minus koszt towaru) przynosi każda 1 zł wydana na reklamy. Powyżej 1 zł reklamy na siebie zarabiają: 1,40 zł = po opłaceniu reklamy zostaje 40 gr.",
  },
  breakEven: {
    name: "Próg opłacalności",
    tag: null,
    explain:
      "Najniższy zwrot z reklam, przy którym przy Twojej marży reklamy jeszcze się opłacają. Próg 3,10 zł = każda 1 zł na reklamy musi przynieść min. 3,10 zł sprzedaży, żeby wyjść na zero.",
  },
  aov: {
    name: "Średni koszyk",
    tag: "AOV",
    explain: GLOSSARY.aov.explain,
  },
  cr: {
    name: "Ile wizyt kończy się zakupem",
    tag: "CR",
    explain:
      "Na ile wizyt w sklepie przypada jedno zamówienie. 2 na 100 = średnio 2 zakupy na każde 100 wizyt.",
  },
  cpa: {
    name: "Koszt jednego zamówienia",
    tag: null,
    explain:
      "Ile wydatków na reklamy przypada na jedno zamówienie z danego kanału. 40 zł = żeby ktoś kupił, zapłaciliśmy platformie średnio 40 zł.",
  },
  mtd: {
    name: "Sprzedaż od początku miesiąca",
    tag: null,
    explain:
      "Suma zamówień z pełnych, zamkniętych dni tego miesiąca według Google Analytics. Dzisiejsze zamówienia doliczymy jutro, gdy dzień się skończy.",
  },
} as const;

/**
 * Money rounded the way people say it out loud: 312 456 zł -> "312 000 zł".
 * Exact grosze in a headline sentence read as false precision.
 */
export function aboutPln(minorUnits: number): string {
  const zl = Math.abs(minorUnits) / 100;
  const step = zl >= 1_000_000 ? 10_000 : zl >= 10_000 ? 1_000 : zl >= 1_000 ? 100 : 1;
  const rounded = Math.round(zl / step) * step;
  return `${formatNumberPL(rounded)}\u00a0zł`;
}

/** A ROAS-style ratio as money per 1 zł: 4.256 -> "4,26 zł". */
export function zlPerZl(ratio: number): string {
  return `${ratio.toLocaleString("pl-PL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} zł`;
}

/** 0.4234 -> "42%". */
export function pctOf(ratio: number): string {
  return `${Math.round(ratio * 100).toLocaleString("pl-PL")}%`;
}

/**
 * 0.0213 -> "2,1 na 100" - easier to picture than "2,13%". Always one decimal
 * so a column of these lines up ("0,8" / "1,9", never "0,78" next to "1,9").
 */
export function perHundred(ratio: number): string {
  const v = ratio * 100;
  if (v > 0 && v < 0.05) return "<0,1 na 100";
  return `${v.toLocaleString("pl-PL", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} na 100`;
}

/** Today's date in Warsaw as YYYY-MM-DD (the trend's date format). */
export function todayWarsawIso(): string {
  return formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");
}

/**
 * Drops today's partial day from a daily series. Synced mid-day, today always
 * looks like a collapse at the end of a curve, which a shop owner reads as
 * "sales crashed" - so day-by-day visuals stop at yesterday.
 */
export function withoutToday<T extends { date: string }>(series: T[]): T[] {
  const today = todayWarsawIso();
  return series.filter((p) => p.date < today);
}
