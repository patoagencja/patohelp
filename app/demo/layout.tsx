import { Sparkles } from "lucide-react";

import { LangToggle } from "@/components/demo/lang-toggle";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { Pill } from "@/components/ui/pill";

// Minimal chrome for the public one-pager demo: a top bar only, no sidebar.
export const metadata = {
  title: "Demo — Dashboard klienta",
  description: "Przykładowy dashboard marketingowy (dane demonstracyjne).",
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      {/* Same translucent chrome as the full demo / client dashboard. */}
      <header
        data-chrome-header
        className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-transparent bg-chrome/75 px-4 backdrop-blur-xl backdrop-saturate-150 sm:px-6"
      >
        <span className="relative flex h-8 w-8 items-center justify-center rounded-[0.6rem] bg-anchor text-anchor-foreground">
          <Sparkles className="h-4 w-4" aria-hidden />
          <span aria-hidden className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-anchor-dot ring-2 ring-background" />
        </span>
        <span className="font-semibold">lokalnepomidorki</span>
        <Pill tone="warning" className="hidden sm:inline-flex">
          Demo · dane przykładowe
        </Pill>
        <span className="flex-1" />
        <LangToggle />
        <ThemeToggle />
      </header>

      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
