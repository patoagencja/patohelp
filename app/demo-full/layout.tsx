import { DemoSidebar } from "@/components/demo/demo-sidebar";
import { LangToggle } from "@/components/demo/lang-toggle";
import { ClientBrandMark } from "@/components/dashboard/client-brand-mark";
import { CommandPalette } from "@/components/dashboard/command-palette";
import { GuidedTour } from "@/components/dashboard/guided-tour";
import { MobileNav } from "@/components/dashboard/mobile-nav";
import { PresentationMode } from "@/components/dashboard/presentation-mode";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { clientAccentStyle } from "@/lib/dashboard/branding";
import { DEMO_BRANDING } from "@/lib/demo/branding";

// Full showcase with a working sidebar and clickable tabs. Public, synthetic.
export const metadata = {
  title: "Demo (pełne) - panel klienta",
  description: "Pełny przykładowy dashboard marketingowy (dane demonstracyjne).",
};

export default function DemoFullLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // Same branding path as a real client (logo + --client-accent), demo data.
    <div
      className="flex min-h-screen bg-muted/20"
      style={clientAccentStyle(DEMO_BRANDING.brandColor)}
    >
      <aside
        data-present-hide
        className="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex"
      >
        <div className="flex h-14 items-center gap-2.5 border-b border-border px-5">
          <ClientBrandMark
            name="lokalnepomidorki"
            logoUrl={DEMO_BRANDING.logoUrl}
            className="h-8 max-w-[11rem]"
          />
        </div>
        <DemoSidebar />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          data-present-hide
          className="flex h-14 items-center gap-2 border-b border-border bg-card px-4 sm:gap-3 sm:px-6"
        >
          <span className="whitespace-nowrap rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-400">
            DEMO<span className="hidden sm:inline"> · dane przykładowe</span>
          </span>
          <span className="flex-1" />
          <LangToggle />
          <CommandPalette
            clientSlug="demo-full"
            isAgency={false}
            isEcommerce
            omit={["/demo-full/raport"]}
          />
          <GuidedTour isAgency={false} overviewPath="/demo-full" />
          <PresentationMode
            brand={
              <ClientBrandMark
                name="lokalnepomidorki"
                logoUrl={DEMO_BRANDING.logoUrl}
                className="h-8"
              />
            }
          />
          <ThemeToggle />
        </header>

        <div data-present-hide>
          <MobileNav
            clientSlug="demo-full"
            isAgency={false}
            isEcommerce
            omit={["/demo-full/raport"]}
          />
        </div>

        <main className="mx-auto w-full max-w-6xl space-y-6 p-6 pb-24 md:pb-6">{children}</main>
      </div>
    </div>
  );
}
