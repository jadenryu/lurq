import type { NextConfig } from "next";
import { join } from "node:path";

// Multi-zone: forward `/docs` (and everything under it — pages, assets, search)
// to the Fumadocs app. Override with DOCS_ZONE_URL in production (e.g. the
// deployed docs URL); defaults to the local docs dev/start port.
//
// Normalize the value: dashboard-pasted env vars often carry stray whitespace
// or a trailing newline, and people forget the scheme. Rewrite destinations
// must be absolute (start with http:// or https://), so trim, default a missing
// scheme to https://, and drop any trailing slash.
function resolveDocsZoneUrl(): string {
  const raw = (process.env.DOCS_ZONE_URL ?? "http://localhost:3001").trim();
  const withScheme = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

const DOCS_ZONE_URL = resolveDocsZoneUrl();

const nextConfig: NextConfig = {
  // Pin the Turbopack root to the monorepo root. Otherwise Turbopack walks up
  // and mis-detects a stray ~/package-lock.json as the workspace root, which
  // breaks proxy.ts compilation ("adapterFn is not a function") so Clerk
  // middleware never runs and every <SignInButton>/auth hook silently dies.
  turbopack: { root: join(__dirname, "..", "..") },
  // PostHog reverse proxy: route analytics through this origin so ad-blockers
  // (which blocklist *.posthog.com) can't silently drop events. The static/array
  // asset rules must precede the /ingest catch-all. US region — swap us→eu to move.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: "/ingest/static/:path*", destination: "https://us-assets.i.posthog.com/static/:path*" },
      { source: "/ingest/array/:path*", destination: "https://us-assets.i.posthog.com/array/:path*" },
      { source: "/ingest/:path*", destination: "https://us.i.posthog.com/:path*" },
      { source: "/docs", destination: `${DOCS_ZONE_URL}/docs` },
      { source: "/docs/:path*", destination: `${DOCS_ZONE_URL}/docs/:path*` },
    ];
  },
};

export default nextConfig;
