import { PageName, TopNav } from "@/components/dashboard/top-nav";
import { MobileNav } from "@/components/dashboard/mobile-nav";
import { AgencySignature, AgencyWatermark } from "@/components/ui/agency-mark";
import { Sky } from "@/components/ui/sky";
import { Spotlight } from "@/components/ui/spotlight";
import { cn } from "@/lib/utils";

/**
 * The 2026 dashboard shell (Przeglad-pastel + Telefon-2030), shared by the
 * client layout and /demo-full so both stay identical:
 *
 * - the pastel sky behind everything (fixed, decorative, not printed);
 * - md+: one floating sticky glass bar - brand, the sliding section pill
 *   (TopNav), live stamp, search, bell, Prezentuj, "…" menu. Between md
 *   and lg the section pill drops to a second row inside the same glass;
 * - <md: the same bar becomes the compact phone header (brand, page name +
 *   live line, bell, Prezentuj, "…"), and the floating glass tab bar with
 *   its "Więcej" sheet sits at the bottom (MobileNav);
 * - skip link + landmarks (header / nav / main), chrome hidden in print and
 *   while presenting (data-present-hide).
 *
 * The slots are server-rendered nodes, so each layout keeps its own data
 * (live bell count, AutoRefresh, sign-out action...).
 */
export function AppShell({
  style,
  base,
  isEcommerce,
  isAgency,
  omit,
  brand,
  phoneBrand,
  live,
  phoneLive,
  extras,
  search,
  bell,
  presentation,
  menu,
  overlays,
  banner,
  mainClassName,
  children,
  after,
}: {
  style?: React.CSSProperties;
  base: string;
  isEcommerce: boolean;
  isAgency: boolean;
  omit?: string[];
  /** Client mark for the bar (md+). */
  brand: React.ReactNode;
  /** Smaller mark for the phone header. */
  phoneBrand: React.ReactNode;
  /** <LiveStamp/> for the bar and the phone header. */
  live?: React.ReactNode;
  phoneLive?: React.ReactNode;
  /** Bar-only extras (Demo pill, language, agency refresh, client switch). */
  extras?: React.ReactNode;
  search?: React.ReactNode;
  bell?: React.ReactNode;
  presentation?: React.ReactNode;
  menu?: React.ReactNode;
  /** Mounted, invisible: CommandPalette, GuidedTour, AutoSync, AutoRefresh. */
  overlays?: React.ReactNode;
  /** Above the page inside <main> (integration health). */
  banner?: React.ReactNode;
  mainClassName?: string;
  children: React.ReactNode;
  /** After <main> (Toaster). */
  after?: React.ReactNode;
}) {
  return (
    // relative + isolate: the fixed sky (z -10) stays under the content but
    // above this wrapper's own background.
    <div className="relative isolate flex min-h-screen flex-col bg-background" style={style}>
      <a href="#main" className="skip-link">
        Przejdź do treści
      </a>
      <Sky />
      <AgencyWatermark />
      <Spotlight />
      <div className="hidden">{overlays}</div>

      <div
        data-present-hide
        className="pointer-events-none sticky top-0 z-30 mx-auto w-full max-w-[80rem] px-3 pt-2.5 sm:px-6 md:pt-3.5 print:hidden"
      >
        <header className="glass glass-blur pointer-events-auto flex min-h-[62px] flex-wrap items-center gap-2 rounded-[31px] py-[7px] pl-4 pr-2 md:min-h-16 md:gap-2.5 md:rounded-[32px] md:py-2 md:pl-[18px] xl:flex-nowrap xl:rounded-full">
          {/* Brand: the logo leads; phones get a smaller mark + page name. */}
          <div className="hidden min-w-0 shrink-0 items-center md:mr-1.5 md:flex">{brand}</div>
          <div className="flex min-w-0 flex-1 items-center gap-2.5 md:hidden">
            <span className="flex shrink-0 items-center">{phoneBrand}</span>
            <span className="flex min-w-0 flex-col leading-[1.15]">
              <PageName
                base={base}
                isEcommerce={isEcommerce}
                isAgency={isAgency}
                className="truncate text-[15px] font-semibold"
              />
              {phoneLive}
            </span>
          </div>

          <TopNav
            base={base}
            isEcommerce={isEcommerce}
            isAgency={isAgency}
            omit={omit}
            className="order-last hidden w-full justify-between md:flex xl:order-none xl:w-auto xl:justify-start"
          />

          <div className="ml-auto hidden items-center px-1.5 md:flex">{live}</div>
          {extras ? <div className="hidden items-center gap-2 md:flex">{extras}</div> : null}
          {search ? <div className="hidden md:block">{search}</div> : null}
          {bell}
          {presentation}
          {menu}
        </header>
      </div>

      <div data-present-hide>
        <MobileNav clientSlug={base.replace(/^\//, "")} isAgency={isAgency} isEcommerce={isEcommerce} omit={omit} />
      </div>

      <main id="main" tabIndex={-1} className={cn("mx-auto w-full max-w-[80rem] flex-1 outline-none", mainClassName)}>
        {banner}
        {children}
      </main>
      <AgencySignature />
      {after}
    </div>
  );
}
