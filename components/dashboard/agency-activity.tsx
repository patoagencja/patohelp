"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { formatInTimeZone } from "date-fns-tz";
import {
  ClipboardCheck,
  EyeOff,
  FileText,
  Globe,
  Megaphone,
  Palette,
  PauseCircle,
  Plus,
  Rocket,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
  type LucideIcon,
} from "lucide-react";

import {
  addAgencyActivity,
  deleteAgencyActivity,
} from "@/app/(dashboard)/[clientSlug]/activity-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ChartEvent, ChartEventKind } from "@/lib/dashboard/chart-events";
import type {
  AgencyWork,
  AgencyWorkCategory,
  AgencyWorkEntry,
} from "@/lib/dashboard/overview";
import { cn } from "@/lib/utils";

// "Co dla Ciebie zrobiliśmy": the client sees the work behind the numbers
// (retention - an agency that only shows charts looks like it does nothing).
// Manual log entries come from client_events; automatic ones are re-phrased
// campaign starts/pauses/budget moves the chart already detected, so the log
// is never empty just because nobody had time to type.

type AutoKind = Exclude<ChartEventKind, "manual">;

// Kept in the same order as AGENCY_WORK_CATEGORIES (lib/dashboard/overview):
// that const lives in a server module, so the client can only share its type.
const CATEGORIES: AgencyWorkCategory[] = [
  "kampania",
  "kreacja",
  "optymalizacja",
  "raport",
  "strona",
  "inne",
];

// Icon chips in the earthy chart palette (v2): categories are kinds, not
// judgements, so they never borrow the positive/negative/warning tones.
const CATEGORY: Record<
  AgencyWorkCategory,
  { label: string; icon: LucideIcon; tone: string }
> = {
  kampania: {
    label: "Kampania",
    icon: Megaphone,
    tone: "bg-chart-1/10 text-chart-1 ring-chart-1/20",
  },
  kreacja: {
    label: "Kreacja",
    icon: Palette,
    tone: "bg-chart-4/10 text-chart-4 ring-chart-4/25",
  },
  optymalizacja: {
    label: "Optymalizacja",
    icon: SlidersHorizontal,
    tone: "bg-chart-2/10 text-chart-2 ring-chart-2/20",
  },
  raport: {
    label: "Raport",
    icon: FileText,
    tone: "bg-chart-5/10 text-chart-5 ring-chart-5/25",
  },
  strona: {
    label: "Strona www",
    icon: Globe,
    tone: "bg-chart-3/10 text-chart-3 ring-chart-3/20",
  },
  inne: {
    label: "Inne",
    icon: Sparkles,
    tone: "bg-muted text-muted-foreground ring-border",
  },
};

const AUTO: Record<
  AutoKind,
  { prefix: RegExp; verb: string; category: AgencyWorkCategory; icon: LucideIcon }
> = {
  start: {
    prefix: /^Start kampanii:\s*/,
    verb: "Uruchomiliśmy kampanię",
    category: "kampania",
    icon: Rocket,
  },
  stop: {
    prefix: /^Wstrzymano:\s*/,
    verb: "Wstrzymaliśmy kampanię",
    category: "kampania",
    icon: PauseCircle,
  },
  budget_up: {
    prefix: /^Zwiększono budżet:\s*/,
    verb: "Zwiększyliśmy budżet kampanii",
    category: "optymalizacja",
    icon: TrendingUp,
  },
  budget_down: {
    prefix: /^Zmniejszono budżet:\s*/,
    verb: "Zmniejszyliśmy budżet kampanii",
    category: "optymalizacja",
    icon: TrendingDown,
  },
};

// A busy month can produce a dozen budget wobbles; past three a week they
// stop reading as "work" and start reading as noise.
const MAX_AUTO_PER_WEEK = 3;
// Four entries fill one screen; the rest is a click away. On a phone the full
// list was a screen and a half of scrolling before the next section.
const COLLAPSED_ITEMS = 4;

