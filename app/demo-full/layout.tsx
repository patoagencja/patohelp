import { DemoLangNote, LangToggle } from "@/components/demo/lang-toggle";
import { AppShell } from "@/components/dashboard/app-shell";
import { LiveStamp } from "@/components/dashboard/auto-refresh";
import { ClientBrandMark } from "@/components/dashboard/client-brand-mark";
import { CommandPalette } from "@/components/dashboard/command-palette";
import { GuidedTour } from "@/components/dashboard/guided-tour";
import { PresentationMode } from "@/components/dashboard/presentation-mode";
import { AlertsBell, HeaderMenu, SearchButton } from "@/components/dashboard/header-menu";
import { clientAccentStyle } from "@/lib/dashboard/branding";
import { countAttentionAlerts } from "@/lib/alerts/current";
import { getDemoAlerts } from "@/lib/demo/alerts";
import { DEMO_BRAND } from "@/lib/demo/brand";
import { DEMO_BRANDING, DEMO_MARK_URL } from "@/lib/demo/branding";
import { getDemoSource } from "@/lib/demo/profile/store";

// Full showcase with working navigation and clickable tabs. Public; the
// numbers are the demo source's (lib/demo/source.ts).
export const metadata = {
  title: "Demo (pełne) - panel klienta",
  description: "Pełny przykładowy dashboard marketingowy (dane demonstracyjne).",
};

const BASE = "/demo-full";
const OMIT = [`${BASE}/raport`];

export default async function DemoFullLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const src = await getDemoSource();
  return (
    // Same shell and branding path as a real client (logo + --client-accent),
    // demo data. Mirrors app/(dashboard)/[clientSlug]/layout.tsx.
    <AppShell
      style={clientAccentStyle(DEMO_BRANDING.brandColor)}
      base={BASE}
      isEcommerce
      // No "Sezon" in the demo: the showcase is for every prospect, and
      // /demo-full/sezon redirects to the overview (next.config.mjs).
      isSeasonal={false}
      isAgency={false}
      omit={OMIT}
      brand={
        <ClientBrandMark
          name={DEMO_BRAND}
          logoUrl={DEMO_BRANDING.logoUrl}
          className="h-7 max-w-[10rem]"
        />
      }
      phoneBrand={<ClientBrandMark name={DEMO_BRAND} logoUrl={DEMO_MARK_URL} className="h-6" />}
      live={<LiveStamp initialStamp={null} demo="Na żywo · dane przykładowe" textClassName="sr-only xl:not-sr-only xl:whitespace-nowrap" />}
      phoneLive={<LiveStamp initialStamp={null} demo="dane przykładowe" className="gap-1.5 text-[11.5px]" textClassName="truncate" />}
      // "Na żywo · dane przykładowe" marks the demo; no extra pill (the bar
      // has no room for it next to PL/EN).
      extras={
        <>
          <div className="hidden xl:block">
            <LangToggle />
          </div>
        </>
      }
      search={<SearchButton />}
      // Same rule as live: Pilne + Ważne from the demo's alerts.
      bell={<AlertsBell href={`${BASE}/alerty`} count={countAttentionAlerts(getDemoAlerts(src))} />}
      presentation={
        <PresentationMode
          className="max-md:w-11 max-md:px-0"
          labelClassName="hidden md:max-xl:inline xl:inline"
          brand={<ClientBrandMark name={DEMO_BRAND} logoUrl={DEMO_BRANDING.logoUrl} className="h-8" />}
        />
      }
      menu={<HeaderMenu overviewPath={BASE} isEcommerce isSeasonal={false} omit={OMIT} />}
      overlays={
        <>
          <CommandPalette clientSlug="demo-full" isAgency={false} isEcommerce isSeasonal={false} omit={OMIT} />
          <GuidedTour isAgency={false} overviewPath={BASE} />
        </>
      }
      banner={<DemoLangNote />}
      mainClassName="space-y-8 px-4 pb-32 pt-6 sm:px-6 md:pb-12 md:pt-8"
    >
      {children}
    </AppShell>
  );
}
