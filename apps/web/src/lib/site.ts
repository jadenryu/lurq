/**
 * Canonical site origin, in ONE place so robots.ts, sitemap.ts and the layout
 * metadata can never disagree.
 *
 * The apex `lurq.run` 308-redirects to `www.lurq.run`, so www is the canonical
 * host. If `NEXT_PUBLIC_SITE_URL` is set to the bare apex (a common env mistake),
 * the sitemap `<loc>`s, the robots `Sitemap`/`Host`, and the `<link rel=canonical>`
 * all point at the redirecting host — which Google reports as "Page with redirect"
 * and refuses to index. Normalizing the apex to www here makes every emitted URL
 * resolve 200 with no redirect, regardless of how the env var is set.
 */
const DEFAULT_ORIGIN = "https://www.lurq.run";

export function normalizeOrigin(raw: string | undefined): string {
  const trimmed = (raw ?? DEFAULT_ORIGIN).trim();
  if (!trimmed) return DEFAULT_ORIGIN;
  try {
    const u = new URL(/^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`);
    u.protocol = "https:";
    // A bare apex (two labels, e.g. `lurq.run`) is the redirect *source*; prepend
    // `www` to reach the canonical destination. `www.*` and deeper subdomains
    // (incl. `*.vercel.app` previews) are left untouched.
    if (!u.hostname.startsWith("www.") && u.hostname.split(".").length === 2) {
      u.hostname = `www.${u.hostname}`;
    }
    return u.origin;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

/** Canonical, non-redirecting origin (e.g. `https://www.lurq.run`). No trailing slash. */
export const SITE_ORIGIN = normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL);

/** Absolute canonical URL for a path (`/` → the bare origin). */
export function siteUrl(path = "/"): string {
  return path === "/" ? SITE_ORIGIN : `${SITE_ORIGIN}${path}`;
}