const MONTHS_GEN = [
  "stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca",
  "lipca", "sierpnia", "września", "października", "listopada", "grudnia",
];
const MONTHS_SHORT = [
  "sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru",
];
const DOW_SHORT = ["nd", "pon", "wt", "śr", "czw", "pt", "sob"];

// yyyy-MM-dd strings are already Warsaw days: do the calendar maths in UTC so
// the browser's own timezone can't shift them.
const DAY_MS = 86_400_000;
const toUtc = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const shift = (s: string, n: number) => iso(new Date(toUtc(s).getTime() + n * DAY_MS));
const mondayOf = (s: string) => shift(s, -((toUtc(s).getUTCDay() + 6) % 7));

function dayLabel(s: string): string {
  const d = toUtc(s);
  return `${DOW_SHORT[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

function weekLabel(monday: string, today: string): string {
  const thisWeek = mondayOf(today);
  if (monday === thisWeek) return "Ten tydzień";
  if (monday === shift(thisWeek, -7)) return "Poprzedni tydzień";
  const s = toUtc(monday);
  const e = toUtc(shift(monday, 6));
  if (s.getUTCMonth() === e.getUTCMonth()) {
    return `${s.getUTCDate()}–${e.getUTCDate()} ${MONTHS_GEN[e.getUTCMonth()]}`;
  }
  return `${s.getUTCDate()} ${MONTHS_GEN[s.getUTCMonth()]} – ${e.getUTCDate()} ${MONTHS_GEN[e.getUTCMonth()]}`;
}

function actionsCount(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (n === 1) return "1 działanie";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} działania`;
  return `${n} działań`;
}

interface Item {
  key: string;
  date: string;
  category: AgencyWorkCategory;
  icon: LucideIcon;
  title: string;
  description: string | null;
  auto: boolean;
  hidden: boolean;
  /** client_events.id - only manual entries can be deleted. */
  entryId: string | null;
  weight: number;
}

/**
 * "Start kampanii: PMAX | Ruch (Google)" -> "Uruchomiliśmy kampanię „PMAX |
 * Ruch” (Google)". Text that doesn't match (e.g. an English demo) is kept
 * as-is rather than dropped.
 */
function rephrase(e: ChartEvent & { kind: AutoKind }): { title: string; campaign: string | null } {
  const spec = AUTO[e.kind];
  if (!spec.prefix.test(e.text)) return { title: e.text, campaign: null };
  const rest = e.text.replace(spec.prefix, "");
  const m = /^(.*)\s\(([^()]*)\)$/.exec(rest);
  const campaign = (m ? m[1] : rest).trim();
  const suffix = m ? ` (${m[2]})` : "";
  return { title: `${spec.verb} „${campaign}”${suffix}`, campaign };
}

