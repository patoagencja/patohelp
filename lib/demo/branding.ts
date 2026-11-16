import type { ClientBranding } from "@/lib/dashboard/branding";

// "Panel w barwach klienta" on the public demo: a made-up logo for the
// fictional shop "Mediaspec" (lib/demo/brand.ts) - a screen with a spark and
// a lowercase wordmark in deep teal, deliberately unlike any electronics
// chain's colours. Built from plain shapes and text, shipped inline as a data
// URI so the demo needs no external host (and so it bypasses the https-only
// check on purpose - that check guards values coming from the DB, this one
// is ours). The colours are part of the logo artwork, i.e. data, not UI
// tokens.
// The wordmark switches with the theme: an <img> SVG's prefers-color-scheme
// follows the page's used color-scheme (globals.css sets `color-scheme: dark`
// on .dark), so the dark header gets light text.
const DEMO_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 170 48">
<style>.w{fill:#334155}.a{fill:#0e7490}.s{fill:#0e7490}@media (prefers-color-scheme:dark){.w{fill:#e2e8f0}.a{fill:#5eead4}.s{fill:#14b8a6}}</style>
<rect class="s" x="5" y="9" width="34" height="24" rx="5"/>
<rect class="s" x="16" y="35" width="12" height="3.2" rx="1.6"/>
<path d="M24.6 12.5 16.8 23.4h5.4l-2 7.4 8.6-11.6h-5.5z" fill="#ffffff"/>
<text class="w" x="46" y="31" font-family="Arial,Helvetica,sans-serif" font-size="21" font-weight="800" letter-spacing="-.5">media<tspan class="a">spec</tspan></text>
</svg>`;

export const DEMO_BRANDING: ClientBranding = {
  logoUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(DEMO_LOGO_SVG)}`,
  brandColor: "#0e7490",
};

/** Just the screen (same artwork, cropped viewBox) for the phone header. */
export const DEMO_MARK_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  DEMO_LOGO_SVG.replace('viewBox="0 0 170 48"', 'viewBox="2 4 40 38"')
)}`;
