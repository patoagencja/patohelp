import { formatNumberPL } from "@/lib/utils";

/** Grosze to a short headline amount: "4,1 mln zł", "312 tys. zł", "870 zł". */
export function compactPln(minor: number): string {
  const zl = minor / 100;
  if (Math.abs(zl) >= 1_000_000)
    return `${(zl / 1_000_000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} mln zł`;
  if (Math.abs(zl) >= 10_000)
    return `${(zl / 1_000).toLocaleString("pl-PL", { maximumFractionDigits: 0 })} tys. zł`;
  return `${formatNumberPL(zl)} zł`;
}

/** Short count: "96 tys.", "1,2 mln", "870". */
export function compactCount(n: number): string {
  if (Math.abs(n) >= 1_000_000)
    return `${(n / 1_000_000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} mln`;
  if (Math.abs(n) >= 10_000)
    return `${(n / 1_000).toLocaleString("pl-PL", { maximumFractionDigits: 0 })} tys.`;
  return formatNumberPL(n);
}

export type ChangeTone = "good" | "bad" | "flat";

/**
 * Change of `cur` against `prev` for a tile: "14%" with an arrow, coloured by
 * whether more is better. null when there's nothing to compare with.
 */
export function change(
  cur: number,
  prev: number,
  { higherIsBetter = true, neutral = false }: { higherIsBetter?: boolean; neutral?: boolean } = {}
): { ratio: number; text: string; tone: ChangeTone; direction: "up" | "down" | null } | null {
  if (!(prev > 0)) return null;
  const ratio = cur / prev - 1;
  const pct = Math.round(Math.abs(ratio) * 100);
  if (pct === 0) return { ratio, text: "0%", tone: "flat", direction: null };
  const up = ratio > 0;
  return {
    ratio,
    text: `${pct}%`,
    tone: neutral ? "flat" : up === higherIsBetter ? "good" : "bad",
    direction: up ? "up" : "down",
  };
}

/** ROAS as "9,2×" (one decimal is plenty for a board). */
export function roasText(value: number, spend: number): string {
  if (!(spend > 0) || !(value > 0)) return "-";
  return `${(value / spend).toLocaleString("pl-PL", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}×`;
}
