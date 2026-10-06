import { cn } from "@/lib/utils";

// Page-shaped loading skeletons for the route loading.tsx files (v2 skin).
// Each mirrors the real first screen of its page - PageHeader, KPI tiles,
// chart card, table/list card - on the same borderless r-24 surfaces and with
// the same grid breakpoints, so nothing jumps when the data streams in. The
// blocks use the calm `.skeleton` glint from globals.css (still under
// prefers-reduced-motion). Purely presentational: one status for AT.

export function Shimmer({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton rounded-full", className)} />;
}

/** Same column and gutters as the live pages (and the demo shell). */
function Page({ children, label = "Wczytuję dane" }: { children: React.ReactNode; label?: string }) {
  return (
    <div role="status" aria-busy="true" className="space-y-8 px-4 py-6 sm:px-6 md:py-8 lg:px-6">
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  );
}

/** A top-level surface: same radius, hairline and shadow as <Card>. */
function Surface({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div
      aria-hidden
      className={cn("rounded-card border border-hairline bg-card shadow-card", className)}
    >
      {children}
    </div>
  );
}

/** <PageHeader>: title + one sentence, controls on the right. */
function HeaderSkeleton({ actions = "range" }: { actions?: "range" | "pill" | "none" }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-3">
        <Shimmer className="h-8 w-44 rounded-xl md:h-9" />
        <Shimmer className="h-4 w-[min(22rem,80vw)]" />
      </div>
      {actions === "range" ? (
        // The date range segmented control.
        <Shimmer className="h-10 w-full max-w-[24rem] sm:w-[24rem]" />
      ) : actions === "pill" ? (
        <Shimmer className="h-8 w-36" />
      ) : null}
    </div>
  );
}

/** Segmented tabs / filters under the header (Kampanie | Kreacje). */
function TabsSkeleton({ width = "w-52" }: { width?: string }) {
  return <Shimmer className={cn("h-11", width)} />;
}

function TileSkeleton() {
  return (
    <Surface className="p-4 sm:p-5">
      <Shimmer className="h-4 w-24" />
      <Shimmer className="mt-3 h-8 w-32 rounded-lg" />
      <div className="mt-4 flex items-end justify-between gap-2">
        <div className="space-y-2">
          <Shimmer className="h-5 w-14" />
          <Shimmer className="h-3 w-28" />
        </div>
        <Shimmer className="hidden h-8 w-20 rounded-lg sm:block" />
      </div>
    </Surface>
  );
}

function TilesSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 sm:gap-4", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <TileSkeleton key={i} />
      ))}
    </div>
  );
}

/** Chart card: title, one-line takeaway, legend chips, dashed guides. */
function ChartCardSkeleton({ className }: { className?: string }) {
  return (
    <Surface className={cn("p-5 sm:p-6", className)}>
      <Shimmer className="h-5 w-48" />
      <Shimmer className="mt-3 h-4 w-[min(20rem,70%)]" />
      <div className="mt-4 flex gap-2">
        <Shimmer className="h-6 w-20" />
        <Shimmer className="h-6 w-28" />
      </div>
      <div className="relative mt-6 h-52 sm:h-60">
        {/* Thin dashed guides like the real chart, then a soft area. */}
        <div className="absolute inset-0 flex flex-col justify-between">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="border-t border-dashed border-border" />
          ))}
        </div>
        <Shimmer className="absolute inset-x-0 bottom-0 h-3/5 rounded-b-none rounded-t-3xl opacity-80" />
      </div>
    </Surface>
  );
}

/** Plan miesiąca: half gauge + striped goal bars. */
function PlanSkeleton() {
  return (
    <Surface className="p-5 sm:p-6">
      <Shimmer className="h-5 w-36" />
      <div className="mt-6 flex justify-center">
        <div className="h-24 w-48 rounded-t-full border-[14px] border-b-0 border-muted" />
      </div>
      <div className="mt-6 space-y-6">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i}>
            <div className="flex items-center justify-between">
              <Shimmer className="h-4 w-36" />
              <Shimmer className="h-6 w-12 rounded-lg" />
            </div>
            <Shimmer className="mt-3 h-3.5 w-full" />
          </div>
        ))}
      </div>
    </Surface>
  );
}

/** Table card (campaigns): title, header row, hairline rows. */
function TableCardSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Surface className="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2.5">
          <Shimmer className="h-5 w-52" />
          <Shimmer className="h-4 w-64 max-w-full" />
        </div>
        <Shimmer className="hidden h-9 w-40 sm:block" />
      </div>
      <div className="mt-6 divide-y divide-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-4 py-4">
            <div className="min-w-0 space-y-2">
              <Shimmer className="h-4 w-44 sm:w-60" />
              <Shimmer className="h-4 w-24" />
            </div>
            <div className="flex shrink-0 gap-6">
              <Shimmer className="h-4 w-16" />
              <Shimmer className="hidden h-4 w-12 sm:block" />
              <Shimmer className="hidden h-4 w-12 sm:block" />
            </div>
          </div>
        ))}
      </div>
    </Surface>
  );
}

/** Grouped list card (alerts, news, glossary): label + rows. */
function ListGroupSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      <Shimmer className="h-4 w-36" />
      <Surface className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="space-y-2.5 px-5 py-5 sm:px-6">
            <Shimmer className="h-5 w-16" />
            <Shimmer className="h-4 w-[min(26rem,85%)]" />
            <Shimmer className="h-3.5 w-[min(36rem,95%)]" />
          </div>
        ))}
      </Surface>
    </div>
  );
}

