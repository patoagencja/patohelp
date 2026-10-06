import { DemoSidebar } from "@/components/demo/demo-sidebar";
import { LangToggle } from "@/components/demo/lang-toggle";
import { ClientBrandMark } from "@/components/dashboard/client-brand-mark";
import { CommandPalette } from "@/components/dashboard/command-palette";
import { GuidedTour } from "@/components/dashboard/guided-tour";
import { MobileNav } from "@/components/dashboard/mobile-nav";
import { PresentationMode } from "@/components/dashboard/presentation-mode";
import { AlertsBell, HeaderMenu } from "@/components/dashboard/header-menu";
import { HeaderTitle } from "@/components/dashboard/header-title";
import { Pill } from "@/components/ui/pill";
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
  const brand = (
    <ClientBrandMark
      name="lokalnepomidorki"
      logoUrl={DEMO_BRANDING.logoUrl}
      className="h-8 max-w-[11rem]"
    />
  );

  return (
    // Same branding path as a real client (logo + --client-accent), demo data.
    // Shell mirrors app/(dashboard)/[clientSlug]/layout.tsx.
    <div
      className="flex min-h-screen bg-background"
      style={clientAccentStyle(DEMO_BRANDING.brandColor)}
    >
      <aside
        data-present-hide
        className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto md:flex print:hidden"
      >
        <div className="flex h-16 shrink-0 items-center gap-2.5 px-5">{brand}</div>
        <DemoSidebar />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          data-present-hide
          data-chrome-header
          className="sticky top-0 z-30 border-b border-transparent bg-chrome/75 backdrop-blur-xl backdrop-saturate-150 print:hidden"
        >
          {/* Same column and gutters as <main>, so the title sits exactly
              above the page content. */}
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-1.5 px-4 sm:gap-2 sm:px-6 md:h-16 lg:px-8">
            <HeaderTitle
              clientName="lokalnepomidorki"
              base="/demo-full"
              isEcommerce
              isAgency={false}
              brand={
                <ClientBrandMark
                  name="lokalnepomidorki"
                  logoUrl={DEMO_BRANDING.logoUrl}
                  className="h-6 max-w-[8rem]"
                />
              }
            />
            <Pill tone="warning" className="hidden shrink-0 sm:inline-flex" title="Dane przykładowe">
              Demo
            </Pill>
            <span className="flex-1" />
            <div className="hidden">
              <CommandPalette
                clientSlug="demo-full"
                isAgency={false}
                isEcommerce
                omit={["/demo-full/raport"]}
              />
              <GuidedTour isAgency={false} overviewPath="/demo-full" />
            </div>
            <div className="hidden sm:block">
              <LangToggle />
            </div>
            <AlertsBell href="/demo-full/alerty" />
            <PresentationMode brand={<ClientBrandMark name="lokalnepomidorki" logoUrl={DEMO_BRANDING.logoUrl} className="h-8" />} />
            <HeaderMenu overviewPath="/demo-full" />
          </div>
        </header>

        <div data-present-hide>
          <MobileNav
            clientSlug="demo-full"
            isAgency={false}
            isEcommerce
            omit={["/demo-full/raport"]}
          />
        </div>

        <main className="mx-auto w-full max-w-6xl flex-1 space-y-8 px-4 pb-28 pt-6 sm:px-6 md:pb-12 md:pt-8 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
