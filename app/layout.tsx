import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Fallback face only: the font stack (tailwind.config.ts) prefers the system
// UI font, and --font-inter must be defined on <html> because the stack
// references it with var().
const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Pato Dashboard",
  description: "Client dashboard for Pato agency - live Meta Ads, Google Ads & GA4 data.",
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
    <html lang="pl" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