function buildItems({
  entries,
  autoEvents,
  since,
  today,
  isAgency,
}: {
  entries: AgencyWorkEntry[];
  autoEvents: ChartEvent[];
  since: string;
  today: string;
  isAgency: boolean;
}): Item[] {
  const manual: Item[] = entries
    .filter((e) => e.date >= since && e.date <= today)
    // RLS already hides these from clients (0029); this is the second lock.
    .filter((e) => isAgency || e.visibleToClient)
    .map((e) => ({
      key: `m:${e.id}`,
      date: e.date,
      category: e.category,
      icon: CATEGORY[e.category].icon,
      title: e.title,
      description: e.description,
      auto: false,
      hidden: !e.visibleToClient,
      entryId: e.id,
      weight: Number.POSITIVE_INFINITY,
    }));

  const manualByDay = new Map<string, Item[]>();
  for (const m of manual) {
    manualByDay.set(m.date, [...(manualByDay.get(m.date) ?? []), m]);
  }

  const seen = new Set<string>();
  const auto: Item[] = [];
  for (const e of autoEvents) {
    if (e.kind === "manual" || e.date < since || e.date > today) continue;
    const ev = e as ChartEvent & { kind: AutoKind };
    const spec = AUTO[ev.kind];
    const { title, campaign } = rephrase(ev);
    const dupKey = `${ev.date}|${title}`;
    if (seen.has(dupKey)) continue;
    seen.add(dupKey);

    // Someone already logged this by hand on the same day - either naming
    // the campaign, or in the same kind of work (a "kampania" note on a
    // launch day, an "optymalizacja" note on a budget-change day). The typed
    // entry says it better, so the automatic one steps aside.
    const sameDay = manualByDay.get(ev.date) ?? [];
    const needle = campaign?.toLocaleLowerCase("pl");
    const duplicate = sameDay.some(
      (m) =>
        m.category === spec.category ||
        (needle ? m.title.toLocaleLowerCase("pl").includes(needle) : false)
    );
    if (duplicate) continue;

    auto.push({
      key: `a:${ev.id}`,
      date: ev.date,
      category: spec.category,
      icon: spec.icon,
      title,
      description: null,
      auto: true,
      hidden: false,
      entryId: null,
      weight: ev.weight,
    });
  }

  // Cap automatic items per week, keeping the most significant ones.
  const perWeek = new Map<string, Item[]>();
  for (const a of auto) {
    const w = mondayOf(a.date);
    perWeek.set(w, [...(perWeek.get(w) ?? []), a]);
  }
  const keptAuto = Array.from(perWeek.values()).flatMap((list) =>
    list.sort((a, b) => b.weight - a.weight).slice(0, MAX_AUTO_PER_WEEK)
  );

  // Newest first; on the same day the hand-written entries lead.
  return [...manual, ...keptAuto].sort((a, b) =>
    a.date === b.date ? Number(a.auto) - Number(b.auto) : b.date.localeCompare(a.date)
  );
}

/** Six plausible entries for the public demo, dated relative to `today`. */
function demoWork(today: string): { work: AgencyWork; autoEvents: ChartEvent[] } {
  const d = (n: number) => shift(today, -n);
  const entry = (
    id: string,
    days: number,
    category: AgencyWorkCategory,
    title: string,
    description: string | null = null
  ): AgencyWorkEntry => ({
    id,
    date: d(days),
    category,
    title,
    description,
    visibleToClient: true,
  });
  return {
    work: {
      today,
      since: d(29),
      entries: [
        entry(
          "demo-1",
          1,
          "kreacja",
          "Przygotowaliśmy 4 nowe reklamy na jesień",
          "Grafiki z sezonowymi pomidorami i 2 krótkie wideo do kampanii na Facebooku i Instagramie."
        ),
        entry(
          "demo-2",
          3,
          "optymalizacja",
          "Wykluczyliśmy 38 nietrafionych fraz w Google Ads",
          "Reklamy nie wyświetlają się już na zapytania typu „nasiona pomidorów” - budżet idzie na właściwych klientów."
        ),
        entry(
          "demo-3",
          9,
          "strona",
          "Przyspieszyliśmy stronę główną",
          "Czas ładowania na telefonie spadł z 3,8 s do 2,1 s."
        ),
        entry(
          "demo-4",
          16,
          "raport",
          "Raport miesięczny z rekomendacjami na październik"
        ),
      ],
    },
    autoEvents: [
      {
        id: "demo-auto-1",
        // Same days and % as the demo chart's markers (buildDemoChartExtras:
        // 25% / 55% into a 30-day trend) - the two used to disagree.
        date: d(13),
        kind: "budget_up",
        text: "Zwiększono budżet: TRAFFIC | Ruch na stronę (Meta, +60%)",
        weight: 1,
      },
      {
        id: "demo-auto-2",
        date: d(22),
        kind: "start",
        text: "Start kampanii: PMAX | Ruch (Google)",
        weight: 1,
      },
    ],
  };
}

