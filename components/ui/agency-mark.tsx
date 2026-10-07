import { cn } from "@/lib/utils";

/**
 * The agency's signature on every client-facing surface. Until the real logo
 * file lands in public/brand/, the mark is a typeset wordmark; set
 * AGENCY_LOGO_SRC to the file's path and every place switches to it.
 */
export const AGENCY_LOGO_SRC: string | null = null;
const AGENCY_URL = "https://patoagencja.com";

export function AgencyMark({ className }: { className?: string }) {
  if (AGENCY_LOGO_SRC) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={AGENCY_LOGO_SRC} alt="patoagencja" className={cn("h-[1em] w-auto", className)} />;
  }
  return (
    <span className={cn("inline-flex items-baseline font-semibold tracking-[-0.03em]", className)}>
      pato<span className="font-normal">agencja</span>
      <span aria-hidden className="ml-[0.12em] inline-block size-[0.28em] rounded-full bg-lime" />
    </span>
  );
}

/**
 * A faint oversized mark in the bottom-right corner, behind the content
 * (needs an `isolate` ancestor, like the Sky). Decorative only; hidden on
 * phones, where the tab bar owns that corner.
 */
export function AgencyWatermark() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed bottom-6 right-8 -z-[5] hidden select-none text-[clamp(3.5rem,6vw,6.5rem)] leading-none text-foreground opacity-[0.06] md:block print:bottom-4 print:right-4 print:text-5xl"
    >
      <AgencyMark />
    </div>
  );
}

/** "Przygotowane przez patoagencja" line at the end of a page (printed too). */
export function AgencySignature({ className }: { className?: string }) {
  return (
    <footer
      data-present-hide
      className={cn(
        "flex items-center justify-center gap-2 px-4 pb-28 pt-10 text-[13px] text-ink-3 md:pb-10",
        className
      )}
    >
      <span>Przygotowane przez</span>
      <a
        href={AGENCY_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-md text-[15px] text-foreground/80 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <AgencyMark />
      </a>
    </footer>
  );
}
