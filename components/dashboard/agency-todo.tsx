import Link from "next/link";
import { ChevronDown, ListChecks, PartyPopper } from "lucide-react";

import { Shimmer } from "@/components/dashboard/skeletons";
import { Button } from "@/components/ui/button";
import {
  countTodoByClient,
  TODO_SEVERITIES,
  type AgencyTodo,
  type AgencyTodoItem,
  type TodoSeverity,
} from "@/lib/agency/todo";
import { plPlural } from "@/lib/dashboard/story";
import { cn } from "@/lib/utils";

// Agency picker "Dziś do zrobienia": a cross-client to-do card plus a tiny
// status chip per client tile. Server-only (no interaction beyond links), fed
// by a promise so the page can stream it in under a Suspense boundary.

/** Avatar gradient per client, cycled by position in the picker - shared
 *  with the tiles so a client keeps one colour across the page. */
export const CLIENT_GRADIENTS = [
  "from-violet-500 to-indigo-500",
  "from-amber-400 to-orange-500",
  "from-emerald-400 to-teal-500",
  "from-sky-400 to-blue-500",
  "from-pink-500 to-rose-500",
  "from-fuchsia-500 to-purple-600",
];

export const TODO_ANCHOR = "dzis-do-zrobienia";

const SEVERITY_UI: Record<
  TodoSeverity,
  {
    heading: string;
    count: (n: number) => string;
    dot: string;
    pill: string;
    rowBorder: string;
  }
> = {
  pilne: {
    heading: "Pilne",
    count: (n) => `${n} ${plPlural(n, "pilna", "pilne", "pilnych")}`,
    dot: "bg-red-500",
    pill: "bg-red-500/10 text-red-700 ring-red-500/30 dark:text-red-400",
    rowBorder: "border-l-red-500",
  },
  wazne: {
    heading: "Ważne",
    count: (n) => `${n} ${plPlural(n, "ważna", "ważne", "ważnych")}`,
    dot: "bg-amber-500",
    pill: "bg-amber-500/10 text-amber-800 ring-amber-500/30 dark:text-amber-400",
    rowBorder: "border-l-amber-500",
  },
  wskazowka: {
    heading: "Wskazówki",
    count: (n) => `${n} ${plPlural(n, "wskazówka", "wskazówki", "wskazówek")}`,
    dot: "bg-sky-500",
    pill: "bg-sky-500/10 text-sky-800 ring-sky-500/30 dark:text-sky-300",
    rowBorder: "border-l-sky-500",
  },
};

function ActionLink({ item }: { item: AgencyTodoItem }) {
  const urgent = item.severity === "pilne";
  // OAuth connect routes are API handlers, not pages: a plain <a> avoids
  // Link trying to prefetch/client-navigate into a redirect.
  const isApi = item.actionHref.startsWith("/api/");
  return (
    <Button
      asChild
      size="sm"
      variant={urgent ? "default" : "outline"}
      className="h-8 shrink-0 rounded-full px-3 text-xs"
    >
      {isApi ? (
        <a href={item.actionHref}>{item.actionLabel}</a>
      ) : (
        <Link href={item.actionHref}>{item.actionLabel}</Link>
      )}
    </Button>
  );
}

function TodoRow({ item, gradient }: { item: AgencyTodoItem; gradient: string }) {
  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-2xl border border-l-4 border-border/60 bg-background/60 px-4 py-3 sm:flex-row sm:items-center",
        SEVERITY_UI[item.severity].rowBorder
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          aria-hidden
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-xs font-bold uppercase text-white shadow-sm",
            gradient
          )}
        >
          {item.clientName.slice(0, 2)}
        </span>
        <div className="min-w-0">
          <Link
            href={`/${item.clientSlug}`}
            className="text-sm font-semibold hover:underline"
          >
            {item.clientName}
          </Link>
          <p className="text-sm tabular-nums text-muted-foreground">{item.text}</p>
        </div>
      </div>
      <div className="flex sm:justify-end">
        <ActionLink item={item} />
      </div>
    </li>
  );
}

