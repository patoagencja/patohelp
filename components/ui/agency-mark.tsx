import { cn } from "@/lib/utils";

const AGENCY_URL = "https://patoagencja.com";

// The "pato" logo, redrawn as geometry from the brand file so it stays sharp at
// watermark size and takes currentColor (one mark for light, dark and print).
// Nonzero fill: outer shapes run clockwise, the counters counter-clockwise,
// and no outer piece overlaps a counter, so the holes stay open.
const PATO_PATH = [
  // p: bowl, counter, stem
  "M314 980a169 169 0 1 1 338 0a169 169 0 1 1-338 0Z",
  "M405 980a78 78 0 1 0 156 0a78 78 0 1 0-156 0Z",
  "M314 980H404V1240H314Z",
  // a: bowl, counter, straight right side, tail
  "M676 980a169 169 0 1 1 338 0a169 169 0 1 1-338 0Z",
  "M767 980a78 78 0 1 0 156 0a78 78 0 1 0-156 0Z",
  "M923 980H1014V1058H923Z",
  "M1008 1058H1063V1149H1008A91 91 0 0 1 917 1058Z",
  // t
  "M1087 690H1177V811H1256V902H1177V980A78 78 0 0 0 1256 1058V1149A169 169 0 0 1 1087 980V902H1032V811H1087Z",
  // o
  "M1276 980a169 169 0 1 1 338 0a169 169 0 1 1-338 0Z",
  "M1367 980a78 78 0 1 0 156 0a78 78 0 1 0-156 0Z",
].join("");

/** The agency logo, 1em tall; colour follows the surrounding text. */
export function AgencyMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="314 690 1300 550"
      fill="currentColor"
      role="img"
      aria-label="pato"
      className={cn("inline-block h-[1em] w-auto shrink-0 aspect-[1300/550]", className)}
    >
      <path d={PATO_PATH} />
    </svg>
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
      className="pointer-events-none fixed bottom-6 right-8 -z-[5] hidden select-none text-[clamp(4rem,7vw,7.5rem)] leading-none text-foreground opacity-[0.06] md:block print:bottom-4 print:right-4 print:text-5xl"
    >
      <AgencyMark />
    </div>
  );
}

/** "Przygotowane przez pato" line at the end of a page (printed too). */
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
        aria-label="pato - patoagencja.com"
        className="inline-flex rounded-md text-[18px] text-foreground/80 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <AgencyMark />
      </a>
    </footer>
  );
}
