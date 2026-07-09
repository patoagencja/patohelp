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

type LogoComponent = (props: { className?: string }) => JSX.Element;

const LOGOS: Record<string, LogoComponent> = {
  dre: DreLogo,
};

/** Returns the client's logo component (inline SVG) or null if none is set. */
export function clientLogo(slug: string): LogoComponent | null {
  return Object.prototype.hasOwnProperty.call(LOGOS, slug) ? LOGOS[slug] : null;
}
