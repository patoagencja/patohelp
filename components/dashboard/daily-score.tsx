"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownRight, ArrowUpRight, CalendarCheck } from "lucide-react";

import type {
  DailyScore,
  ScoreFactor,
  ScoreRing,
  ScoreTier,
} from "@/lib/dashboard/score";
import { cn } from "@/lib/utils";

type Lang = "pl" | "en";

const TIER: Record<ScoreTier, { stroke: string; text: string }> = {
  high: { stroke: "stroke-lime", text: "text-positive" },
  mid: { stroke: "stroke-amber", text: "text-warning" },
  low: { stroke: "stroke-coral", text: "text-negative" },
};

// Plain-language meaning of each dial. Wording mirrors lib/dashboard/score.ts:
// every ring compares the last 7 days with the client's own average from the
// weeks before, so "norma" is theirs, not an industry benchmark.
const RING_COPY: Record<Lang, Record<ScoreRing["key"], { label: string; hint: string }>> = {
  pl: {
    form: {
      label: "Forma",
      hint: "Ogólna ocena ostatnich 7 dni: klikalność, kliknięcia, wizyty na stronie i wyświetlenia reklam na tle Twojej normy.",
    },
    engagement: {
      label: "Zaangażowanie",
      hint: "Jak chętnie ludzie klikają w reklamy, które widzą - w porównaniu z Twoją normą.",
    },
    traffic: {
      label: "Ruch",
      hint: "Ile było kliknięć w reklamy i wizyt na stronie w ostatnich 7 dniach względem normy.",
    },
  },
  en: {
    form: {
      label: "Form",
      hint: "Overall rating of the last 7 days: click rate, clicks, website visits and ad impressions versus your usual level.",
    },
    engagement: {
      label: "Engagement",
      hint: "How willingly people click the ads they see, compared with your usual level.",
    },
    traffic: {
      label: "Traffic",
      hint: "How many ad clicks and website visits you had in the last 7 days versus your usual level.",
    },
  },
};

const FACTOR_LABEL: Record<Lang, Record<ScoreFactor["key"], string>> = {
  pl: { ctr: "Klikalność", clicks: "Kliknięcia", sessions: "Wizyty na stronie", reach: "Wyświetlenia" },
  en: { ctr: "Click rate", clicks: "Clicks", sessions: "Website visits", reach: "Impressions" },
};

const COPY = {
  pl: {
    title: "Puls tygodnia · ostatnie 7 dni na tle Twojej normy",
    vsPrev: (d: number) => `${d > 0 ? "+" : ""}${d} pkt względem poprzedniego tygodnia`,
    streak: (n: number) =>
      `${n} ${n === 1 ? "dzień" : "dni"} z rzędu bez przestojów`,
    factorsIntro: "W porównaniu z Twoją normą:",
    scale: "Skala 0-100. Wynik ok. 78 oznacza typowy dla Ciebie tydzień, wyżej - lepszy niż zwykle.",
  },
  en: {
    title: "Weekly pulse · last 7 days vs your usual level",
    vsPrev: (d: number) => `${d > 0 ? "+" : ""}${d} pts vs previous week`,
    streak: (n: number) => `${n} ${n === 1 ? "day" : "days"} in a row without gaps`,
    factorsIntro: "Compared with your usual level:",
    scale: "Scale 0-100. Around 78 means a typical week for you; higher is better than usual.",
  },
} as const;

// "86 - to dobrze?" A number on a 0-100 dial reads like a school grade, but
// 78 is "a normal week for you" (lib/dashboard/score.ts), so every ring gets
// the verdict in words. Bands are a few points wide around 78 so ordinary
// week-to-week noise still reads as "typowo".
function ringVerdict(value: number, lang: Lang): { text: string } {
  const pl = lang === "pl";
  if (value >= 82) return { text: pl ? "lepiej niż zwykle" : "better than usual" };
  if (value >= 74) return { text: pl ? "typowo" : "typical" };
  if (value >= 66) return { text: pl ? "trochę słabiej" : "a bit weaker" };
  return { text: pl ? "słabiej niż zwykle" : "weaker than usual" };
}

// The score module phrases its headline with the jargon label "CTR"; swap it
// for the plain word so the headline matches the rest of the card.
function plainHeadline(headline: string, lang: Lang): string {
  if (lang === "pl") return headline.replace(/^CTR\b/, "Klikalność");
  return headline;
}

// Count a number up from 0 on mount - the little "nabijanie się" per ring.
function useCountUp(target: number, ms = 950, delay = 0): number {
  const [n, setN] = useState(0);
  const raf = useRef<number>();
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setN(target);
      return;
    }
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now + delay;
      const t = Math.min(1, Math.max(0, (now - start) / ms));
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setN(Math.round(eased * target));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [target, ms, delay]);
  return n;
}

// Fixed viewBox; the rendered size comes from CSS so the ring can shrink on
// phones without recomputing geometry.
const VB = 120;
const STROKE = 10;
const R = VB / 2 - STROKE;
const C = 2 * Math.PI * R;

