/**
 * Cross-zone link targets.
 *
 * Docs live in a separate Next app (`apps/docs`) surfaced at `/docs` through the
 * multi-zone rewrite in `next.config.ts`. `/docs` is therefore the correct,
 * canonical target in production — `www.lurq.run/docs` serves the docs, and no
 * `docs.<domain>` host is published.
 *
 * The catch is local development: the rewrite proxies to `localhost:3001`, so if
 * you're only running `apps/web` the link returns a 500 rather than a 404. Set
 * `NEXT_PUBLIC_DOCS_URL=https://www.lurq.run/docs` to point local UI at the
 * deployed docs instead, or run both apps (`npm run dev:apps` from the repo root).
 */
export const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL || "/docs";
