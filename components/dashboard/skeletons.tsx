import { cn } from "@/lib/utils";

// Page-shaped loading skeletons for the route loading.tsx files (2026
// pastel). Each mirrors the real first screen of its page on the same glass
// surfaces, radii and grid breakpoints - the overview's hero + AI card, the
// glass KPI tiles, the chart card, plan + campaigns - so nothing jumps when
// the data streams in. Blocks are translucent chip fills with the calm
// `.skeleton` glint (slowed down here; still under reduced motion), and the
// chart/sparkline placeholders are faint drawn lines, not grey slabs.
// Purely presentational: one status for AT.

export function Shimmer({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("skeleton rounded-full bg-chip [animation-duration:2.4s]", className)}
    />
  );
}

/** Same column and gutters as the live pages (and the demo shell). */
function Page({
  children,
  label = "Wczytuję dane",
  className,
}: {
  children: React.ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <div role="status" aria-busy="true" className={cn("space-y-8 px-4 py-6 sm:px-6 md:py-8", className)}>
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  );
}

/** A top-level glass surface (same as <Card>). */
function Glass({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div aria-hidden className={cn("glass rounded-card", className)}>
      {children}
    </div>
  );
}

// A soft wave for sparkline / chart placeholders: drawn in the chip-hover
// ink, so it reads as "a line is coming" without pretending to be data.
const WAVE = "M0 30 C 12 24, 20 10, 32 14 S 52 30, 64 22 S 84 4, 100 10";

