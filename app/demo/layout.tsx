import { LangToggle } from "@/components/demo/lang-toggle";
import { ClientBrandMark } from "@/components/dashboard/client-brand-mark";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { StatusChip } from "@/components/ui/primitives";
import { Sky } from "@/components/ui/sky";
import { DEMO_BRANDING } from "@/lib/demo/branding";

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
          {/* The client's own logo, as on /demo-full - a generic sparkle
              badge made the one-pager look like a different product. */}
          <ClientBrandMark name="lokalnepomidorki" logoUrl={DEMO_BRANDING.logoUrl} className="h-7 min-w-0 max-w-[10rem]" />
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
