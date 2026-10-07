import { formatInTimeZone } from "date-fns-tz";
import { pl } from "date-fns/locale";

import type { PlanRow } from "@/components/dashboard/plan-card";
import type { DashboardKpis, Kpi } from "@/lib/dashboard/metrics";
import type { AgencyWorkEntry } from "@/lib/dashboard/overview";
import { plPlural, type Story } from "@/lib/dashboard/story";
import { cn } from "@/lib/utils";

/**
 * The overview's story deck for "Prezentuj" (Prezentacja-2030): up to four
 * full-screen slides - the period in one sentence, the comparison with the
 * previous period, the month's plan as rings, what the agency did - shown
 * ONLY while presenting (display:none otherwise, so screen readers, print and
 * the normal page never see them). Each slide is a top-level sibling of the
 * page's sections, so presentation-mode.tsx picks them up as the first
 * slides and the live sections follow for questions.
 *
 * Built from data the overview already has (KPIs, story, plan rows, the
 * agency log) - no queries, no AI. Engagement clients never see revenue:
 * the figures here are spend, clicks, visits and cost per click only.
 */

// Entrance motion plays when the slide becomes the current one (the
// component marks it data-present-current); off for reduced motion.
const RISE = "motion-safe:[[data-present-current]_&]:animate-rise";

const SLIDE =
  "hidden print:!hidden [html[data-present=true]_&]:flex min-h-[calc(100svh-13rem)] flex-col justify-center gap-[clamp(1.5rem,3.2vh,3rem)] py-6";

const KICK = "kick !text-[clamp(.78rem,.95vw,1.05rem)] !tracking-[.16em]";

const H1 = "text-balance text-[clamp(2rem,3.9vw,4.6rem)] font-normal leading-[1.05] tracking-[-0.045em]";

// Gradient fills for the giant numbers (tokens only).
const GIANT = "font-light leading-[.88] tracking-[-0.065em] tabular-nums";
const LIME_TEXT = "bg-gradient-to-b from-lime from-20% to-lime/40 bg-clip-text pb-[.05em] text-transparent";
const MINT_TEXT = "bg-gradient-to-b from-mint from-20% to-mint/40 bg-clip-text pb-[.05em] text-transparent";

const group = (n: number) =>
  Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");

function d(delay: number): React.CSSProperties {
  return { "--d": `${delay}s` } as React.CSSProperties;
}

/**
 * Percentage change, or null on a base too thin to say it honestly. Uses the
 * KPI's own deltaPercent: for a range ending today it compares finished days
 * (metrics.ts kpiRate), so the slide agrees with the overview's story instead
 * of reading the partial day as a drop.
 */
function change(kpi: Kpi, minBase: number): number | null {
  if (kpi.value <= 0 || kpi.previous < minBase || kpi.deltaPercent === null) return null;
  return Math.round(kpi.deltaPercent);
}

