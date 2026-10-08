/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Vercel Skew Protection needs Next to tag asset URLs with the deployment id
  // (?dpl=...) so the CDN serves each open client the chunks from ITS build,
  // instead of 404-ing when a new deploy purges the old ones (the recurring
  // "Loading chunk failed" on the dashboard). Vercel exposes the real id at
  // build time; empty locally, so this is a no-op outside Vercel.
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID,
  // facebook-nodejs-business-sdk and google-ads-api are server-only; keep them
  // out of the client bundle and let Next resolve their Node dependencies.
  experimental: {
    // Tabs visited in the last 30 s come back from the client router cache
    // instead of a new server render: hopping Przegląd <-> Reklamy is
    // instant. Fresh data still lands - AutoRefresh calls router.refresh()
    // when a sync stamp moves, and server actions revalidate as before.
    staleTimes: { dynamic: 30, static: 180 },
    // The shop sales CSV upload (settings) posts files up to 4 MB through a
    // Server Action, whose default body limit is 1 MB. 4.5 MB is also
    // Vercel's cap on a function request body, so going higher buys nothing.
    serverActions: { bodySizeLimit: "4.5mb" },
    serverComponentsExternalPackages: [
      "facebook-nodejs-business-sdk",
      "google-ads-api",
      "googleapis",
    ],
    // The OLX v3 report route reads the bundled PPTX template from disk at
    // runtime; make sure Vercel's file tracing ships it with the function.
    outputFileTracingIncludes: {
      "/api/report/olx-v3": ["./lib/report/templates/*.pptx"],
    },
  },
  // Baseline security headers. The dashboard must never render inside
  // someone else's frame (clickjacking a "Rozłącz" or an invite); only the
  // public demo may be embedded (e.g. on the agency's site).
  async headers() {
    const base = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    ];
    return [
      { source: "/:path*", headers: base },
      {
        source: "/((?!demo(?:-full)?(?:/|$)).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
