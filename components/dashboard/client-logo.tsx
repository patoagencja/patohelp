// Client logos as inline SVG so they inherit the surrounding text colour
// (white on the dark report cover, dark in the sidebar) and print cleanly.
// Recreated wordmarks — swap the SVG for an official asset when available.

/** DRE wordmark: heavy "DRE" with the brand's horizontal slice near the base. */
export function DreLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 300 110"
      className={className}
      role="img"
      aria-label="DRE"
      fill="currentColor"
    >
      <defs>
        <mask id="dre-cut">
          <rect width="300" height="110" fill="black" />
          <text
            x="150"
            y="92"
            textAnchor="middle"
            fontFamily="Arial, Helvetica, sans-serif"
            fontWeight="900"
            fontSize="118"
            letterSpacing="-2"
            fill="white"
          >
            DRE
          </text>
          {/* signature horizontal cut through the lower third */}
          <rect x="0" y="74" width="300" height="9" fill="black" />
        </mask>
      </defs>
      <rect width="300" height="110" mask="url(#dre-cut)" />
    </svg>
  );
}

/** OLX wordmark: ring "o", bar "l", chunky "x" - recreated with currentColor. */
export function OlxLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 110"
      className={className}
      role="img"
      aria-label="OLX"
      fill="currentColor"
    >
      <defs>
        <mask id="olx-cut">
          <rect width="200" height="110" fill="black" />
          {/* o: filled disc with a punched-out centre */}
          <circle cx="34" cy="55" r="34" fill="white" />
          <circle cx="34" cy="55" r="15" fill="black" />
          {/* l: vertical bar */}
          <rect x="82" y="15" width="15" height="80" fill="white" />
          {/* x: two crossing thick strokes */}
          <rect
            x="141.5"
            y="13"
            width="17"
            height="84"
            fill="white"
            transform="rotate(45 150 55)"
          />
          <rect
            x="141.5"
            y="13"
            width="17"
            height="84"
            fill="white"
            transform="rotate(-45 150 55)"
          />
        </mask>
      </defs>
      <rect width="200" height="110" mask="url(#olx-cut)" />
    </svg>
  );
}

type LogoComponent = (props: { className?: string }) => JSX.Element;

const LOGOS: Record<string, LogoComponent> = {
  dre: DreLogo,
  olx: OlxLogo,
  // Fallback for the un-renamed slug (pasted URL) until the DB slug is fixed.
  "https-www-olx-pl": OlxLogo,
};

/** Returns the client's logo component (inline SVG) or null if none is set. */
export function clientLogo(slug: string): LogoComponent | null {
  return Object.prototype.hasOwnProperty.call(LOGOS, slug) ? LOGOS[slug] : null;
}
