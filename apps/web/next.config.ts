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

// Security headers, applied to every response this app serves.
//
// The agent-facing API (src/mcp/http.ts) is fronted by helmet; this app was not
// fronted by anything, so it shipped with no HSTS, no nosniff, and no framing
// rule. These are the ones that cost nothing and cannot break a working page.
//
// ponytail: no Content-Security-Policy here. A correct one for this app has to
// enumerate Clerk, PostHog (proxied through /ingest), Vercel Analytics and
// Speed Insights, plus the `unsafe-inline` Next's own bootstrap needs, and a
// wrong one white-screens the site silently. That is a project with a
// report-only rollout, not a line in this array. Add it when there is a place
// to watch the violation reports land.
const SECURITY_HEADERS = [
  // Two years of HTTPS-only, including api./docs. Not `preload`: submitting to
  // the preload list is effectively one-way, and every subdomain has to be
  // HTTPS forever before that is safe to promise.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // No MIME sniffing. Matters most for the JSON the dashboard routes return.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Nothing here is meant to be embedded, so clickjacking has no legitimate
  // use case to preserve. X-Frame-Options rather than CSP frame-ancestors
  // because it is the half of that rule that needs no policy around it.
  { key: "X-Frame-Options", value: "DENY" },
  // Send the origin cross-site, the full path same-site. Next sets this on its
  // own <Link> navigations; this covers everything else (form posts, window
  // opens, the copy-command links people paste).
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Powerful features this site will never ask for, denied at the browser so a
  // compromised third-party script cannot ask for them either. browsing-topics
  // opts the site out of Topics-based ad profiling.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  // Isolate the browsing context from anything that opens us, while still
  // allowing the popups an OAuth sign-in flow may use.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

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
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
