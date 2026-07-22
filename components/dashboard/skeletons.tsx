import { cn } from "@/lib/utils";

// Shimmer primitive + a few page-shaped skeletons used by route loading.tsx
// files, so navigating a tab shows structure immediately instead of a blank
// jump while server components fetch.

export function Shimmer({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse rounded-md bg-muted", className)} />
  );
}

function Header() {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-2">
        <Shimmer className="h-6 w-48" />
        <Shimmer className="h-4 w-64" />
      </div>
      <Shimmer className="h-9 w-40" />
    </div>
  );
}

function Card({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-5", className)}>
      <Shimmer className="h-4 w-24" />
      <Shimmer className="mt-3 h-8 w-32" />
    </div>
  );
}

/** Overview / generic dashboard skeleton: KPI row + chart + list. */
export function DashboardSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <Header />
      <Shimmer className="h-8 w-full" />
      <Shimmer className="h-72 w-full rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} />
        ))}
      </div>
      <Shimmer className="h-40 w-full rounded-xl" />
    </div>
  );
}

/** Table-shaped skeleton (reklamy, kreacje). */
export function TableSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <Header />
      <div className="rounded-xl border border-border bg-card p-5">
        <Shimmer className="h-5 w-40" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Shimmer key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Card-grid skeleton (witryna, newsy). */
export function CardsSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <Header />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-5">
            <Shimmer className="h-4 w-20" />
            <Shimmer className="mt-3 h-5 w-full" />
            <Shimmer className="mt-2 h-4 w-4/5" />
            <Shimmer className="mt-2 h-4 w-3/5" />
          </div>
        ))}
      </div>
    </div>
  );
}
