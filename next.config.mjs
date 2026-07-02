/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // facebook-nodejs-business-sdk and google-ads-api are server-only; keep them
  // out of the client bundle and let Next resolve their Node dependencies.
  experimental: {
    serverComponentsExternalPackages: [
      "facebook-nodejs-business-sdk",
      "google-ads-api",
      "googleapis",
    ],
  },
};

export default nextConfig;