export function AgencyActivity({
  work: workProp,
  autoEvents: autoProp,
  isAgency,
  clientSlug,
  demo = false,
  action,
}: {
  work?: AgencyWork;
  autoEvents?: ChartEvent[];
  isAgency: boolean;
  clientSlug: string;
  /** Public demo pages: render six synthetic entries, no editing. */
  demo?: boolean;
  /** Header control on the right, e.g. the agency's "Dodaj działanie". */
  action?: React.ReactNode;
}) {
  const demoData = useMemo(
    () =>
      demo
        ? demoWork(formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd"))
        : null,
    [demo]
  );
  const work = demoData?.work ?? workProp;
  const autoEvents = demoData?.autoEvents ?? autoProp ?? [];
  const canEdit = isAgency && !demo;
  const [showAll, setShowAll] = useState(false);

  const items = useMemo(
    () =>
      work
        ? buildItems({
            entries: work.entries,
            autoEvents,
            since: work.since,
            today: work.today,
            isAgency,
          })
        : [],
    [work, autoEvents, isAgency]
  );

  if (!work) return null;
  // An empty "what we did" box would say the opposite of what it's for.
  if (items.length === 0 && !canEdit) return null;

  const visible = showAll ? items : items.slice(0, COLLAPSED_ITEMS);
  const weeks: { monday: string; items: Item[] }[] = [];
  for (const it of visible) {
    const monday = mondayOf(it.date);
    const last = weeks[weeks.length - 1];
    if (last && last.monday === monday) last.items.push(it);
    else weeks.push({ monday, items: [it] });
  }

  return (
    // No overflow-hidden: the "Dodaj działanie" popover opens out of the header.
    <section className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
          <ClipboardCheck className="h-5 w-5 text-muted-foreground" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">Co dla Ciebie zrobiliśmy</h2>
          <p className="text-xs text-muted-foreground tabular-nums">
            Ostatnie 30 dni
            {items.length > 0 ? ` · ${actionsCount(items.length)}` : ""}
          </p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>

      {items.length === 0 ? (
        <div className="flex items-start gap-3 px-5 py-6 text-sm text-muted-foreground">
          <Plus className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            Dodaj pierwsze działanie - klient zobaczy je tutaj. Użyj przycisku
            „Dodaj działanie”{action ? " obok" : " na górze strony"}.
          </p>
        </div>
      ) : (
        <div className="space-y-5 px-5 py-4">
          {weeks.map((w) => (
            <div key={w.monday}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {weekLabel(w.monday, work.today)}
              </h3>
              <ol className="space-y-1">
                {w.items.map((it, i) => (
                  <ActivityRow
                    key={it.key}
                    item={it}
                    isAgency={isAgency}
                    canEdit={canEdit}
                    clientSlug={clientSlug}
                    connector={i < w.items.length - 1}
                  />
                ))}
              </ol>
            </div>
          ))}
          {items.length > COLLAPSED_ITEMS ? (
            <button
              type="button"
              data-print-hide
              onClick={() => setShowAll((v) => !v)}
              className="rounded-sm text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {showAll
                ? "Pokaż mniej"
                : `Pokaż wszystkie (jeszcze ${items.length - COLLAPSED_ITEMS})`}
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}

function ActivityRow({
  item,
  isAgency,
  canEdit,
  clientSlug,
  connector,
}: {
  item: Item;
  isAgency: boolean;
  canEdit: boolean;
  clientSlug: string;
  /** Draw the timeline line down to the next entry of the same week. */
  connector: boolean;
}) {
  const cat = CATEGORY[item.category];
  const Icon = item.icon;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onDelete() {
    if (!item.entryId) return;
    if (!window.confirm(`Usunąć wpis „${item.title}”? Klient przestanie go widzieć.`)) {
      return;
    }
    const fd = new FormData();
    fd.set("client", clientSlug);
    fd.set("id", item.entryId);
    setError(null);
    startTransition(async () => {
      const res = await deleteAgencyActivity(fd);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <li
      className={cn(
        "group relative flex gap-3 rounded-lg py-2 pr-2",
        pending && "opacity-50"
      )}
    >
      {connector ? (
        <span aria-hidden className="absolute -bottom-3 left-4 top-11 w-px bg-border" />
      ) : null}
      <span
        className={cn(
          "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-card ring-1",
          cat.tone
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="text-sm font-medium leading-snug text-foreground">{item.title}</p>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {dayLabel(item.date)}
          </span>
        </div>
        {item.description ? (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {item.description}
          </p>
        ) : null}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">{cat.label}</span>
          {isAgency && item.auto ? (
            <span
              className="rounded border border-border px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              title="Wykryte automatycznie ze zmian w kampaniach. Klient widzi wpis bez tej etykiety."
            >
              auto
            </span>
          ) : null}
          {isAgency && item.hidden ? (
            <span className="inline-flex items-center gap-1 rounded border border-border px-1 text-[10px] font-medium text-muted-foreground">
              <EyeOff className="h-3 w-3" aria-hidden />
              tylko agencja
            </span>
          ) : null}
          {error ? <span className="text-[11px] text-destructive">{error}</span> : null}
        </div>
      </div>
      {canEdit && item.entryId ? (
        <button
          type="button"
          onClick={onDelete}
          disabled={pending}
          aria-label={`Usuń wpis: ${item.title}`}
          className="self-start rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </li>
  );
}

/**
 * "Dodaj działanie" for the overview header (agency only): a small popover
 * form, so logging work takes ten seconds and never leaves the page.
 */
export function AddActivityButton({ clientSlug }: { clientSlug: string }) {
  const [open, setOpen] = useState(false);
  const [today, setToday] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const boxRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!saved) return;
    const t = window.setTimeout(() => setSaved(false), 2500);
    return () => window.clearTimeout(t);
  }, [saved]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  function toggle() {
    // Resolved on open, not on render: the server and the browser may sit on
    // different sides of midnight, and the default must be Warsaw's today.
    if (!open) {
      setToday(formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd"));
      setError(null);
      setSaved(false);
    }
    setOpen((v) => !v);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("client", clientSlug);
    setError(null);
    startTransition(async () => {
      const res = await addAgencyActivity(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      formRef.current?.reset();
      setTitle("");
      setSaved(true);
      setOpen(false);
    });
  }

  const selectClass =
    "flex h-9 w-full cursor-pointer rounded-xl border border-transparent bg-muted px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div ref={boxRef} className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Plus aria-hidden />
        {saved ? "Dodano ✓" : "Dodaj działanie"}
      </Button>

      {open ? (
        <div
          role="dialog"
          aria-label="Dodaj działanie dla klienta"
          className="absolute right-0 top-full z-40 mt-2 w-[min(92vw,380px)] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Dodaj działanie</p>
              <p className="text-xs text-muted-foreground">
                Pojawi się w karcie „Co dla Ciebie zrobiliśmy”.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Zamknij"
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          <form ref={formRef} onSubmit={onSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs font-medium">
                Data
                <Input
                  type="date"
                  name="date"
                  required
                  defaultValue={today}
                  max={today || undefined}
                  className="h-9 tabular-nums"
                />
              </label>
              <label className="space-y-1 text-xs font-medium">
                Kategoria
                <select name="category" defaultValue="kampania" className={selectClass}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY[c].label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block space-y-1 text-xs font-medium">
              <span className="flex justify-between">
                Co zrobiliśmy?
                <span className="font-normal text-muted-foreground tabular-nums">
                  {title.length}/120
                </span>
              </span>
              <Input
                name="title"
                required
                minLength={3}
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="np. Przygotowaliśmy 3 nowe reklamy na Black Friday"
                className="h-9"
              />
            </label>

            <label className="block space-y-1 text-xs font-medium">
              Szczegóły <span className="font-normal text-muted-foreground">(opcjonalnie)</span>
              <textarea
                name="description"
                maxLength={500}
                rows={2}
                placeholder="Krótko, językiem klienta - bez żargonu."
                className="flex w-full rounded-xl border border-transparent bg-muted px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>

            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                name="visible"
                defaultChecked
                className="h-4 w-4 rounded border-input accent-primary"
              />
              Widoczne dla klienta
            </label>

            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Anuluj
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Zapisuję…" : "Zapisz"}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
