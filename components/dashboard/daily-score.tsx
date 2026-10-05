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
  high: { stroke: "stroke-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  mid: { stroke: "stroke-amber-500", text: "text-amber-600 dark:text-amber-400" },
  low: { stroke: "stroke-rose-500", text: "text-rose-600 dark:text-rose-400" },
};

// Plain-language meaning of each dial. Wording mirrors lib/dashboard/score.ts:
// every ring compares the last 7 days with the client's own average from the
// weeks before, so "norma" is theirs, not an industry benchmark.
const RING_COPY: Record<Lang, Record<ScoreRing["key"], { label: string; hint: string }>> = {
  pl: {
    form: {
      label: "Forma",
      hint: "Ogólna ocena ostatnich 7 dni: klikalność, kliknięcia, wizyty na stronie i zasięg na tle Twojej normy.",
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
      hint: "Overall rating of the last 7 days: click rate, clicks, website visits and reach versus your usual level.",
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
    title: "Puls · ostatnie 7 dni",
    vsPrev: (d: number) => `${d > 0 ? "+" : ""}${d} pkt względem poprzedniego tygodnia`,
    streak: (n: number) =>
      `${n} ${n === 1 ? "dzień" : "dni"} z rzędu bez przestojów`,
    factorsIntro: "W porównaniu z Twoją normą:",
    scale: "Skala 0-100. Wynik ok. 78 oznacza typowy dla Ciebie tydzień, wyżej - lepszy niż zwykle.",
  },
  en: {
    title: "Pulse · last 7 days",
    vsPrev: (d: number) => `${d > 0 ? "+" : ""}${d} pts vs previous week`,
    streak: (n: number) => `${n} ${n === 1 ? "day" : "days"} in a row without gaps`,
    factorsIntro: "Compared with your usual level:",
    scale: "Scale 0-100. Around 78 means a typical week for you; higher is better than usual.",
  },
} as const;

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
}: {
  ring: ScoreRing;
  primary: boolean;
  delay: number;
  lang: Lang;
}) {
  const tier = TIER[ring.tier];
  const copy = RING_COPY[lang][ring.key];
  const count = useCountUp(ring.value, 950, delay);
  const [offset, setOffset] = useState(C);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOffset(C * (1 - ring.value / 100)));
    return () => cancelAnimationFrame(id);
  }, [ring.value]);

  return (
    <div className="flex items-center gap-4 sm:flex-col sm:items-center sm:gap-3 sm:text-center">
      <div
        className={cn(
          "relative shrink-0",
          primary ? "h-24 w-24 sm:h-32 sm:w-32" : "h-20 w-20 sm:h-24 sm:w-24"
        )}
        role="img"
        aria-label={`${copy.label}: ${ring.value}/100`}
      >
        <svg viewBox={`0 0 ${VB} ${VB}`} className="h-full w-full -rotate-90">
          <circle
            cx={VB / 2}
            cy={VB / 2}
            r={R}
            fill="none"
            strokeWidth={STROKE}
            className="stroke-muted"
          />
          <circle
            cx={VB / 2}
            cy={VB / 2}
            r={R}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            className={tier.stroke}
            strokeDasharray={C}
            strokeDashoffset={offset}
            style={{
              transition: `stroke-dashoffset 1.1s cubic-bezier(0.22,1,0.36,1) ${delay}ms`,
            }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className={cn(
              "font-semibold tabular-nums tracking-tight",
              primary ? "text-3xl sm:text-4xl" : "text-2xl",
              tier.text
            )}
          >
            {count}
          </span>
        </div>
      </div>
      <div className="min-w-0 sm:max-w-[15rem]">
        <p className="text-sm font-semibold text-foreground">{copy.label}</p>
        <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{copy.hint}</p>
      </div>
    </div>
  );
}

export function DailyScoreCard({
  data,
  lang = "pl",
}: {
  data: DailyScore;
  lang?: Lang;
}) {
  const t = COPY[lang];
  const factors = data.factors.filter((f) => f.deltaPct !== null);

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm font-medium text-muted-foreground">{t.title}</span>
        {data.delta !== null && data.delta !== 0 ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums",
              data.delta > 0
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "bg-rose-500/10 text-rose-700 dark:text-rose-400"
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
      <p className="mt-2 text-xl font-semibold leading-snug tracking-tight sm:text-2xl">
        {plainHeadline(data.headline, lang)}
      </p>

      {/* Rings with plain explanations */}
      <div className="mt-6 grid gap-5 sm:mt-8 sm:grid-cols-3 sm:gap-6">
        {data.rings.map((r, i) => (
          <Ring key={r.key} ring={r} primary={i === 0} delay={i * 140} lang={lang} />
        ))}
      </div>

      {/* What moved the score */}
      {factors.length > 0 || data.streak > 0 ? (
        <div className="mt-6 border-t border-border/60 pt-5 sm:mt-8">
          {factors.length > 0 ? (
            <p className="text-sm text-muted-foreground">{t.factorsIntro}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {factors.map((f) => {
              const v = f.deltaPct ?? 0;
              const up = v >= 0;
              return (
                <span
                  key={f.key}
                  className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-sm"
                >
                  <span className="text-foreground">{FACTOR_LABEL[lang][f.key]}</span>
                  <span
                    className={cn(
                      "inline-flex items-center font-medium tabular-nums",
                      up
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-rose-700 dark:text-rose-400"
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
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-sm text-foreground">
                <CalendarCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
                {t.streak(data.streak)}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <p className="mt-5 text-xs text-muted-foreground">{t.scale}</p>
    </div>
  );
}
