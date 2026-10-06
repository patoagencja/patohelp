import { Target, Trash2 } from "lucide-react";

import {
  GoalTargetFields,
  type AdsetOption,
  type CampaignOption,
} from "@/components/dashboard/goal-target-fields";
import { Button } from "@/components/ui/button";
import { StatusChip, type PingTone } from "@/components/ui/primitives";
import type { FlightMetric, PacingFlight } from "@/lib/alerts/pacing";
import { dayMonthPL, plPlural } from "@/lib/dashboard/story";
import { cn, formatNumberPL } from "@/lib/utils";

// "Czy kampanie realizują zaplanowane cele" on the Alerty page: one glass
// card per campaign goal (flight) and the agency's "add a goal" form. Pure
// presentation - the page owns the data and the server actions.

type FormAction = (formData: FormData) => void | Promise<void>;
export type { AdsetOption, CampaignOption };

// Always group thousands ("7 581 zł"): pl-PL Intl skips grouping for 4-digit
// numbers, which looks inconsistent next to "50 000 zł" in the same line.
function wholePln(minorUnits: number): string {
  const n = Math.round(minorUnits / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${n} zł`;
}

/** "10 000 kliknięć", "5 000 zł" - the goal in words, not "Kliknięcia · cel 10000". */
function targetText(metric: FlightMetric, value: number): string {
  switch (metric) {
    case "spend":
      return wholePln(value);
    case "clicks":
      return `${formatNumberPL(value)} ${plPlural(value, "kliknięcie", "kliknięcia", "kliknięć")}`;
    case "impressions":
      return `${formatNumberPL(value)} ${plPlural(value, "wyświetlenie", "wyświetlenia", "wyświetleń")}`;
    case "conversions":
      return `${formatNumberPL(value)} ${plPlural(value, "działanie", "działania", "działań")} na stronie`;
  }
}

// 2026 pastel: a status chip (ping dot + words) and the share-of-spend
// gradient fills for the bar. Ahead of plan is good news too, so it shares
// the lime family; the words tell the two apart.
const PACING_META: Record<
  PacingFlight["status"],
  { label: string; tone: PingTone; bar: string }
> = {
  behind: { label: "Poniżej tempa", tone: "amber", bar: "share-fill-warn" },
  on_track: { label: "Zgodnie z planem", tone: "live", bar: "share-fill" },
  ahead: { label: "Szybciej niż plan", tone: "lime", bar: "share-fill" },
  upcoming: { label: "Jeszcze nie ruszyła", tone: "muted", bar: "bg-chart-muted" },
  ended: { label: "Zakończona", tone: "muted", bar: "bg-chart-muted" },
};

/** "2026-10-01" -> "1.10" (flight dates are plain Warsaw days). */
const shortDate = (iso: string) => `${Number(iso.slice(8, 10))}.${iso.slice(5, 7)}`;

const METRIC_KICK: Record<FlightMetric, string> = {
  spend: "Wydatki",
  clicks: "Kliknięcia",
  impressions: "Wyświetlenia",
  conversions: "Działania na stronie",
};

/** One sentence a manager can repeat: how far along vs how far we should be. */
function pacingSentence(f: PacingFlight): string {
  const done = Math.round(f.realizedPct * 100);
  const plan = Math.round(Math.min(f.expectedPct, 1) * 100);
  switch (f.status) {
    case "behind":
      return `Zrealizowano ${done}% celu, a według planu powinno być już ${plan}%. Sprawdzamy, co hamuje kampanię.`;
    case "ahead":
      return `Zrealizowano ${done}% celu - szybciej niż zakładał plan (${plan}%).`;
    case "on_track":
      return `Zrealizowano ${done}% celu - zgodnie z planem (${plan}%).`;
    case "upcoming":
      return `Kampania rusza ${dayMonthPL(f.startDate)}.`;
    case "ended":
      return `Kampania zakończona - zrealizowano ${done}% celu.`;
  }
}

function PacingCard({
  f,
  clientSlug,
  isAgency,
  deleteAction,
}: {
  f: PacingFlight;
  clientSlug: string;
  isAgency: boolean;
  deleteAction: FormAction;
}) {
  // A reached target is the headline, running or not (same as the tiles).
  const meta =
    f.realizedPct >= 1 && f.status !== "upcoming"
      ? { label: "Cel osiągnięty", tone: "lime" as PingTone, bar: "share-fill" }
      : PACING_META[f.status];
  const realizedPct = Math.min(f.realizedPct * 100, 100);
  const expectedPct = Math.min(f.expectedPct * 100, 100);
  const running = f.status !== "upcoming" && f.status !== "ended";
  const title = f.adsetName ?? f.campaignName;

  return (
    // #cel-<id>: the goal tiles (Alerty top row, overview) link here.
    <article
      id={`cel-${f.id}`}
      className="glass flex min-w-0 scroll-mt-28 flex-col gap-4 rounded-card p-6 transition-shadow target:shadow-lime-ring sm:p-7"
    >
      {/* Phones: the status chip sits above, so the name keeps the width. */}
      <div className="flex flex-col-reverse items-start gap-3 sm:flex-row sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <p className="kick tabular-nums">
            {METRIC_KICK[f.metric]} · {shortDate(f.startDate)} - {shortDate(f.endDate)}
          </p>
          <h3 className="mt-2 break-words text-[17px] font-semibold leading-snug tracking-[-0.01em]">
            {title}
          </h3>
          {f.adsetName ? (
            <p className="mt-0.5 break-words text-sm text-ink-3">
              {f.provider === "google_ads" ? "Grupa reklam" : "Zestaw reklam"} w kampanii {f.campaignName}
            </p>
          ) : null}
        </div>
        <StatusChip tone={meta.tone} className="shrink-0">
          {meta.label}
        </StatusChip>
      </div>

      <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
        <p className="text-[2.75rem] font-light leading-none tracking-[-0.05em] tabular-nums">
          {Math.round(f.realizedPct * 100)}
          <small className="ml-0.5 text-[0.5em] tracking-[-0.02em]">%</small>
        </p>
        <p className="pb-1 text-sm text-ink-3 tabular-nums">
          celu · {targetText(f.metric, f.realized)} z {targetText(f.metric, f.target)}
        </p>
      </div>

      {/* Realized fill + a "plan na dziś" tick, same idea as the budget bar. */}
      <div className="relative h-3 w-full rounded-full bg-chip">
        <span
          className={cn("block h-full rounded-full animate-grow origin-left", meta.bar)}
          style={{ width: `${Math.max(realizedPct, 1)}%` }}
        />
        {running ? (
          <span
            className="absolute -top-1 h-5 w-[3px] -translate-x-1/2 rounded-full bg-foreground"
            style={{ left: `${expectedPct}%` }}
            title={`Plan na dziś: ${expectedPct.toFixed(0)}%`}
          >
            <span className="sr-only">Plan na dziś: {expectedPct.toFixed(0)}%</span>
          </span>
        ) : null}
      </div>

      <p className="text-[15px] leading-snug text-ink-2 tabular-nums [text-wrap:pretty]">
        {pacingSentence(f)}
      </p>

      {running || isAgency ? (
        <div className="-mb-2 mt-auto flex min-h-11 items-center justify-between gap-3 border-t border-line pt-2 text-[13px] text-ink-3 tabular-nums">
          <span>
            {running
              ? `${Math.max(f.daysLeft, 0)} ${plPlural(Math.max(f.daysLeft, 0), "dzień", "dni", "dni")} do końca`
              : ""}
          </span>
          {isAgency ? (
            <form action={deleteAction} data-present-hide data-print-hide>
              <input type="hidden" name="client" value={clientSlug} />
              <input type="hidden" name="flight" value={f.id} />
              <button
                type="submit"
                className="-mr-2 grid h-11 w-11 place-items-center rounded-full text-ink-3 transition-colors hover:bg-negative-soft hover:text-negative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Usuń cel: ${title}`}
                title="Usuń cel"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

// Shared control skin for the goal form (pastel chip fields, 44px tall).
const FIELD =
  "h-11 w-full min-w-0 rounded-2xl border border-line bg-chip px-4 text-[15px] text-foreground transition-colors hover:bg-[var(--chip-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Label + control; the kicker-style label keeps every field the same. */
function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-2", className)}>
      <span className="kick text-[11px]">{label}</span>
      {children}
    </label>
  );
}

