// Form control recipes for the settings forms (2026 pastel). There is no
// forms plugin, so native checkboxes / radios would render in the browser's
// default blue; `accent-anchor` paints them in the "sel" colour (near-black,
// off-white in dark) to match the segmented controls and primary pills.
export const CHECKBOX_CLASS =
  "h-[18px] w-[18px] shrink-0 cursor-pointer rounded accent-anchor focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed";

export const RADIO_CLASS =
  "h-[18px] w-[18px] shrink-0 cursor-pointer accent-anchor focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card";

// Text inputs / selects / textareas on a glass card: a translucent chip
// field (same fill as the segmented tracks), white with the lime-ink ring
// on focus. 44px tall for single-line controls.
export const FIELD_CLASS =
  "h-11 rounded-[14px] border border-transparent bg-chip px-3.5 text-[15px] transition-[background-color,box-shadow] hover:bg-[var(--chip-hover)] focus-visible:border-line focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:focus-visible:bg-[var(--chip-hover)]";