function Wave({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 100 34" preserveAspectRatio="none" className={cn("w-full overflow-visible", className)}>
      <path d={WAVE} fill="none" stroke="var(--chip-hover)" strokeWidth={2.4} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Page opener used by the restyled pages: kicker, big light title, lead. */
function PageHeroSkeleton({ actions = "none" }: { actions?: "range" | "seg" | "pill" | "none" }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-6 pt-2 md:pt-6">
      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Shimmer className="h-3 w-40" />
          <Shimmer className="h-[38px] w-52" />
        </div>
        <Shimmer className="h-12 w-48 rounded-2xl sm:h-14 sm:w-60" />
        <Shimmer className="h-5 w-[min(26rem,90%)]" />
      </div>
      {actions === "range" ? (
        <Shimmer className="h-[52px] w-full max-w-[24rem] sm:w-[24rem]" />
      ) : actions === "seg" ? (
        <Shimmer className="h-[52px] w-full max-w-[26rem] sm:w-[26rem]" />
      ) : actions === "pill" ? (
        <Shimmer className="h-11 w-40" />
      ) : null}
    </div>
  );
}

/** Overview hero: kicker + status chip, giant number, sentence, range | AI card. */
function HeroSkeleton() {
  return (
    <div className="flex flex-wrap items-stretch gap-7 pt-2 md:pt-6">
      <div className="flex min-w-0 flex-[1.25_1_32rem] flex-col justify-between gap-[22px]">
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-3">
            <Shimmer className="h-3 w-56" />
            <Shimmer className="h-[38px] w-52" />
          </div>
          <Shimmer className="h-[clamp(3.1rem,7.4vw,7rem)] w-[min(30rem,85%)] rounded-[28px]" />
          <div className="space-y-3">
            <Shimmer className="h-7 w-[min(38rem,95%)] rounded-xl sm:h-8" />
            <Shimmer className="h-7 w-[min(28rem,70%)] rounded-xl sm:h-8" />
          </div>
        </div>
        <Shimmer className="h-11 w-44" />
      </div>
      <div className="flex min-w-0 flex-[1_1_25rem]">
        <Glass className="flex w-full flex-col gap-5 rounded-glass p-6 sm:p-7">
          <div className="flex items-center gap-4">
            <Shimmer className="h-14 w-14" />
            <div className="space-y-2">
              <Shimmer className="h-4 w-24" />
              <Shimmer className="h-3 w-44" />
            </div>
          </div>
          <div className="space-y-2.5">
            {["w-full", "w-[94%]", "w-full", "w-[88%]", "w-[62%]"].map((w, i) => (
              <Shimmer key={i} className={cn("h-4", w)} />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Shimmer className="h-11 w-40" />
            <Shimmer className="h-11 w-44" />
            <Shimmer className="h-11 w-36" />
          </div>
          <Shimmer className="mt-auto h-14 w-full" />
        </Glass>
      </div>
    </div>
  );
}

/** One glass KPI tile: mono label + delta, light number, drawn sparkline, sub. */
function TileSkeleton({ className }: { className?: string }) {
  return (
    <Glass className={cn("flex flex-col gap-4 rounded-tile p-5 sm:p-[22px]", className)}>
      <div className="flex items-center justify-between gap-3">
        <Shimmer className="h-3 w-24" />
        <Shimmer className="h-3 w-10" />
      </div>
      <Shimmer className="h-10 w-36 rounded-xl" />
      <Wave className="h-9" />
      <Shimmer className="h-3 w-32" />
    </Glass>
  );
}

/** The KPI row: phone = the same snap carousel width, sm+ = grid. */
function TilesSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      aria-hidden
      className={cn(
        "-mx-4 flex gap-3 overflow-hidden px-4 pt-1 sm:mx-0 sm:grid sm:gap-4 sm:px-0",
        count >= 4 ? "sm:grid-cols-2 lg:grid-cols-4" : count === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"
      )}
    >
      {Array.from({ length: count }).map((_, i) => (
        <TileSkeleton key={i} className="w-[15rem] shrink-0 sm:w-auto" />
      ))}
    </div>
  );
}

/** MainChart card: kicker, title, takeaway, legend, dashed guides + a line. */
function ChartCardSkeleton({ className }: { className?: string }) {
  return (
    <Glass className={cn("rounded-glass p-6 sm:p-7", className)}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-3">
          <Shimmer className="h-3 w-32" />
          <Shimmer className="h-6 w-64 max-w-full rounded-xl" />
          <Shimmer className="h-4 w-[min(26rem,100%)]" />
        </div>
        <div className="flex gap-2">
          <Shimmer className="h-8 w-24" />
          <Shimmer className="h-8 w-28" />
        </div>
      </div>
      <div className="relative mt-7 h-56 sm:h-72">
        <div className="absolute inset-0 flex flex-col justify-between">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="border-t border-dashed border-line" />
          ))}
        </div>
        <Wave className="absolute inset-x-0 top-[18%] h-[55%]" />
        <div className="skeleton absolute inset-x-0 bottom-0 h-1/3 rounded-b-[18px] rounded-t-none bg-chip opacity-60 [animation-duration:2.4s]" />
      </div>
      <div className="mt-4 flex justify-between">
        {Array.from({ length: 5 }).map((_, i) => (
          <Shimmer key={i} className="h-3 w-10" />
        ))}
      </div>
    </Glass>
  );
}

/** PlanCard: concentric rings + legend rows. */
function PlanSkeleton({ className }: { className?: string }) {
  return (
    <Glass className={cn("rounded-glass p-6 sm:p-7", className)}>
      <Shimmer className="h-3 w-32" />
      <Shimmer className="mt-3 h-6 w-48 rounded-xl" />
      <div className="mt-6 flex flex-wrap items-center gap-6">
        <div className="relative h-40 w-40 shrink-0">
          {[0, 22, 44].map((inset) => (
            <span
              key={inset}
              className="absolute rounded-full border-[12px] border-chip"
              style={{ inset }}
            />
          ))}
        </div>
        <div className="min-w-0 flex-1 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Shimmer className="h-2.5 w-2.5" />
              <Shimmer className="h-4 flex-1" />
              <Shimmer className="h-4 w-10" />
            </div>
          ))}
        </div>
      </div>
    </Glass>
  );
}

