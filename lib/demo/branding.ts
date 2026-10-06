import type { ClientBranding } from "@/lib/dashboard/branding";

// "Panel w barwach klienta" on the public demo: a made-up logo for the fake
// client "lokalnepomidorki", shipped inline as a data URI so the demo needs no
// external host (and so it bypasses the https-only check on purpose - that
// check guards values coming from the DB, this one is ours). The colours are
// part of the logo artwork, i.e. data, not UI tokens.
// Mid-grey wordmark text so the same file reads on the light and dark sidebar.
const DEMO_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 236 48">
<circle cx="22" cy="27" r="17" fill="#e8442e"/>
<circle cx="16" cy="22" r="4" fill="#ffffff" fill-opacity=".35"/>
<path d="M22 11c-3-5-9-6-12-4 4 0 7 2 9 5-4-1-8 0-10 3 4-1 9-1 13 0 4-1 9-1 13 0-2-3-6-4-10-3 2-3 5-5 9-5-3-2-9-1-12 4z" fill="#2f9e44"/>
<text x="46" y="32" font-family="Arial,Helvetica,sans-serif" font-size="20" font-weight="800" fill="#64748b" letter-spacing="-.4">lokalne<tspan fill="#e8442e">pomidorki</tspan></text>
</svg>`;

export const DEMO_BRANDING: ClientBranding = {
  logoUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(DEMO_LOGO_SVG)}`,
  brandColor: "#e8442e",
};

/** Just the tomato (same artwork, cropped viewBox) for the phone header. */
export const DEMO_MARK_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  DEMO_LOGO_SVG.replace('viewBox="0 0 236 48"', 'viewBox="3 6 38 38"')
)}`;
