import { Sparkles } from "lucide-react";

import { LangToggle } from "@/components/demo/lang-toggle";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { StatusChip } from "@/components/ui/primitives";
import { Sky } from "@/components/ui/sky";

// Minimal chrome for the public one-pager demo: a top bar only, no sidebar.
export const metadata = {
  title: "Demo — Dashboard klienta",
  description: "Przykładowy dashboard marketingowy (dane demonstracyjne).",
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    // relative + isolate: the pastel sky sits under the content (same
    // recipe as the dashboard shell); the bar is the floating glass pill.
    <div className="relative isolate min-h-screen bg-background">
      <Sky />
      <div className="pointer-events-none sticky top-0 z-20 mx-auto w-full max-w-6xl px-3 pt-2.5 sm:px-6 md:pt-3.5">
        <header
          data-chrome-header
          className="glass glass-blur pointer-events-auto flex min-h-[62px] items-center gap-3 rounded-full py-[7px] pl-4 pr-2 md:min-h-16"
        >
          <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-anchor text-anchor-foreground">
            <Sparkles className="h-4 w-4" aria-hidden />
            <span aria-hidden className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-anchor-dot ring-2 ring-background" />
          </span>
          <span className="truncate font-semibold tracking-[-0.02em]">lokalnepomidorki</span>
          <StatusChip tone="amber" className="hidden min-h-9 text-[13px] sm:inline-flex">
            Demo · dane przykładowe
          </StatusChip>
          <span className="flex-1" />
          <LangToggle />
          <ThemeToggle />
        </header>
      </div>

      <main id="main" className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