/** TopCampaigns "Gdzie idą pieniądze": rows with share bars. */
function CampaignsSkeleton({ className, rows = 5 }: { className?: string; rows?: number }) {
  return (
    <Glass className={cn("rounded-glass p-6 sm:p-7", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <Shimmer className="h-3 w-36" />
          <Shimmer className="h-6 w-56 max-w-full rounded-xl" />
        </div>
        <Shimmer className="hidden h-11 w-36 sm:block" />
      </div>
      <div className="mt-5 divide-y divide-line">
        {[86, 64, 48, 32, 20, 12].slice(0, rows).map((w, i) => (
          <div key={i} className="flex items-center gap-4 py-3.5">
            <Shimmer className="h-2 w-2" />
            <div className="min-w-0 flex-1 space-y-2.5">
              <Shimmer className="h-4 w-[min(16rem,70%)]" />
              <div className="h-1.5 rounded-full bg-chip">
                <div className="skeleton h-full rounded-full bg-chip [animation-duration:2.4s]" style={{ width: `${w}%` }} />
              </div>
            </div>
            <Shimmer className="h-4 w-16" />
          </div>
        ))}
      </div>
    </Glass>
  );
}

/** Table card (Reklamy / Sprzedaż): title, controls, hairline rows. */
function TableCardSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Glass className="rounded-glass p-6 sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <Shimmer className="h-3 w-32" />
          <Shimmer className="h-6 w-56 max-w-full rounded-xl" />
        </div>
        <Shimmer className="hidden h-11 w-44 sm:block" />
      </div>
      <div className="mt-6 divide-y divide-line">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-4 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <Shimmer className="h-2 w-2" />
              <div className="min-w-0 space-y-2">
                <Shimmer className="h-4 w-44 sm:w-60" />
                <Shimmer className="h-3 w-24" />
              </div>
            </div>
            <div className="flex shrink-0 gap-6">
              <Shimmer className="h-4 w-16" />
              <Shimmer className="hidden h-4 w-12 sm:block" />
              <Shimmer className="hidden h-4 w-12 sm:block" />
            </div>
          </div>
        ))}
      </div>
    </Glass>
  );
}

/** Alerty card: severity tile, where line, headline, sentence, chip button. */
function AlertCardSkeleton() {
  return (
    <Glass className="relative flex items-start gap-4 rounded-[26px] p-5 sm:p-6">
      <Shimmer className="h-10 w-10 shrink-0 rounded-[14px]" />
      <div className="min-w-0 flex-1 space-y-2.5 sm:pr-36">
        <div className="flex gap-2">
          <Shimmer className="h-[22px] w-16" />
          <Shimmer className="h-[22px] w-32" />
        </div>
        <Shimmer className="h-5 w-[min(22rem,85%)]" />
        <Shimmer className="h-4 w-[min(32rem,95%)]" />
        <Shimmer className="mt-3 h-11 w-28 sm:absolute sm:right-6 sm:top-6 sm:mt-0" />
      </div>
    </Glass>
  );
}

function AlertGroupSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3.5">
      <div className="flex items-center gap-3">
        <Shimmer className="h-2 w-2" />
        <Shimmer className="h-3 w-24" />
        <Shimmer className="h-3 w-48" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <AlertCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

/** Przegląd: hero + AI card, four glass tiles, chart, plan + campaigns. */
export function DashboardSkeleton() {
  return (
    <Page>
      <HeroSkeleton />
      <div className="space-y-4">
        <Shimmer className="h-3.5 w-[min(28rem,85%)]" />
        <TilesSkeleton />
        <div className="pt-3">
          <ChartCardSkeleton />
        </div>
      </div>
      <div className="flex flex-wrap items-stretch gap-6">
        <PlanSkeleton className="min-w-0 flex-[1_1_22rem]" />
        <CampaignsSkeleton className="min-w-0 flex-[1.7_1_34rem]" />
      </div>
    </Page>
  );
}

/** Reklamy: header, Kampanie | Kreacje tabs, tiles, chart, table. */
export function TableSkeleton() {
  return (
    <Page>
      <PageHeroSkeleton actions="range" />
      <Shimmer className="h-[52px] w-56" />
      <TilesSkeleton />
      <ChartCardSkeleton />
      <TableCardSkeleton rows={6} />
    </Page>
  );
}