function Ring({
  ring,
  primary,
  delay,
  lang,
  compact,
}: {
  ring: ScoreRing;
  primary: boolean;
  delay: number;
  lang: Lang;
  compact: boolean;
}) {
  const tier = TIER[ring.tier];
  const copy = RING_COPY[lang][ring.key];
  const verdict = ringVerdict(ring.value, lang);
  const count = useCountUp(ring.value, 950, delay);
  const [offset, setOffset] = useState(C);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOffset(C * (1 - ring.value / 100)));
    return () => cancelAnimationFrame(id);
  }, [ring.value]);

  return (
    <div
      className={cn(
        "flex items-center gap-4",
        !compact && "sm:flex-col sm:items-center sm:gap-3 sm:text-center"
      )}
    >
      <div
        className={cn(
          "relative shrink-0",
          compact
            ? "h-16 w-16"
            : primary
              ? "h-24 w-24 sm:h-32 sm:w-32"
              : "h-20 w-20 sm:h-24 sm:w-24"
        )}
        role="img"
        aria-label={`${copy.label}: ${ring.value}/100, ${verdict.text}`}
      >
        <svg viewBox={`0 0 ${VB} ${VB}`} className="h-full w-full -rotate-90" aria-hidden>
          <circle
            cx={VB / 2}
            cy={VB / 2}
            r={R}
            fill="none"
            strokeWidth={STROKE}
            className="stroke-chip"
          />
          <circle
            cx={VB / 2}
            cy={VB / 2}
            r={R}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={offset}
            style={{
              transition: `stroke-dashoffset 1.1s cubic-bezier(0.22,1,0.36,1) ${delay}ms`,
            }}
            // Reduced motion: the ring is simply drawn at its value.
            className={cn(tier.stroke, "motion-reduce:!transition-none")}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className={cn(
              "font-light tabular-nums tracking-[-0.05em]",
              compact ? "text-[22px]" : primary ? "text-4xl sm:text-5xl" : "text-3xl",
              tier.text
            )}
          >
            {count}
          </span>
        </div>
      </div>
      <div className="min-w-0 sm:max-w-[15rem]">
        <p className="text-[15px] font-medium tracking-[-0.01em] text-foreground">
          {copy.label}
          {/* Coloured like the ring itself so word and dial never disagree. */}
          <span className={cn("ml-1.5 text-xs font-medium", tier.text)}>
            · {verdict.text}
          </span>
        </p>
        <p
          className={cn(
            "mt-0.5 leading-snug text-ink-2",
            compact ? "text-xs" : "text-sm"
          )}
        >
          {copy.hint}
        </p>
      </div>
    </div>
  );
}

export function DailyScoreCard({
  data,
  lang = "pl",
  compact = false,
}: {
  data: DailyScore;
  lang?: Lang;
  /**
   * Overview "details" layer: small dials beside their words instead of a
   * tall row of big rings - the hero already tells the headline story.
   */
  compact?: boolean;
}) {
  const t = COPY[lang];
  const factors = data.factors.filter((f) => f.deltaPct !== null);

  return (
    <div className="glass rounded-glass p-6 sm:p-7">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="kick">{t.title}</h2>
        {data.delta !== null && data.delta !== 0 ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums",
              data.delta > 0
                ? "bg-positive-soft text-positive"
                : "bg-negative-soft text-negative"
            )}
          >
            {data.delta > 0 ? (
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />
            )}
            {t.vsPrev(data.delta)}
          </span>
        ) : null}
      </div>
      <p
        className={cn(
          "mt-2 text-balance font-medium leading-snug tracking-[-0.03em]",
          compact ? "text-[22px]" : "text-[22px] sm:text-[28px]"
        )}
      >
        {plainHeadline(data.headline, lang)}
      </p>

      {/* Rings with plain explanations */}
      <div
        className={cn(
          "grid gap-5",
          compact ? "mt-5 gap-4 md:grid-cols-3" : "mt-6 sm:mt-8 sm:grid-cols-3 sm:gap-6"
        )}
      >
        {data.rings.map((r, i) => (
          <Ring
            key={r.key}
            ring={r}
            primary={i === 0}
            delay={i * 140}
            lang={lang}
            compact={compact}
          />
        ))}
      </div>

      {/* What moved the score */}
      {factors.length > 0 || data.streak > 0 ? (
        <div
          className={cn(
            "border-t border-line",
            compact ? "mt-5 pt-4" : "mt-6 pt-5 sm:mt-8"
          )}
        >
          {factors.length > 0 ? (
            <p className="text-sm text-ink-2">{t.factorsIntro}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {factors.map((f) => {
              const v = f.deltaPct ?? 0;
              const up = v >= 0;
              return (
                <span
                  key={f.key}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-chip px-3.5 py-1.5 text-sm"
                >
                  <span className="text-foreground">{FACTOR_LABEL[lang][f.key]}</span>
                  <span
                    className={cn(
                      "inline-flex items-center font-medium tabular-nums",
                      up
                        ? "text-positive"
                        : "text-negative"
                    )}
                  >
                    {up ? (
                      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {v > 0 ? "+" : ""}
                    {v}%
                  </span>
                </span>
              );
            })}
            {data.streak > 0 ? (
              <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-chip px-3.5 py-1.5 text-sm text-foreground">
                <CalendarCheck className="h-4 w-4 text-positive" aria-hidden />
                {t.streak(data.streak)}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <p className={cn("text-xs text-ink-3", compact ? "mt-3" : "mt-5")}>{t.scale}</p>
    </div>
  );
}
