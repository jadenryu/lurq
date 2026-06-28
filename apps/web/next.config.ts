import type { NextConfig } from "next";

// Multi-zone: forward `/docs` (and everything under it — pages, assets, search)
// to the Fumadocs app. Override with DOCS_ZONE_URL in production (e.g. the
// deployed docs URL); defaults to the local docs dev/start port.
const DOCS_ZONE_URL = process.env.DOCS_ZONE_URL ?? "http://localhost:3001";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/docs", destination: `${DOCS_ZONE_URL}/docs` },
      { source: "/docs/:path*", destination: `${DOCS_ZONE_URL}/docs/:path*` },
    ];
  },
};

export default nextConfig;