/** Kreacje: header, tabs, the best creatives as glass media cards. */
export function CreativesSkeleton() {
  return (
    <Page>
      <PageHeroSkeleton actions="pill" />
      <Shimmer className="h-[52px] w-56" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Glass key={i} className={cn("overflow-hidden", i === 2 && "sm:hidden lg:block")}>
            <div className="skeleton aspect-[4/3] rounded-none bg-chip [animation-duration:2.4s]" />
            <div className="space-y-3 p-6">
              <Shimmer className="h-3 w-24" />
              <Shimmer className="h-5 w-4/5" />
              <Shimmer className="h-4 w-3/5" />
              <div className="flex gap-5 border-t border-line pt-4">
                <Shimmer className="h-8 w-16 rounded-xl" />
                <Shimmer className="h-8 w-16 rounded-xl" />
                <Shimmer className="h-8 w-16 rounded-xl" />
              </div>
            </div>
          </Glass>
        ))}
      </div>
    </Page>
  );
}

/** Strona www: header, three tiles, sources + top pages cards. */
export function CardsSkeleton() {
  return (
    <Page>
      <PageHeroSkeleton actions="range" />
      <TilesSkeleton count={3} />
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <CampaignsSkeleton key={i} />
        ))}
      </div>
    </Page>
  );
}

/** Alerty: header with the severity filter, two groups of alert cards. */
export function AlertsSkeleton() {
  return (
    <Page label="Sprawdzam alerty">
      <PageHeroSkeleton actions="seg" />
      <AlertGroupSkeleton rows={1} />
      <AlertGroupSkeleton rows={2} />
    </Page>
  );
}

/** Newsy / Słowniczek: header, (filters), grouped list cards. */
export function ListSkeleton({ filters = false }: { filters?: boolean }) {
  return (
    <Page>
      <PageHeroSkeleton actions={filters ? "seg" : "none"} />
      {Array.from({ length: 2 }).map((_, g) => (
        <div key={g} className="space-y-3.5">
          <Shimmer className="h-3 w-32" />
          <Glass className="divide-y divide-line">
            {Array.from({ length: g + 1 }).map((_, i) => (
              <div key={i} className="space-y-2.5 px-6 py-5 sm:px-7">
                <Shimmer className="h-[22px] w-20" />
                <Shimmer className="h-5 w-[min(26rem,85%)]" />
                <Shimmer className="h-4 w-[min(36rem,95%)]" />
              </div>
            ))}
          </Glass>
        </div>
      ))}
    </Page>
  );
}

/** Sprzedaż: header with the range picker, tiles, chart, table. */
export function SalesSkeleton() {
  return (
    <Page>
      <PageHeroSkeleton actions="range" />
      <TilesSkeleton />
      <ChartCardSkeleton />
      <TableCardSkeleton rows={4} />
    </Page>
  );
}

/** Raport: header + one 16:9 glass slide. */
export function DeckSkeleton() {
  return (
    <Page label="Przygotowuję raport">
      <PageHeroSkeleton actions="pill" />
      <Glass className="aspect-video w-full rounded-glass p-6 sm:p-10">
        <Shimmer className="h-3 w-40" />
        <Shimmer className="mt-4 h-10 w-72 max-w-full rounded-2xl" />
        <Shimmer className="mt-3 h-4 w-80 max-w-full" />
        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-3">
              <Shimmer className="h-3 w-20" />
              <Shimmer className="h-9 w-28 rounded-xl" />
            </div>
          ))}
        </div>
      </Glass>
    </Page>
  );
}

/** Ustawienia: header + stacked glass form cards. */
export function SettingsSkeleton() {
  return (
    <Page>
      <PageHeroSkeleton />
      {Array.from({ length: 3 }).map((_, i) => (
        <Glass key={i} className="p-6 sm:p-7">
          <Shimmer className="h-3 w-28" />
          <Shimmer className="mt-3 h-6 w-48 rounded-xl" />
          <Shimmer className="mt-3 h-4 w-80 max-w-full" />
          <div className="mt-6 space-y-3">
            <Shimmer className="h-11 w-full max-w-md rounded-2xl" />
            <Shimmer className="h-11 w-full max-w-md rounded-2xl" />
          </div>
          <Shimmer className="mt-5 h-11 w-36" />
        </Glass>
      ))}
    </Page>
  );
}
