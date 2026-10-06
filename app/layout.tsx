import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Geist + Geist Mono, self-hosted (app/fonts, Google Fonts subsets). Each
// subset is its own next/font call with a unicode-range: next/font/local
// can't put two files of the same weight into one family, and Polish
// diacritics (ą ę ł ś ż) live in latin-ext. The stacks in tailwind.config.ts
// list latin first, then latin-ext, then system fonts. No metric-adjusted
// fallback face: it would sit between the two subsets in the stack and
// render every Polish letter in Arial.
// unicode-range values must be literals (next/font compiles them).

const geist = localFont({
  src: [{ path: "./fonts/Geist-latin.woff2", weight: "300 600", style: "normal" }],
  variable: "--font-geist",
  display: "swap",
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
});
const geistExt = localFont({
  src: [{ path: "./fonts/Geist-latin-ext.woff2", weight: "300 600", style: "normal" }],
  variable: "--font-geist-ext",
  display: "swap",
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" }],
});
const geistMono = localFont({
  src: [{ path: "./fonts/GeistMono-latin.woff2", weight: "400 500", style: "normal" }],
  variable: "--font-geist-mono",
  display: "swap",
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
});
const geistMonoExt = localFont({
  src: [{ path: "./fonts/GeistMono-latin-ext.woff2", weight: "400 500", style: "normal" }],
  variable: "--font-geist-mono-ext",
  display: "swap",
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" }],
});
const fontVars = [geist, geistExt, geistMono, geistMonoExt].map((f) => f.variable).join(" ");

export const metadata: Metadata = {
  title: "Kalejdo",
  description: "Kalejdo by patoagencja - live Meta Ads, Google Ads & GA4 results for clients.",
};

// Apply the saved theme before first paint to avoid a light→dark flash.
const themeScript = `
(function () {
  try {
    if (localStorage.getItem('theme') === 'dark') {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pl" className={fontVars} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