/**
 * Agency-only "add a goal" form. One <Field> per input, all posting to
 * the page's addFlight action - a new goal dimension is one more Field here
 * plus its key in the page's addFlightSchema. Campaign + optional ad set
 * live in a small client component (the ad set list follows the campaign).
 */
function FlightForm({
  clientSlug,
  campaignOptions,
  adsetOptions,
  addAction,
}: {
  clientSlug: string;
  campaignOptions: CampaignOption[];
  adsetOptions: AdsetOption[] | null;
  addAction: FormAction;
}) {
  return (
    <form
      action={addAction}
      data-present-hide
      data-print-hide
      className="glass rounded-card p-6 sm:p-7"
    >
      <input type="hidden" name="client" value={clientSlug} />
      <p className="kick">Tylko dla agencji</p>
      <h3 className="mt-2 text-[17px] font-semibold tracking-[-0.01em]">Nowy cel kampanii</h3>
      <p className="mt-1 text-sm text-ink-3">
        Klient zobaczy postęp celu na tej stronie od razu po zapisaniu.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-start">
        <GoalTargetFields
          clientSlug={clientSlug}
          campaignOptions={campaignOptions}
          adsetOptions={adsetOptions}
          fieldClass={FIELD}
          labelClass="kick text-[11px]"
          className="sm:col-span-2"
        />
        <Field label="Co mierzymy">
          <select name="metric" required className={FIELD}>
            <option value="clicks">Kliknięcia</option>
            <option value="impressions">Wyświetlenia</option>
            <option value="spend">Wydatki (zł)</option>
            <option value="conversions">Działania na stronie</option>
          </select>
        </Field>
        <Field label="Cel">
          <input type="number" name="target" required min="1" step="any" className={FIELD} />
        </Field>
        <Field label="Start">
          <input type="date" name="start" required className={FIELD} />
        </Field>
        <Field label="Koniec">
          <input type="date" name="end" required className={FIELD} />
        </Field>
      </div>

      <Button type="submit" size="pill" className="mt-5 w-full sm:w-fit">
        Dodaj cel kampanii
      </Button>
    </form>
  );
}

