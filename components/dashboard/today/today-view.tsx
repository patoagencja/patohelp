import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ChevronRight, CircleCheck, Clock, Megaphone, Package, TriangleAlert } from "lucide-react";

import { KindChip } from "@/components/dashboard/ab/kind-chip";
import { CreativeThumb } from "@/components/dashboard/creatives/creative-thumb";
import { Shimmer } from "@/components/dashboard/skeletons";
import { Ping, StatusChip, type PingTone } from "@/components/ui/primitives";
import type { Brief, BriefPart } from "@/lib/today/brief";
import { plPlural } from "@/lib/dashboard/story";
import { cn } from "@/lib/utils";

import type { TodayActionItem, TodayAlertItem, TodayBestItem } from "./today-items";

// "Dziś": the phone-first morning view. One narrow column of glass cards -
// on a 390px phone each card is a thumb's scroll, and on a desktop the same
// column reads like a briefing rather than a stretched dashboard. Server
// components only; every row is one big link to the page with the rest.

const ROW =
  "group flex rounded-[22px] bg-chip transition-[background-color,transform] duration-200 hover:bg-[var(--chip-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:active:scale-[0.99]";

const rise = (d: number) => ({ "--d": `${d}s` }) as CSSProperties;

/** The page column: same gutters as every page, narrower on purpose. */
export function TodayColumn({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-3xl space-y-5 sm:space-y-6", className)}>{children}</div>;
}

function Parts({ parts }: { parts: readonly BriefPart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          p
        ) : (
          <span key={i} className="whitespace-nowrap font-medium text-foreground">
            {p.hl}
          </span>
        )
      )}
    </>
  );
}

const TONE: Record<NonNullable<Brief["tone"]>, { tone: PingTone; text: string }> = {
  up: { tone: "lime", text: "Lepiej niż zwykle" },
  down: { tone: "amber", text: "Słabiej niż zwykle" },
  flat: { tone: "muted", text: "Jak zwykle" },
};

