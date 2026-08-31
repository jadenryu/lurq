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
  /**
   * Baseline security headers. The Express service has had `helmet()` since it
   * shipped; this app — the one that actually holds the Clerk session — had
   * nothing, so /dashboard was framable and its revoke/rotate buttons were a
   * clickjack away.
   *
   * DELIBERATELY NOT A FULL CSP. A `script-src`/`style-src` policy has to
   * allowlist Clerk, PostHog, Vercel analytics and Next's own inline bootstrap,
   * and a wrong one fails by silently killing sign-in. `frame-ancestors` is the
   * one directive that constrains no resource loading at all, so it is safe to
   * ship un-tested; the rest of the policy is a separate, measured change.
   *
   * HSTS carries neither `includeSubDomains` nor `preload` on purpose: this app
   * is not the only thing on the domain (api.lurq.run, the docs zone), and
   * asserting HTTPS on their behalf from here is how you brick a subdomain you
   * forgot about, for two years, in every browser that ever saw the header.
   */
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
    ];
  },
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