/** The whole goals section: header, goal cards (or a hint), agency form. */
export function CampaignGoals({
  pacing,
  isAgency,
  clientSlug,
  campaignOptions,
  adsetOptions = null,
  addAction,
  deleteAction,
}: {
  pacing: PacingFlight[];
  isAgency: boolean;
  clientSlug: string;
  campaignOptions: CampaignOption[];
  /** Recent ad sets / ad groups; null hides the picker (not migrated yet). */
  adsetOptions?: AdsetOption[] | null;
  addAction: FormAction;
  deleteAction: FormAction;
}) {
  return (
    <section aria-labelledby="cele-kampanii" className="space-y-5">
      <div className="animate-rise [--d:.3s]">
        <p className="kick">Cele kampanii</p>
        <h2 id="cele-kampanii" className="mt-2 text-[22px] font-medium tracking-[-0.03em]">
          Czy kampanie realizują zaplanowane cele
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-3">
          Pionowa kreska na pasku pokazuje, gdzie według planu powinniśmy być dzisiaj.
        </p>
      </div>

      {pacing.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {pacing.map((f) => (
            <PacingCard
              key={f.id}
              f={f}
              clientSlug={clientSlug}
              isAgency={isAgency}
              deleteAction={deleteAction}
            />
          ))}
        </div>
      ) : (
        <p className="flex items-start gap-3 rounded-[22px] bg-chip p-4 text-sm leading-relaxed text-ink-2">
          <Target className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
          Brak ustawionych celów. Dodaj cel poniżej, aby śledzić, czy kampania
          dowozi w trakcie trwania.
        </p>
      )}

      {isAgency ? (
        <FlightForm
          clientSlug={clientSlug}
          campaignOptions={campaignOptions}
          adsetOptions={adsetOptions}
          addAction={addAction}
        />
      ) : null}
    </section>
  );
}
