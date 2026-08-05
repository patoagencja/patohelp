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
};

export default nextConfig;
