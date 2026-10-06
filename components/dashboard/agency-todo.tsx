import Link from "next/link";
import { CheckCircle2, ChevronDown } from "lucide-react";

import { Shimmer } from "@/components/dashboard/skeletons";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/page-header";
import { Pill, pillVariants } from "@/components/ui/pill";
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

/** Client initials avatar - one calm neutral chip everywhere (tiles and
 *  to-do rows), so colour on the agency picker only ever means status. */
export const CLIENT_AVATAR =
  "flex shrink-0 items-center justify-center rounded-xl bg-muted font-semibold uppercase text-foreground";

export const TODO_ANCHOR = "dzis-do-zrobienia";

const SEVERITY_UI: Record<
  TodoSeverity,
  {
    heading: string;
    count: (n: number) => string;
    dot: string;
    tone: "negative" | "warning" | "neutral";
  }
> = {
  pilne: {
    heading: "Pilne",
    count: (n) => `${n} ${plPlural(n, "pilna", "pilne", "pilnych")}`,
    dot: "bg-negative ring-negative-soft",
    tone: "negative",
  },
  wazne: {
    heading: "Ważne",
    count: (n) => `${n} ${plPlural(n, "ważna", "ważne", "ważnych")}`,
    dot: "bg-warning-fill ring-warning-soft",
    tone: "warning",
  },
  wskazowka: {
    heading: "Wskazówki",
    count: (n) => `${n} ${plPlural(n, "wskazówka", "wskazówki", "wskazówek")}`,
    dot: "bg-chart-muted ring-muted",
    tone: "neutral",
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

function TodoRow({ item }: { item: AgencyTodoItem }) {
  return (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span aria-hidden className={cn(CLIENT_AVATAR, "h-9 w-9 text-xs")}>
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
}: {
  todo: AgencyTodo;
  /** Kept for callers; avatars no longer vary per client. */
  clientSlugs?: string[];
}) {
  const groups = TODO_SEVERITIES.map((severity) => ({
    severity,
    items: todo.items.filter((i) => i.severity === severity),
  })).filter((g) => g.items.length > 0);

  return (
    <section
      id={TODO_ANCHOR}
      aria-labelledby={`${TODO_ANCHOR}-title`}
      className="surface scroll-mt-24 p-6 sm:p-7"
    >
      <SectionHeader
        title={<span id={`${TODO_ANCHOR}-title`}>Dziś do zrobienia</span>}
        description="Sprawy u wszystkich klientów, najpilniejsze na górze."
        actions={
          groups.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {groups.map((g) => (
                <Pill key={g.severity} tone={SEVERITY_UI[g.severity].tone} className="tabular-nums">
                  {SEVERITY_UI[g.severity].count(g.items.length)}
                </Pill>
              ))}
            </div>
          ) : null
        }
      />

      {groups.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-2 px-6 py-6 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-positive-soft">
            <CheckCircle2 className="h-5 w-5 text-positive" aria-hidden />
          </span>
          <p className="text-base font-semibold">Wszystko pod kontrolą</p>
          <p className="text-sm text-muted-foreground">
            Połączenia działają, budżety idą zgodnie z planem, klienci widzą Waszą pracę.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {groups.map((g) => {
            const list = (
              <ul className="mt-1 divide-y divide-border">
                {g.items.map((item, i) => (
                  <TodoRow key={`${item.clientSlug}-${i}`} item={item} />
                ))}
              </ul>
            );
            const heading = (
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span className={cn("h-2 w-2 rounded-full ring-[3px]", SEVERITY_UI[g.severity].dot)} aria-hidden />
                {SEVERITY_UI[g.severity].heading}
                <span className="font-normal text-muted-foreground tabular-nums">{g.items.length}</span>
              </span>
            );
            // Tips are nice-to-haves: folded by default so they never push
            // the urgent rows below the fold. Native <details>, no client JS.
            return g.severity === "wskazowka" ? (
              <details key={g.severity} className="group">
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md [&::-webkit-details-marker]:hidden">
                  {heading}
                  <ChevronDown
                    className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
                    aria-hidden
                  />
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
      className="surface p-6 sm:p-7"
    >
      <div className="space-y-2">
        <Shimmer className="h-6 w-44" />
        <Shimmer className="h-3.5 w-64" />
      </div>
      <div className="mt-6 space-y-2">
        {[0, 1, 2].map((i) => (
          <Shimmer key={i} className="h-12 w-full rounded-xl" />
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
      <Pill tone="positive">
        <span className="h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />
        Nic do zrobienia
      </Pill>
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
        pillVariants({ tone: SEVERITY_UI[worst].tone }),
        "pointer-events-auto tabular-nums transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", SEVERITY_UI[worst].dot)} aria-hidden />
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