/** Przegląd: header, summary card, four tiles, chart + plan, campaigns. */
export function DashboardSkeleton() {
  return (
    <Page>
      <HeaderSkeleton />
      <Surface className="p-6 sm:p-8">
        <Shimmer className="h-7 w-52" />
        <Shimmer className="mt-5 h-7 w-[min(36rem,90%)] rounded-xl" />
        <Shimmer className="mt-2.5 h-7 w-[min(26rem,70%)] rounded-xl" />
        {/* The "Analiza AI" banner keeps its wash while loading. */}
        <div className="bg-ai-wash mt-6 rounded-2xl p-5">
          <Shimmer className="h-7 w-28 bg-card" />
          <Shimmer className="mt-4 h-4 w-[min(40rem,95%)] bg-card/70" />
          <Shimmer className="mt-2 h-4 w-[min(30rem,80%)] bg-card/70" />
        </div>
      </Surface>
      <div className="space-y-4">
        <Shimmer className="h-4 w-[min(28rem,85%)]" />
        <TilesSkeleton className="xl:grid-cols-4" />
        <div className="grid items-start gap-4 xl:grid-cols-3">
          <ChartCardSkeleton className="min-w-0 xl:col-span-2" />
          <PlanSkeleton />
        </div>
      </div>
      <TableCardSkeleton />
    </Page>
  );
}

/** Reklamy: header, Kampanie | Kreacje tabs, four tiles, chart, table. */
export function TableSkeleton() {
  return (
    <Page>
      <HeaderSkeleton actions="pill" />
      <TabsSkeleton />
      <TilesSkeleton className="lg:grid-cols-4" />
      <ChartCardSkeleton />
      <TableCardSkeleton rows={6} />
    </Page>
  );
}

/** Kreacje: header, tabs, the three best creatives as media cards. */
export function CreativesSkeleton() {
  return (
    <Page>
      <HeaderSkeleton actions="pill" />
      <TabsSkeleton />
      <div className="space-y-2.5">
        <Shimmer className="h-5 w-44" />
        <Shimmer className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Surface key={i} className={cn("overflow-hidden", i === 2 && "sm:hidden lg:block")}>
            <div className="skeleton aspect-[4/3] rounded-none" />
            <div className="space-y-2.5 p-5">
              <Shimmer className="h-6 w-36" />
              <Shimmer className="h-4 w-4/5" />
              <Shimmer className="h-4 w-3/5" />
              <div className="flex gap-4 border-t border-border pt-4">
                <Shimmer className="h-8 w-14 rounded-lg" />
                <Shimmer className="h-8 w-14 rounded-lg" />
                <Shimmer className="h-8 w-14 rounded-lg" />
              </div>
            </div>
          </Surface>
        ))}
      </div>
    </Page>
  );
}

/** Strona www: header, three tiles, sources + top pages cards. */
export function CardsSkeleton() {
  return (
    <Page>
      <HeaderSkeleton actions="none" />
      <TilesSkeleton count={3} className="lg:grid-cols-3 [&>*:nth-child(3)]:col-span-2 lg:[&>*:nth-child(3)]:col-span-1" />
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Surface key={i} className="p-5 sm:p-6">
            <Shimmer className="h-5 w-48" />
            <Shimmer className="mt-3 h-4 w-64 max-w-full" />
            <div className="mt-6 space-y-5">
              {[78, 60, 42, 30, 18].map((w) => (
                <div key={w}>
                  <div className="flex justify-between gap-4">
                    <Shimmer className="h-4 w-40" />
                    <Shimmer className="h-4 w-20" />
                  </div>
                  <div className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-muted">
                    <div className="skeleton h-full rounded-full bg-input" style={{ width: `${w}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Surface>
        ))}
      </div>
    </Page>
  );
}

/** Newsy / Alerty / Słowniczek: header, (filters), grouped list cards. */
export function ListSkeleton({ filters = false }: { filters?: boolean }) {
  return (
    <Page>
      <HeaderSkeleton actions="none" />
      {filters ? <TabsSkeleton width="w-[min(25rem,100%)]" /> : <Shimmer className="h-5 w-72 max-w-full" />}
      <ListGroupSkeleton rows={1} />
      <ListGroupSkeleton rows={2} />
    </Page>
  );
}

/** Sprzedaż: header with the range picker, four tiles, chart, table. */
export function SalesSkeleton() {
  return (
    <Page>
      <HeaderSkeleton />
      <TilesSkeleton className="lg:grid-cols-4" />
      <ChartCardSkeleton />
      <TableCardSkeleton rows={4} />
    </Page>
  );
}

/** Raport: header + one 16:9 slide. */
export function DeckSkeleton() {
  return (
    <Page label="Przygotowuję raport">
      <HeaderSkeleton actions="pill" />
      <Surface className="aspect-video w-full p-6 sm:p-10">
        <Shimmer className="h-8 w-64 max-w-full rounded-xl" />
        <Shimmer className="mt-3 h-4 w-80 max-w-full" />
        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2.5">
              <Shimmer className="h-3.5 w-20" />
              <Shimmer className="h-8 w-28 rounded-lg" />
            </div>
          ))}
        </div>
      </Surface>
    </Page>
  );
}

/** Ustawienia: header + stacked form cards. */
export function SettingsSkeleton() {
  return (
    <Page>
      <HeaderSkeleton actions="none" />
      {Array.from({ length: 3 }).map((_, i) => (
        <Surface key={i} className="p-5 sm:p-6">
          <Shimmer className="h-5 w-44" />
          <Shimmer className="mt-3 h-4 w-80 max-w-full" />
          <div className="mt-6 space-y-3">
            <Shimmer className="h-11 w-full max-w-md rounded-xl" />
            <Shimmer className="h-11 w-full max-w-md rounded-xl" />
          </div>
          <Shimmer className="mt-5 h-10 w-32" />
        </Surface>
      ))}
    </Page>
  );
}
