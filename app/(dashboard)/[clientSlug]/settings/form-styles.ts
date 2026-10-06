// Native checkboxes / radios in the settings forms. There is no forms
// plugin, so without an accent they render in the browser's default blue;
// `accent-anchor` paints them in the v2 "selected" colour (near-black, or
// off-white in dark mode) to match the segmented controls and primary pills.
export const CHECKBOX_CLASS =
  "h-4 w-4 shrink-0 cursor-pointer rounded accent-anchor focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed";

export const RADIO_CLASS =
  "h-4 w-4 shrink-0 cursor-pointer accent-anchor focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card";