export function PresentStory({
  kpis,
  story,
  planRows,
  work = [],
}: {
  kpis: DashboardKpis;
  story: Story;
  planRows: PlanRow[];
  /** "Co dla Ciebie zrobiliśmy" log (newest first). */
  work?: AgencyWorkEntry[];
}) {
  const now = new Date();
  const month = formatInTimeZone(now, "Europe/Warsaw", "LLLL", { locale: pl });
  const today = formatInTimeZone(now, "Europe/Warsaw", "yyyy-MM-dd");
  const [y, m, day] = today.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();

  const spend = kpis.spendMinorUnits.value / 100;
  const clicks = kpis.clicks.value;
  const sessions = kpis.sessions.value;
  // Nothing to tell yet (fresh client): the live page explains it better.
  if (spend <= 0 && clicks <= 0 && sessions <= 0) return null;

  const sentence = [story.verdict ? `${story.verdict.text}.` : story.headline, story.wins[0]]
    .filter(Boolean)
    .join(" ");

  const compare = [
    {
      key: "clicks",
      label: "Kliknięcia",
      pct: change(kpis.clicks, 50),
      now: clicks,
      prev: kpis.clicks.previous,
      line: `${group(clicks)} vs ${group(kpis.clicks.previous)}`,
      lowerIsBetter: false,
      tone: "lime" as const,
    },
    {
      key: "sessions",
      label: "Wizyty na stronie",
      pct: change(kpis.sessions, 50),
      now: sessions,
      prev: kpis.sessions.previous,
      line: `${group(sessions)} vs ${group(kpis.sessions.previous)}`,
      lowerIsBetter: false,
      tone: "mint" as const,
    },
    {
      key: "cpc",
      label: "Koszt kliknięcia",
      pct: clicks > 0 && kpis.clicks.previous >= 50 ? change(kpis.cpcMinorUnits, 1) : null,
      now: kpis.cpcMinorUnits.value,
      prev: kpis.cpcMinorUnits.previous,
      line: `${(kpis.cpcMinorUnits.value / 100).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`,
      lowerIsBetter: true,
      tone: "ink" as const,
    },
  ].filter((c) => c.pct !== null);

  const rings = planRows.slice(0, 3);
  const steps = work.filter((w) => w.visibleToClient).slice(0, 3);

  return (
    <>
      {/* 1 - the period in one sentence */}
      <section aria-label={`${month} w jednym zdaniu`} className={SLIDE}>
        <p className={cn(KICK, RISE)} style={d(0.1)}>
          {month} w jednym zdaniu
        </p>
        <div className="flex flex-wrap items-end gap-x-[clamp(1.5rem,3vw,3.5rem)] gap-y-6">
          {spend > 0 ? (
            <div className={RISE} style={d(0.2)}>
              <p className={cn(GIANT, "num-grad text-[clamp(4rem,12vw,15rem)]")}>
                {group(spend)}
                <span className="text-[.38em] tracking-[-0.03em]"> zł</span>
              </p>
              <p className="mt-3 text-[clamp(1rem,1.35vw,1.6rem)] text-ink-3">wydane na reklamy</p>
            </div>
          ) : null}
          {spend > 0 && clicks > 0 ? (
            <svg
              aria-hidden
              viewBox="0 0 120 60"
              className={cn("mb-[clamp(2.5rem,5vw,5.5rem)] hidden w-[clamp(4rem,6vw,7.5rem)] stroke-lime sm:block", RISE)}
              style={d(0.5)}
              fill="none"
              strokeWidth={5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 30h104M88 10l20 20-20 20" />
            </svg>
          ) : null}
          {clicks > 0 ? (
            <div className={RISE} style={d(0.6)}>
              <p className={cn(GIANT, LIME_TEXT, "text-[clamp(4rem,12vw,15rem)]")}>{group(clicks)}</p>
              <p className="mt-3 text-[clamp(1rem,1.35vw,1.6rem)] text-ink-3">
                {plPlural(clicks, "kliknięcie", "kliknięcia", "kliknięć")}
                {sessions > 0
                  ? ` · i ${group(sessions)} ${plPlural(sessions, "wizyta", "wizyty", "wizyt")} na stronie`
                  : ""}
              </p>
            </div>
          ) : null}
        </div>
        {sentence ? (
          <div
            className={cn(
              "glass flex max-w-[88rem] items-center gap-[clamp(1rem,2vw,2rem)] !rounded-[clamp(1.5rem,2.4vw,2.5rem)] px-[clamp(1.25rem,2.4vw,2.5rem)] py-[clamp(1rem,2vw,2rem)]",
              RISE
            )}
            style={d(1)}
          >
            <span aria-hidden className="orb size-[clamp(2.75rem,3.8vw,4.5rem)]">
              <span className="orb-halo" />
              <span className="orb-ring" />
              <span className="orb-core" />
            </span>
            <p className="text-[clamp(1.15rem,1.9vw,2.25rem)] leading-[1.3] tracking-[-0.02em]">{sentence}</p>
          </div>
        ) : null}
      </section>

      {/* 2 - compared with the previous period */}
      {compare.length > 0 ? (
        <section aria-label="W porównaniu z poprzednim okresem" className={SLIDE}>
          <div className={RISE} style={d(0.1)}>
            <p className={KICK}>W porównaniu z poprzednim okresem</p>
            <h2 className={cn(H1, "mt-4")}>{compareTitle(compare)}</h2>
          </div>
          <div className="grid gap-[clamp(1rem,1.7vw,2rem)] md:grid-cols-3">
            {compare.map((c, i) => {
              const good = c.pct === 0 ? null : c.lowerIsBetter ? c.pct! < 0 : c.pct! > 0;
              const max = Math.max(c.now, c.prev) || 1;
              return (
                <div
                  key={c.key}
                  className={cn(
                    "glass flex items-end justify-between gap-4 !rounded-[clamp(1.5rem,2.4vw,2.5rem)] p-[clamp(1.25rem,2.3vw,2.75rem)] md:h-[clamp(16rem,42vh,29rem)]",
                    RISE
                  )}
                  style={d(0.3 + i * 0.15)}
                >
                  <div className="flex h-full flex-col justify-between gap-6">
                    <p className="kick">{c.label}</p>
                    <div>
                      <p
                        className={cn(
                          GIANT,
                          "text-[clamp(3.25rem,7.8vw,9.5rem)]",
                          c.tone === "lime" ? LIME_TEXT : c.tone === "mint" ? MINT_TEXT : "num-grad"
                        )}
                      >
                        {c.pct! > 0 ? "+" : c.pct! < 0 ? "−" : ""}
                        {Math.abs(c.pct!)}%
                      </p>
                      <p className="mt-3 text-[clamp(.95rem,1.15vw,1.4rem)] text-ink-3">
                        {c.line}
                        {/* The sign already says the direction; words say if it is good. */}
                        {good === null
                          ? " · bez zmian"
                          : c.lowerIsBetter
                            ? good
                              ? " · taniej to dobrze"
                              : " · drożej niż wcześniej"
                            : good
                              ? ""
                              : " · mniej niż wcześniej"}
                      </p>
                    </div>
                  </div>
                  {/* Previous (grey) vs now (accent) columns. */}
                  <div aria-hidden className="hidden h-[70%] items-end gap-3 md:flex">
                    <span
                      className="w-[clamp(1.5rem,3vw,4rem)] origin-bottom rounded-[20px] bg-foreground/15 motion-safe:[[data-present-current]_&]:animate-rise"
                      style={{ height: `${Math.max(8, (c.prev / max) * 100)}%`, ...d(0.7 + i * 0.15) }}
                    />
                    <span
                      className={cn(
                        "w-[clamp(1.5rem,3vw,4rem)] origin-bottom rounded-[20px] bg-gradient-to-b motion-safe:[[data-present-current]_&]:animate-rise",
                        c.tone === "lime"
                          ? "from-lime to-lime/35 shadow-lime-glow"
                          : c.tone === "mint"
                            ? "from-mint to-mint/35"
                            : "from-foreground to-foreground/30"
                      )}
                      style={{ height: `${Math.max(8, (c.now / max) * 100)}%`, ...d(0.9 + i * 0.15) }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* 3 - the month's plan */}
      {rings.length > 0 ? (
        <section aria-label={`Plan: ${month}`} className={SLIDE}>
          <div className="flex flex-col items-center gap-[clamp(1.5rem,5vw,6rem)] lg:flex-row">
            <PlanRings rows={rings} day={day} days={days} className={RISE} />
            <div className="flex w-full min-w-0 flex-1 flex-col gap-[clamp(1rem,2.2vh,2.5rem)]">
              <div className={RISE} style={d(0.3)}>
                <p className={KICK}>Plan · {month}</p>
                <h2 className={cn(H1, "mt-4")}>{planTitle(rings)}</h2>
              </div>
              <ul className="flex flex-col gap-[clamp(.75rem,1.6vh,1.5rem)]">
                {rings.map((r, i) => (
                  <li
                    key={r.key}
                    className={cn("flex flex-wrap items-center gap-x-[clamp(.75rem,1.3vw,1.5rem)] gap-y-1 text-[clamp(1.05rem,1.6vw,1.9rem)]", RISE)}
                    style={d(0.5 + i * 0.15)}
                  >
                    <span aria-hidden className={cn("size-[clamp(.8rem,1vw,1.25rem)] shrink-0 rounded-full", ringFill(r, i))} />
                    <span className="min-w-0 flex-1 max-sm:basis-[calc(100%-2rem)]">
                      {r.label} · <span className="text-ink-2">{r.value}</span>
                    </span>
                    <span className={cn("shrink-0 tabular-nums max-sm:basis-full max-sm:pl-[calc(.8rem+.75rem)] max-sm:text-[.9em]", r.tone === "warn" ? "text-warning" : r.tone === "bad" ? "text-negative" : "")}>
                      {Math.round(r.pct)}%{r.short ? ` · ${r.short}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      {/* 4 - what the agency did */}
      {steps.length > 0 ? (
        <section aria-label="Co dla Ciebie zrobiliśmy" className={SLIDE}>
          <div className={RISE} style={d(0.1)}>
            <p className={KICK}>Co dla Ciebie zrobiliśmy</p>
            <h2 className={cn(H1, "mt-4")}>
              {steps.length === 1
                ? "Ostatni ruch z naszej strony."
                : `${steps.length === 2 ? "Dwa" : "Trzy"} ostatnie ruchy z naszej strony.`}
            </h2>
          </div>
          <ol className="grid gap-[clamp(1rem,1.7vw,2rem)] md:grid-cols-3">
            {steps.map((s, i) => (
              <li
                key={s.id}
                className={cn(
                  "glass flex flex-col justify-between gap-8 !rounded-[clamp(1.5rem,2.4vw,2.5rem)] p-[clamp(1.25rem,2.3vw,2.75rem)] md:min-h-[clamp(15rem,37vh,25rem)]",
                  RISE
                )}
                style={d(0.3 + i * 0.15)}
              >
                <span
                  aria-hidden
                  className={cn(
                    "font-mono text-[clamp(2.75rem,5vw,6rem)] leading-none",
                    i === 0 ? "text-lime" : i === 1 ? "text-mint" : "text-violet"
                  )}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <p className="text-[clamp(1.25rem,2vw,2.4rem)] font-medium leading-[1.15] tracking-[-0.03em]">{s.title}</p>
                  <p className="mt-3 text-[clamp(.95rem,1.25vw,1.5rem)] leading-[1.4] text-ink-2">
                    {s.description ?? formatInTimeZone(new Date(`${s.date}T12:00:00Z`), "Europe/Warsaw", "d MMMM", { locale: pl })}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </>
  );
}

type Compare = { key: string; pct: number | null; lowerIsBetter: boolean };

/** "Więcej ludzi, taniej" in words that match the numbers on the slide. */
function compareTitle(rows: Compare[]): string {
  const clicks = rows.find((r) => r.key === "clicks")?.pct ?? null;
  const visits = rows.find((r) => r.key === "sessions")?.pct ?? null;
  const cpc = rows.find((r) => r.key === "cpc")?.pct ?? null;
  const more = (clicks ?? 0) > 2 || (visits ?? 0) > 2;
  const fewer = (clicks ?? 0) < -2 && (visits ?? 0) <= 2;
  if (more && cpc !== null && cpc < -2) return "Więcej ludzi, taniej.";
  if (more) return "Więcej ludzi niż w poprzednim okresie.";
  if (fewer) return "Mniej ruchu niż w poprzednim okresie.";
  return "Podobnie jak w poprzednim okresie.";
}

function planTitle(rows: PlanRow[]): string {
  // "Wizyty na stronie - cel" -> "wizyty": short enough for a headline.
  const name = (r: PlanRow) =>
    r.key === "budget" ? "budżet" : / - cel$/.test(r.label) ? r.label.split(" ")[0].toLowerCase() : r.label;
  const list = (rs: PlanRow[]) => {
    const t = rs.map(name).join(" i ");
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  const ok = rows.filter((r) => r.tone === "good" || r.tone === "neutral");
  if (ok.length === rows.length) return "Wszystko idzie zgodnie z planem.";
  const behind = rows.filter((r) => r.tone === "warn");
  const over = rows.filter((r) => r.tone === "bad");
  const parts: string[] = [];
  if (ok.length) parts.push(`${list(ok)} w planie.`);
  if (behind.length) parts.push(`${list(behind)} doganiamy.`);
  if (over.length) parts.push(`${list(over)} - szybciej niż plan.`);
  return parts.join(" ");
}

const RING_FILLS = ["bg-lime shadow-lime-glow", "bg-mint", "bg-violet"];
const RING_STROKES = ["stroke-lime", "stroke-mint", "stroke-violet"];

function ringFill(r: PlanRow, i: number) {
  if (r.tone === "warn") return "bg-amber";
  if (r.tone === "bad") return "bg-coral";
  return RING_FILLS[i] ?? "bg-lime";
}
function ringStroke(r: PlanRow, i: number) {
  if (r.tone === "warn") return "stroke-amber";
  if (r.tone === "bad") return "stroke-coral";
  return RING_STROKES[i] ?? "stroke-lime";
}

function PlanRings({
  rows,
  day,
  days,
  className,
}: {
  rows: PlanRow[];
  day: number;
  days: number;
  className?: string;
}) {
  const radii = [110, 84, 58];
  const label = rows.map((r) => `${r.label} ${Math.round(r.pct)}%`).join(", ");
  return (
    <svg
      viewBox="0 0 260 260"
      role="img"
      aria-label={`${label}. Dzień ${day} z ${days}.`}
      className={cn("aspect-square w-[min(72vw,clamp(14rem,33vw,40rem))] shrink-0", className)}
      style={d(0.2)}
    >
      <g transform="rotate(-90 130 130)">
        {rows.map((r, i) => (
          <circle key={`t-${r.key}`} cx="130" cy="130" r={radii[i]} fill="none" strokeWidth="22" className="stroke-chip" />
        ))}
        {rows.map((r, i) => (
          <circle
            key={r.key}
            cx="130"
            cy="130"
            r={radii[i]}
            fill="none"
            strokeWidth="22"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray="100 100"
            className={cn(ringStroke(r, i), "motion-safe:[[data-present-current]_&]:animate-ring-fill")}
            style={{ strokeDashoffset: 100 - Math.max(0.5, r.pct), ...d(0.5 + i * 0.2) }}
          />
        ))}
      </g>
      <text x="130" y="134" textAnchor="middle" className="fill-foreground text-[34px] font-light tracking-[-0.04em]">
        {day} / {days}
      </text>
      <text x="130" y="154" textAnchor="middle" className="fill-ink-3 font-mono text-[9px] tracking-[.16em]">
        DZIEŃ MIESIĄCA
      </text>
    </svg>
  );
}