/** The card itself - pure, so it renders the same from real or demo data. */
export function AgencyTodoCard({
  todo,
  clientSlugs,
}: {
  todo: AgencyTodo;
  /** Picker order, to give each avatar the same gradient as its tile. */
  clientSlugs: string[];
}) {
  const gradientFor = (slug: string) => {
    const i = clientSlugs.indexOf(slug);
    return CLIENT_GRADIENTS[(i < 0 ? 0 : i) % CLIENT_GRADIENTS.length];
  };
  const groups = TODO_SEVERITIES.map((severity) => ({
    severity,
    items: todo.items.filter((i) => i.severity === severity),
  })).filter((g) => g.items.length > 0);

  return (
    <section
      id={TODO_ANCHOR}
      aria-labelledby={`${TODO_ANCHOR}-title`}
      className="scroll-mt-6 rounded-3xl border border-border/70 bg-card p-6 shadow-sm"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ListChecks className="h-5 w-5" />
          </span>
          <div>
            <h2 id={`${TODO_ANCHOR}-title`} className="text-xl font-bold tracking-tight">
              Dziś do zrobienia
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Sprawy u wszystkich klientów, najpilniejsze na górze.
            </p>
          </div>
        </div>
        {groups.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <span
                key={g.severity}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ring-1 ring-inset",
                  SEVERITY_UI[g.severity].pill
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", SEVERITY_UI[g.severity].dot)} />
                {SEVERITY_UI[g.severity].count(g.items.length)}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {groups.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-emerald-500/40 bg-emerald-500/5 px-6 py-8 text-center">
          <PartyPopper className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          <p className="text-lg font-semibold">Wszystko pod kontrolą 🎉</p>
          <p className="text-sm text-muted-foreground">
            Połączenia działają, budżety idą zgodnie z planem, klienci widzą Waszą pracę.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-5">
          {groups.map((g) => {
            const list = (
              <ul className="mt-2 space-y-2">
                {g.items.map((item, i) => (
                  <TodoRow
                    key={`${item.clientSlug}-${i}`}
                    item={item}
                    gradient={gradientFor(item.clientSlug)}
                  />
                ))}
              </ul>
            );
            const heading = (
              <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <span className={cn("h-2 w-2 rounded-full", SEVERITY_UI[g.severity].dot)} />
                {SEVERITY_UI[g.severity].heading}
                <span className="tabular-nums">({g.items.length})</span>
              </span>
            );
            // Tips are nice-to-haves: folded by default so they never push
            // the urgent rows below the fold. Native <details>, no client JS.
            return g.severity === "wskazowka" ? (
              <details key={g.severity} className="group">
                <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
                  {heading}
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                {list}
              </details>
            ) : (
              <div key={g.severity}>
                {heading}
                {list}
              </div>
            );
          })}
        </div>
      )}

      {todo.failedChecks > 0 ? (
        <p className="mt-4 text-xs tabular-nums text-muted-foreground">
          Nie udało się wykonać {todo.failedChecks}{" "}
          {plPlural(todo.failedChecks, "sprawdzenia", "sprawdzeń", "sprawdzeń")} - lista
          może być niepełna.
        </p>
      ) : null}
    </section>
  );
}

/** Streams the card in once the checks resolve. */
export async function AgencyTodoSection({
  todo,
  clientSlugs,
}: {
  todo: Promise<AgencyTodo>;
  clientSlugs: string[];
}) {
  return <AgencyTodoCard todo={await todo} clientSlugs={clientSlugs} />;
}

export function AgencyTodoSkeleton() {
  return (
    <div
      aria-busy
      aria-label="Ładowanie listy do zrobienia"
      className="rounded-3xl border border-border/70 bg-card p-6 shadow-sm"
    >
      <div className="flex items-center gap-3">
        <Shimmer className="h-10 w-10 rounded-2xl" />
        <div className="space-y-2">
          <Shimmer className="h-5 w-44" />
          <Shimmer className="h-3.5 w-64" />
        </div>
      </div>
      <div className="mt-6 space-y-2">
        {[0, 1, 2].map((i) => (
          <Shimmer key={i} className="h-14 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

// ---- per-tile chip ----

/** Compact "2 do zrobienia" status for one client tile. */
export function AgencyTodoChip({
  counts,
}: {
  counts: Record<TodoSeverity, number> | undefined;
}) {
  const total = counts ? counts.pilne + counts.wazne + counts.wskazowka : 0;
  if (!counts || total === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Nic do zrobienia
      </span>
    );
  }
  const worst: TodoSeverity =
    counts.pilne > 0 ? "pilne" : counts.wazne > 0 ? "wazne" : "wskazowka";
  return (
    <a
      href={`#${TODO_ANCHOR}`}
      className={cn(
        // The tile row is pointer-events-none so the rest of it still opens
        // the client; only the chip itself jumps to the to-do card.
        "pointer-events-auto inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-inset transition-opacity hover:opacity-80",
        SEVERITY_UI[worst].pill
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", SEVERITY_UI[worst].dot)} />
      {total} do zrobienia
      {counts.pilne > 0 ? (
        <span className="font-normal opacity-80">· {SEVERITY_UI.pilne.count(counts.pilne)}</span>
      ) : null}
    </a>
  );
}

export async function AgencyTodoChipAsync({
  todo,
  clientSlug,
}: {
  todo: Promise<AgencyTodo>;
  clientSlug: string;
}) {
  const { items } = await todo;
  return <AgencyTodoChip counts={countTodoByClient(items).get(clientSlug)} />;
}

export function AgencyTodoChipSkeleton() {
  return <Shimmer className="h-5 w-28 rounded-full" />;
}
