import { Sparkles } from "lucide-react";

import { DemoSidebar } from "@/components/demo/demo-sidebar";
import { LangToggle } from "@/components/demo/lang-toggle";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";

// Full showcase with a working sidebar and clickable tabs. Public, synthetic.
export const metadata = {
  title: "Demo (pełne) — Dashboard klienta",
  description: "Pełny przykładowy dashboard marketingowy (dane demonstracyjne).",
};

export default function DemoFullLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-muted/20">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
        <div className="flex h-14 items-center gap-2.5 border-b border-border px-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="font-semibold">lokalnepomidorki</span>
        </div>
        <DemoSidebar />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-border bg-card px-6">
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
            DEMO · dane przykładowe
          </span>
          <span className="flex-1" />
          <LangToggle />
          <ThemeToggle />
        </header>

        <main className="mx-auto w-full max-w-6xl space-y-6 p-6">{children}</main>
      </div>
    </div>
  );
}