/** Greeting + the one-sentence brief (and today so far). */
export function TodayBrief({
  brief,
  note,
  link,
}: {
  brief: Brief;
  /** Where the numbers come from (lib/today briefNote). */
  note?: string | null;
  link?: { href: string; label: string } | null;
}) {
  const tone = brief.tone ? TONE[brief.tone] : null;
  return (
    <section aria-labelledby="dzis-powitanie" className="glass min-w-0 rounded-glass p-5 animate-rise sm:p-7" style={rise(0.05)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="kick">{brief.dateLine}</p>
        {tone ? (
          <StatusChip tone={tone.tone} className="min-h-8 py-0.5 pl-3 pr-3.5 text-[13px]">
            {tone.text}
          </StatusChip>
        ) : null}
      </div>
      <h2 id="dzis-powitanie" className="mt-3 text-[1.75rem] font-medium leading-tight tracking-[-0.035em] sm:text-[2rem]">
        {brief.greeting}
      </h2>
      <p className="mt-2.5 text-pretty text-[1.25rem] leading-[1.3] tracking-[-0.025em] text-ink-3 tabular-nums sm:text-[1.5rem]">
        <Parts parts={brief.lead} />
      </p>
      {brief.todayLine ? (
        <p className="mt-3.5 flex items-start gap-2.5 text-[15px] leading-snug text-ink-2 tabular-nums">
          <Ping className="mt-[7px]" />
          <span>
            <Parts parts={brief.todayLine} />
          </span>
        </p>
      ) : null}
      {note || link ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          {note ? <p className="text-xs leading-relaxed text-ink-3">{note}</p> : <span />}
          {link ? (
            <Link
              href={link.href}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-chip px-4 text-sm font-medium text-foreground transition-colors hover:bg-[var(--chip-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {link.label}
              <ArrowRight aria-hidden className="h-3.5 w-3.5" />
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** One section card: heading + a short hint, the rows, an optional footer link. */
function Section({
  id,
  title,
  hint,
  children,
  footer,
  delay,
}: {
  id: string;
  title: string;
  hint?: string | null;
  children: ReactNode;
  footer?: { href: string; label: string } | null;
  delay: number;
}) {
  return (
    <section aria-labelledby={id} className="glass min-w-0 rounded-glass p-5 animate-rise sm:p-7" style={rise(delay)}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={id} className="text-[19px] font-medium tracking-[-0.025em]">
          {title}
        </h2>
        {hint ? <p className="text-[13px] text-ink-3">{hint}</p> : null}
      </div>
      {children}
      {footer ? (
        <Link
          href={footer.href}
          className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-full px-1 text-sm font-medium text-ink-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {footer.label}
          <ArrowRight aria-hidden className="h-3.5 w-3.5" />
        </Link>
      ) : null}
    </section>
  );
}

/** A calm "nothing here" line inside a section (no big empty panel on a phone). */
function Calm({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-[22px] bg-chip p-4">
      <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px] bg-lime text-lime-foreground">
        <CircleCheck className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0">
        <p className="text-[15px] font-medium leading-snug">{title}</p>
        <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink-3">{text}</p>
      </div>
    </div>
  );
}

/** "Na co uważać": Pilne + Ważne alerts, at most three, each opening Alerty. */
export function TodayAlerts({
  items,
  rest,
  alertsHref,
}: {
  items: TodayAlertItem[];
  rest: number;
  alertsHref: string;
}) {
  const total = items.length + rest;
  return (
    <Section
      id="dzis-uwaga"
      title="Na co uważać"
      hint={total > 0 ? `${total} ${plPlural(total, "sprawa", "sprawy", "spraw")} do sprawdzenia` : null}
      footer={rest > 0 ? { href: alertsHref, label: `Wszystkie alerty (+${rest})` } : null}
      delay={0.15}
    >
      {items.length === 0 ? (
        <Calm title="Nic pilnego" text="Żaden alert nie wymaga dziś uwagi. Pilnujemy kampanii na bieżąco." />
      ) : (
        <ul className="space-y-2.5">
          {items.map((a) => {
            const urgent = a.severity === "critical";
            const Icon = urgent ? TriangleAlert : Clock;
            return (
              <li key={a.id}>
                <Link href={alertsHref} className={cn(ROW, "items-start gap-3 p-3.5 sm:p-4")}>
                  <span
                    aria-hidden
                    className={cn(
                      "grid h-9 w-9 shrink-0 place-items-center rounded-[12px]",
                      urgent ? "bg-negative-soft text-negative" : "bg-warning-soft text-warning"
                    )}
                  >
                    <Icon className="h-[18px] w-[18px]" strokeWidth={2.2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-[12.5px] font-semibold", urgent ? "text-negative" : "text-warning")}>
                      {a.label}
                    </span>
                    <span className="block break-words text-[15px] font-medium leading-snug">{a.title}</span>
                    <span className="mt-0.5 block truncate text-[13px] text-ink-3" title={a.where}>
                      {a.where}
                    </span>
                  </span>
                  <ChevronRight aria-hidden className="mt-2 h-4 w-4 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/** "Co dziś robimy": at most three concrete moves, each opening its page. */
export function TodayActions({
  items,
  calmHref,
  withTests,
}: {
  items: TodayActionItem[];
  calmHref: string;
  /** Shops: creative test proposals can land here too (the calm line says so). */
  withTests: boolean;
}) {
  return (
    <Section
      id="dzis-robimy"
      title="Co dziś robimy"
      hint={items.length > 0 ? "najważniejsze najpierw" : null}
      footer={items.length === 0 ? { href: calmHref, label: "Przegląd" } : null}
      delay={0.25}
    >
      {items.length === 0 ? (
        <Calm
          title="Nic nie wymaga dziś decyzji"
          text={
            withTests
              ? "Gdy cel kampanii będzie zagrożony albo test reklam pokaże, co zmienić, zobaczysz to tutaj."
              : "Gdy cel kampanii będzie zagrożony, zobaczysz to tutaj."
          }
        />
      ) : (
        <ol className="space-y-2.5">
          {items.map((a) => (
            <li key={a.key}>
              <Link href={a.href} className={cn(ROW, "flex-col gap-2.5 p-4")}>
                <span className="flex items-start justify-between gap-3">
                  <KindChip meta={a.tag} className="mt-0.5" />
                  {a.figure ? (
                    // Not shrink-0: on a 390px phone the caption wraps under
                    // the amount instead of squeezing the tag (as on Testy kreacji).
                    <span className="min-w-0 max-w-[50%] text-right">
                      <span className="block whitespace-nowrap text-[20px] font-light leading-none tracking-[-0.03em] tabular-nums">
                        {a.figure.value}
                      </span>
                      <span className="mt-1 block text-[12px] leading-tight text-ink-3">{a.figure.caption}</span>
                    </span>
                  ) : null}
                </span>
                <span className="flex min-w-0 items-start gap-3">
                  {a.thumb ? (
                    <CreativeThumb
                      src={a.thumb.src}
                      name={a.thumb.name}
                      format={a.thumb.format}
                      compact
                      className="h-11 w-11 shrink-0 rounded-[12px]"
                    />
                  ) : null}
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-[15px] font-medium leading-snug">{a.title}</span>
                    {a.detail ? (
                      // No `block` here: line-clamp brings its own display.
                      <span className="mt-1 line-clamp-2 text-[13.5px] leading-relaxed text-ink-3">{a.detail}</span>
                    ) : null}
                  </span>
                  <ChevronRight aria-hidden className="mt-1 h-4 w-4 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

const BEST_ICON = { product: Package, ad: Megaphone, campaign: Megaphone } as const;

/** "Najlepiej wczoraj": the top product and the top ad. Renders nothing without either. */
export function TodayBest({ items }: { items: TodayBestItem[] }) {
  if (items.length === 0) return null;
  return (
    <Section id="dzis-najlepiej" title="Najlepiej wczoraj" delay={0.35}>
      <ul className="grid gap-2.5 sm:grid-cols-2">
        {items.map((b) => {
          const Icon = BEST_ICON[b.kind];
          return (
            <li key={b.key} className="min-w-0">
              <Link href={b.href} className={cn(ROW, "h-full items-center gap-3.5 p-3.5 sm:p-4")}>
                {b.thumb ? (
                  <CreativeThumb
                    src={b.thumb.src}
                    name={b.thumb.name}
                    format={b.thumb.format}
                    compact
                    className="h-14 w-14 shrink-0 rounded-[16px]"
                  />
                ) : (
                  <span aria-hidden className="grid h-14 w-14 shrink-0 place-items-center rounded-[16px] bg-lime-soft text-positive">
                    <Icon className="h-6 w-6" strokeWidth={1.9} />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="kick block text-[11px]">{b.kicker}</span>
                  <span className="mt-1 line-clamp-2 break-words text-[15px] font-medium leading-snug" title={b.name}>
                    {b.name}
                  </span>
                  <span className="mt-0.5 block text-[13px] leading-snug text-ink-3 tabular-nums">
                    <span className="font-medium text-foreground">{b.figure}</span> {b.caption}
                  </span>
                </span>
                <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/** Streaming placeholder for one section (same card, same heading). */
export function TodaySectionSkeleton({ title, rows = 2 }: { title: string; rows?: number }) {
  return (
    <section aria-busy="true" className="glass min-w-0 rounded-glass p-5 sm:p-7">
      <h2 className="mb-4 text-[19px] font-medium tracking-[-0.025em]">{title}</h2>
      <div className="space-y-2.5">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} aria-hidden className="flex items-center gap-3 rounded-[22px] bg-chip p-4">
            <Shimmer className="h-9 w-9 rounded-[12px]" />
            <div className="min-w-0 flex-1 space-y-2">
              <Shimmer className="h-3.5 w-24" />
              <Shimmer className="h-4 w-[min(22rem,85%)]" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The route's loading state: the brief card and the three sections. */
export function TodaySkeleton() {
  return (
    <div role="status" aria-busy="true" className="px-4 py-6 sm:px-6 md:py-8">
      <span className="sr-only">Wczytuję dane…</span>
      <TodayColumn>
        <div aria-hidden className="glass space-y-3.5 rounded-glass p-5 sm:p-7">
          <Shimmer className="h-3 w-36" />
          <Shimmer className="h-8 w-48" />
          <Shimmer className="h-5 w-[min(34rem,95%)]" />
          <Shimmer className="h-5 w-[min(24rem,70%)]" />
        </div>
        <TodaySectionSkeleton title="Na co uważać" rows={1} />
        <TodaySectionSkeleton title="Co dziś robimy" />
      </TodayColumn>
    </div>
  );
}
