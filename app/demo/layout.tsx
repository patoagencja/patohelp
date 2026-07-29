import { Sparkles } from "lucide-react";

import { ThemeToggle } from "@/components/dashboard/theme-toggle";

// Minimal chrome for the public one-pager demo: a top bar only, no sidebar.
export const metadata = {
  title: "Demo — Dashboard klienta",
  description: "Przykładowy dashboard marketingowy (dane demonstracyjne).",
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/20">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-card/95 px-6 backdrop-blur">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Sparkles className="h-4 w-4" />
        </span>
        <span className="font-semibold">lokalnepomidorki</span>
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
          DEMO · dane przykładowe
        </span>
        <span className="flex-1" />
        <ThemeToggle />
      </header>

      <main className="mx-auto w-full max-w-6xl space-y-6 p-6">{children}</main>
    </div>
  );
}
