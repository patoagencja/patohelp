import type { MetadataRoute } from "next";

// "Dodaj do ekranu początkowego": the panel opens from its own icon, full
// screen, without the browser bar. start_url "/" goes through the usual
// landing redirect (login, the client's overview or the agency's list).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kaleido",
    short_name: "Kaleido",
    description: "Wyniki Twoich reklam, strony i sklepu w jednym miejscu.",
    lang: "pl",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // --bg (globals.css): the canvas the first paint lands on.
    background_color: "#F5F3EE",
    theme_color: "#F5F3EE",
    // The login screen's brand mark (ink tile, Sparkles, lime dot) as static
    // files: a generated icon route ran a function on every favicon fetch.
    // The maskable one keeps the glyph in the middle 60% Android may crop to.
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
